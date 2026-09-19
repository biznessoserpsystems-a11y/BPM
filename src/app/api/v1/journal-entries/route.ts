import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { canAccessBranch, getCompanyBranchIds } from '@/lib/branch-access';
import { assertPeriodOpenForDate } from '@/lib/accounting-period';
import type { CreateJournalEntryInput } from '@/types/pharmacy';
import { generateEntryNumber } from '@/lib/journal-entry-number';

// Direct journal entry posting bypasses the PO/Transfer style request flow
// entirely, so it's gated the same way as the other manual accounting
// actions (gl-mappings, accounting period close/reopen).
const CAN_POST_JOURNAL_ENTRY = ['ADMIN', 'MANAGER'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const branchId = request.nextUrl.searchParams.get('branchId');
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100);

    // The general ledger is financial data — same visibility policy as
    // everywhere else: a specific branchId needs access to that branch,
    // and an unfiltered ("every branch's ledger") view is Admin/Manager
    // only.
    if (branchId) {
      if (!(await canAccessBranch(db, auth, branchId))) {
        throw new PharmacyServiceError("You do not have access to this branch's data");
      }
    } else {
      const roleError = requireRole(auth, CAN_POST_JOURNAL_ENTRY);
      if (roleError) return roleError;
    }
    const companyBranchIds = branchId ? undefined : await getCompanyBranchIds(db, auth.companyId);

    const entries = await db.journalEntry.findMany({
      where: branchId ? { branchId } : { branchId: { in: companyBranchIds } },
      orderBy: { entryDate: 'desc' },
      take: Math.min(limit, 500),
      include: {
        currency: true,
        postedByUser: { select: { fullName: true, username: true } },
        lines: {
          include: {
            account: { select: { accountCode: true, accountName: true } },
            product: { select: { brandName: true } },
          },
        },
      },
    });

    return NextResponse.json(entries);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    if (!CAN_POST_JOURNAL_ENTRY.includes(auth.roleName)) {
      throw new PharmacyServiceError(
        `Only ${CAN_POST_JOURNAL_ENTRY.join(' or ')} may post journal entries directly (your role: ${auth.roleName})`
      );
    }

    const body: CreateJournalEntryInput = await request.json();

    if (!body.branchId || !body.entryDate || !body.sourceType || !body.postedByUserId) {
      throw new PharmacyServiceError('branchId, entryDate, sourceType, and postedByUserId are required');
    }
    // Same branch-ownership check GET already applies to its branchId
    // query param — without it here, POST would happily create a journal
    // entry under a branchId belonging to a different company entirely.
    if (!(await canAccessBranch(db, auth, body.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch");
    }
    if (body.postedByUserId !== auth.userId) {
      throw new PharmacyServiceError('You can only post a journal entry as yourself');
    }
    if (!body.lines || body.lines.length < 2) {
      throw new PharmacyServiceError('A journal entry needs at least two lines (one debit, one credit)');
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of body.lines) {
      const debit = line.debit ?? 0;
      const credit = line.credit ?? 0;
      if (debit > 0 && credit > 0) {
        throw new PharmacyServiceError('A line cannot have both a debit and a credit amount');
      }
      if (debit === 0 && credit === 0) {
        throw new PharmacyServiceError('Every line must have either a debit or a credit amount');
      }
      totalDebit += debit;
      totalCredit += credit;
    }
    // Floating point tolerance
    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      throw new PharmacyServiceError(
        `Entry is not balanced: total debits (${totalDebit.toFixed(2)}) must equal total credits (${totalCredit.toFixed(2)})`
      );
    }

    // Every referenced account must belong to the poster's own company —
    // without this, a journal entry could post against another company's
    // Chart of Accounts by guessing/reusing a numeric accountId, silently
    // corrupting that other company's ledger and financial reports.
    const accountIds = [...new Set(body.lines.map((l) => l.accountId))];
    const ownedAccounts = await db.account.findMany({
      where: { id: { in: accountIds }, companyId: auth.companyId },
      select: { id: true },
    });
    if (ownedAccounts.length !== accountIds.length) {
      throw new PharmacyServiceError('One or more accounts on this entry do not belong to your company');
    }

    let currencyId = body.currencyId;
    if (!currencyId) {
      const base = await db.currency.findFirst({ where: { companyId: auth.companyId, isBaseCurrency: true } });
      if (!base) {
        throw new PharmacyServiceError('No base currency is configured — set one before posting entries');
      }
      currencyId = base.id;
    }

    const entryNumber = await generateEntryNumber();
    const entryDate = new Date(body.entryDate);

    const entry = await db.$transaction(async (tx) => {
      await assertPeriodOpenForDate(tx, entryDate);

      const created = await tx.journalEntry.create({
        data: {
          entryNumber,
          branchId: body.branchId,
          entryDate,
          description: body.description,
          sourceType: body.sourceType,
          sourceId: body.sourceId,
          currencyId,
          exchangeRate: body.exchangeRate ?? 1.0,
          postedByUserId: body.postedByUserId,
          lines: {
            createMany: {
              data: body.lines.map((l) => ({
                accountId: l.accountId,
                debit: l.debit ?? 0,
                credit: l.credit ?? 0,
                description: l.description,
                productId: l.productId,
              })),
            },
          },
        },
        include: {
          currency: true,
          lines: { include: { account: { select: { accountCode: true, accountName: true } } } },
        },
      });

      await tx.systemAuditLog.create({
        data: {
          branchId: body.branchId,
          userId: body.postedByUserId,
          action: 'POST_JOURNAL_ENTRY',
          entityName: 'journal_entries',
          entityId: created.id,
          details: JSON.stringify({ entryNumber, totalDebit, sourceType: body.sourceType }),
        },
      });

      return created;
    });

    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
