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
 * Multi-step Income Statement for a date range:
 *
 *   Sales
 *   Sales Returns
 *   = Net Sales
 *   Cost of Goods Sold
 *   = Gross Profit
 *   Expenses (everything else)
 *   = Net Income
 *
 * Cost of Goods Sold is singled out by matching the account currently
 * mapped to the "COGS" key (Settings → GL Mappings) — the same mapping
 * every automated COGS posting (a POS sale's cost side) already goes
 * through, so this is a reliable way to separate it from other expense
 * accounts without depending on free-text sub-type labels that may or
 * may not have been set consistently on the Chart of Accounts.
 *
 * "Sales Returns" has no posting mechanism anywhere in this app yet — no
 * feature currently credits it — so it's included in the structure (as
 * requested) but will always compute to 0 until a returns/refunds feature
 * exists to post against it. This is deliberately not faked.
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
    // "Combined, all-branches" (branchId omitted) means all of MY
    // company's branches, never an unscoped query — journal entries
    // have no direct companyId of their own, so leaving this out
    // entirely would have pulled every company's data on a shared
    // deployment into the same "combined" report.
    const companyBranchIds = branchId ? undefined : await getCompanyBranchIds(db, auth.companyId);
    const now = new Date();
    const startDate = request.nextUrl.searchParams.get('startDate')
      ? new Date(request.nextUrl.searchParams.get('startDate')!)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = request.nextUrl.searchParams.get('endDate')
      ? new Date(request.nextUrl.searchParams.get('endDate')!)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    if (startDate > endDate) {
      throw new PharmacyServiceError('startDate must be before endDate');
    }

    const cogsMapping = await db.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'COGS' } } });
    const salesReturnsMapping = await db.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'SALES_RETURNS' } } });

    const lines = await db.journalLine.findMany({
      where: {
        journalEntry: {
          entryDate: { gte: startDate, lte: endDate },
          ...(branchId ? { branchId } : { branchId: { in: companyBranchIds } }),
        },
        account: { accountType: { in: ['REVENUE', 'EXPENSE'] } },
      },
      include: { account: true },
    });

    const revenueByAccount = new Map<number, AccountLine>();
    const cogsByAccount = new Map<number, AccountLine>();
    const expenseByAccount = new Map<number, AccountLine>();
    let salesReturns = 0;

    for (const line of lines) {
      // Sales Returns is a contra-revenue account — carved out from
      // ordinary Sales the same way COGS is carved out of ordinary
      // Expenses below, via the account currently mapped to it (Settings
      // → GL Mappings), not by account type alone (it's still a REVENUE-
      // type account, just with a debit — not credit — normal balance).
      if (salesReturnsMapping?.accountId === line.account.id) {
        salesReturns += line.debit - line.credit;
        continue;
      }

      const isCogsAccount = cogsMapping?.accountId === line.account.id;
      const bucket =
        line.account.accountType === 'REVENUE'
          ? revenueByAccount
          : isCogsAccount
            ? cogsByAccount
            : expenseByAccount;

      const existing = bucket.get(line.account.id) ?? {
        accountId: line.account.id,
        accountCode: line.account.accountCode,
        accountName: line.account.accountName,
        amount: 0,
      };
      // Revenue: credit increases it. Expense (including COGS): debit increases it.
      existing.amount +=
        line.account.accountType === 'REVENUE' ? line.credit - line.debit : line.debit - line.credit;
      bucket.set(line.account.id, existing);
    }

    const sales = Array.from(revenueByAccount.values()).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    const cogsLines = Array.from(cogsByAccount.values()).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    const expenses = Array.from(expenseByAccount.values()).sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    const totalSales = sales.reduce((sum, r) => sum + r.amount, 0);
    const netSales = totalSales - salesReturns;
    const totalCogs = cogsLines.reduce((sum, c) => sum + c.amount, 0);
    const grossProfit = netSales - totalCogs;
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const netIncome = grossProfit - totalExpenses;

    return NextResponse.json({
      startDate,
      endDate,
      sales,
      totalSales,
      salesReturns,
      netSales,
      cogsAccountConfigured: !!cogsMapping,
      salesReturnsAccountConfigured: !!salesReturnsMapping,
      cogsLines,
      totalCogs,
      grossProfit,
      expenses,
      totalExpenses,
      netIncome,
      // Kept for compatibility with anything still reading the older,
      // pre-restructure shape (revenue/totalRevenue meant the same as
      // sales/totalSales when there was no separate COGS/Gross Profit step).
      revenue: sales,
      totalRevenue: totalSales,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
