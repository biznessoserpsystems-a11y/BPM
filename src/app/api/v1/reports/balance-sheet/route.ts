import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch, getCompanyBranchIds } from '@/lib/branch-access';

interface AccountLine {
  accountId: number;
  accountCode: string;
  accountName: string;
  amount: number;
}

/**
 * Balance Sheet as of a single date: cumulative balances from the
 * beginning of the ledger up to (and including) that date — not just the
 * activity within a period, since asset/liability/equity balances are
 * running totals, not period totals.
 *
 * Revenue and Expense accounts aren't balance sheet accounts, but their
 * net effect (net income) has to roll into Equity as "Retained Earnings"
 * for Assets = Liabilities + Equity to actually hold — otherwise a single
 * balanced sale (debit Cash, credit Revenue) would leave the balance sheet
 * itself looking unbalanced, since Revenue never appears on it directly.
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

    const byType: Record<string, Map<number, AccountLine>> = {
      ASSET: new Map(),
      LIABILITY: new Map(),
      EQUITY: new Map(),
    };
    let cumulativeRevenue = 0;
    let cumulativeExpenses = 0;

    for (const line of lines) {
      const { accountType } = line.account;

      if (accountType === 'REVENUE') {
        cumulativeRevenue += line.credit - line.debit;
        continue;
      }
      if (accountType === 'EXPENSE') {
        cumulativeExpenses += line.debit - line.credit;
        continue;
      }

      const bucket = byType[accountType];
      if (!bucket) continue; // unrecognized account type — skip rather than throw

      const existing = bucket.get(line.account.id) ?? {
        accountId: line.account.id,
        accountCode: line.account.accountCode,
        accountName: line.account.accountName,
        amount: 0,
      };
      // Assets: normal debit balance. Liabilities & Equity: normal credit balance.
      existing.amount += accountType === 'ASSET' ? line.debit - line.credit : line.credit - line.debit;
      bucket.set(line.account.id, existing);
    }

    const assets = Array.from(byType.ASSET.values()).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    const liabilities = Array.from(byType.LIABILITY.values()).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    const equity = Array.from(byType.EQUITY.values()).sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    const retainedEarnings = cumulativeRevenue - cumulativeExpenses;
    const totalAssets = assets.reduce((sum, a) => sum + a.amount, 0);
    const totalLiabilities = liabilities.reduce((sum, l) => sum + l.amount, 0);
    const totalEquityAccounts = equity.reduce((sum, e) => sum + e.amount, 0);
    const totalEquity = totalEquityAccounts + retainedEarnings;

    return NextResponse.json({
      asOfDate,
      assets,
      liabilities,
      equity,
      retainedEarnings,
      totalAssets,
      totalLiabilities,
      totalEquity,
      // Should be ~0 for a correctly balanced ledger — surfaced so the UI
      // can flag it if something's off (e.g. an unbalanced manual entry
      // somehow got through, or accounts are misclassified).
      difference: totalAssets - (totalLiabilities + totalEquity),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
