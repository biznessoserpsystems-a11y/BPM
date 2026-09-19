import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { canAccessBranch, getCompanyBranchIds } from '@/lib/branch-access';
import { assertPeriodOpenForDate } from '@/lib/accounting-period';
import { generateEntryNumber } from '@/lib/journal-entry-number';

// Recording a payment moves real cash out the door — same tier as posting
// a manual journal entry.
const CAN_RECORD_PAYMENT = ['ADMIN', 'MANAGER'];

// A payment settles either a routine expense (rent, utilities — no prior
// liability) or an existing payable (settling what's owed against a past
// goods receipt). Both are valid things to "pay"; anything else (an
// Asset, Revenue, or Equity account) isn't a sensible target for a cash
// disbursement form like this one.
const PAYABLE_ACCOUNT_TYPES = ['EXPENSE', 'LIABILITY'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const branchId = request.nextUrl.searchParams.get('branchId');
    if (branchId && !(await canAccessBranch(db, auth, branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }
    const companyBranchIds = branchId ? undefined : await getCompanyBranchIds(db, auth.companyId);

    const payments = await db.journalEntry.findMany({
      where: { sourceType: 'PAYMENT', ...(branchId ? { branchId } : { branchId: { in: companyBranchIds } }) },
      orderBy: { entryDate: 'desc' },
      take: 100,
      include: {
        lines: { include: { account: { select: { accountCode: true, accountName: true, accountType: true } } } },
        postedByUser: { select: { id: true, fullName: true, username: true } },
      },
    });

    return NextResponse.json(payments);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_RECORD_PAYMENT);
    if (roleError) return roleError;

    const body = await request.json();
    const supplierId = body.supplierId ? Number(body.supplierId) : undefined;
    const amount = Number(body.amount);
    const paymentDate = body.paymentDate ? new Date(body.paymentDate) : new Date();

    if (!body.branchId || (!body.accountId && !supplierId) || !amount || amount <= 0) {
      throw new PharmacyServiceError('branchId, a positive amount, and either accountId or supplierId are required');
    }
    if (!(await canAccessBranch(db, auth, body.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }

    // Paying a supplier resolves to *their* AP account if one's been
    // linked (Catalog → Suppliers), falling back to the shared global AP
    // mapping otherwise — the same resolution goods receipts already use,
    // so a supplier picked here always lands in the same place their
    // goods receipts do.
    let accountId: number;
    let payingSupplierName: string | undefined;
    if (supplierId) {
      const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier || supplier.companyId !== auth.companyId) {
        throw new PharmacyServiceError(`Supplier ${supplierId} not found`);
      }
      payingSupplierName = supplier.name;
      if (supplier.apAccountId) {
        accountId = supplier.apAccountId;
      } else {
        const apMapping = await db.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'AP' } } });
        if (!apMapping) {
          throw new PharmacyServiceError(
            `${supplier.name} isn't linked to their own AP account, and no default AP account is mapped in Settings → GL Mappings — link one or the other before paying`
          );
        }
        accountId = apMapping.accountId;
      }
    } else {
      accountId = Number(body.accountId);
    }

    const account = await db.account.findUnique({ where: { id: accountId } });
    if (!account || account.companyId !== auth.companyId) {
      throw new PharmacyServiceError(`Account ${accountId} not found`);
    }
    if (!PAYABLE_ACCOUNT_TYPES.includes(account.accountType)) {
      throw new PharmacyServiceError(
        `Payments can only be made against Expense or Liability accounts — "${account.accountName}" is ${account.accountType}`
      );
    }

    const cashMapping = await db.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'CASH' } } });
    if (!cashMapping) {
      throw new PharmacyServiceError('CASH must be mapped in Settings → GL Mappings before recording payments');
    }

    const baseCurrency = await db.currency.findFirst({ where: { companyId: auth.companyId, isBaseCurrency: true } });
    if (!baseCurrency) {
      throw new PharmacyServiceError('No base currency configured — set one in Settings → Currencies first');
    }

    await assertPeriodOpenForDate(db, paymentDate);

    const label = payingSupplierName ? `Payment to ${payingSupplierName}` : `Payment — ${account.accountName}`;
    const description = body.description ? `${body.description} — ${label}` : label;

    const entryNumber = await generateEntryNumber();
    const entry = await db.journalEntry.create({
      data: {
        entryNumber,
        branchId: body.branchId,
        entryDate: paymentDate,
        description,
        sourceType: 'PAYMENT',
        sourceId: null,
        currencyId: baseCurrency.id,
        postedByUserId: auth.userId,
        lines: {
          createMany: {
            data: [
              // A payable being settled has a Liability normal balance
              // (Credit) — debiting it here reduces what's owed, exactly
              // like principal reduction on a lease payment. An expense
              // has a Debit normal balance, so debiting it here is simply
              // recognizing the cost. Same debit side either way; only the
              // *meaning* differs, which is why one unified form works for
              // both without extra branching logic.
              { accountId, debit: amount, credit: 0, description },
              { accountId: cashMapping.accountId, debit: 0, credit: amount, description },
            ],
          },
        },
      },
      include: {
        lines: { include: { account: { select: { accountCode: true, accountName: true, accountType: true } } } },
      },
    });

    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
