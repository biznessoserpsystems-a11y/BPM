import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch, getCompanyBranchIds } from '@/lib/branch-access';

interface TrialBalanceLine {
  accountId: number;
  accountCode: string;
  accountName: string;
  accountType: string;
  debitBalance: number;
  creditBalance: number;
}

/**
 * Trial Balance as of a single date: every account's cumulative debit/credit
 * activity, netted into whichever side matches its normal balance and shown
 * in the opposite column as zero. This is the raw check that should happen
 * before closing a period — unlike the Balance Sheet/Income Statement,
 * nothing here is reclassified (no retained-earnings roll-up); it's meant to
 * answer one question: does the whole ledger still balance?
 */
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const requestedBranchId = request.nextUrl.searchParams.get('branchId') ?? undefined;
    // Admin/Manager may view any branch (or omit branchId for a combined,
    // all-branches view). Other roles are confined to their own home
    // branch — if they ask for a different one, reject; if they don't
    // specify one at all, default to their own rather than silently
    // handing back every branch's combined financials.
    if (requestedBranchId && !(await canAccessBranch(db, auth, requestedBranchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }
    const branchId = requestedBranchId ?? (auth.roleName === 'ADMIN' || auth.roleName === 'MANAGER' ? undefined : auth.homeBranchId);
    const companyBranchIds = branchId ? undefined : await getCompanyBranchIds(db, auth.companyId);
    const asOfDate = request.nextUrl.searchParams.get('asOfDate')
      ? new Date(request.nextUrl.searchParams.get('asOfDate')!)
      : new Date();

    const lines = await db.journalLine.findMany({
      where: {
        journalEntry: {
          entryDate: { lte: asOfDate },
          ...(branchId ? { branchId } : { branchId: { in: companyBranchIds } }),
        },
      },
      include: { account: true },
    });

    const byAccount = new Map<number, TrialBalanceLine & { net: number }>();
    for (const line of lines) {
      const { account } = line;
      const existing = byAccount.get(account.id) ?? {
        accountId: account.id,
        accountCode: account.accountCode,
        accountName: account.accountName,
        accountType: account.accountType,
        debitBalance: 0,
        creditBalance: 0,
        net: 0,
      };
      existing.net += line.debit - line.credit;
      byAccount.set(account.id, existing);
    }

    const rows: TrialBalanceLine[] = Array.from(byAccount.values())
      .filter((a) => Math.abs(a.net) > 0.005)
      .map((a) => ({
        accountId: a.accountId,
        accountCode: a.accountCode,
        accountName: a.accountName,
        accountType: a.accountType,
        // A net debit balance shows in the debit column, net credit in the
        // credit column — whichever side the account actually sits on,
        // regardless of its "normal" balance, so an account that's gone
        // unexpectedly negative is still visible rather than hidden.
        debitBalance: a.net > 0 ? a.net : 0,
        creditBalance: a.net < 0 ? -a.net : 0,
      }))
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    const totalDebits = rows.reduce((sum, r) => sum + r.debitBalance, 0);
    const totalCredits = rows.reduce((sum, r) => sum + r.creditBalance, 0);

    return NextResponse.json({
      asOfDate,
      rows,
      totalDebits,
      totalCredits,
      difference: totalDebits - totalCredits,
      isBalanced: Math.abs(totalDebits - totalCredits) <= 0.005,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
