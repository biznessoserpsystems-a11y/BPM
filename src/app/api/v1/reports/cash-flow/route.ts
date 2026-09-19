import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch, getCompanyBranchIds } from '@/lib/branch-access';

/**
 * Cash Flow Statement for a date range, built around whichever account is
 * mapped to "CASH" (see Accounting → Chart of Accounts / GL mappings).
 *
 * This is a simplified cash flow report, not a full IAS 7 statement: IAS 7
 * requires classifying every cash movement into Operating, Investing, or
 * Financing activities, which needs a classification tag this schema
 * doesn't carry yet. What's here instead is the beginning/ending cash
 * balance for the period (which will always be exactly right, since it's
 * a direct read of the Cash account's own ledger balance) plus a
 * breakdown of what drove the change, grouped by the journal entry's
 * sourceType (SALE, PURCHASE, TRANSFER, etc.) as a practical proxy for
 * activity classification.
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

    const cashMapping = await db.gLAccountMapping.findUnique({
      where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'CASH' } },
      include: { account: true },
    });
    if (!cashMapping) {
      throw new PharmacyServiceError(
        'No account is mapped to "CASH" yet — set one via GL Account Mappings before running this report'
      );
    }

    const [priorLines, periodLines] = await Promise.all([
      db.journalLine.findMany({
        where: {
          accountId: cashMapping.accountId,
          journalEntry: { entryDate: { lt: startDate }, ...(branchId ? { branchId } : { branchId: { in: companyBranchIds } }) },
        },
      }),
      db.journalLine.findMany({
        where: {
          accountId: cashMapping.accountId,
          journalEntry: { entryDate: { gte: startDate, lte: endDate }, ...(branchId ? { branchId } : { branchId: { in: companyBranchIds } }) },
        },
        include: { journalEntry: { select: { sourceType: true } } },
      }),
    ]);

    // Cash is an asset — normal debit balance.
    const beginningBalance = priorLines.reduce((sum, l) => sum + (l.debit - l.credit), 0);

    const bySource = new Map<string, number>();
    for (const line of periodLines) {
      const key = line.journalEntry.sourceType;
      bySource.set(key, (bySource.get(key) ?? 0) + (line.debit - line.credit));
    }

    const activity = Array.from(bySource.entries())
      .map(([sourceType, netCashFlow]) => ({ sourceType, netCashFlow }))
      .sort((a, b) => b.netCashFlow - a.netCashFlow);

    const netChange = periodLines.reduce((sum, l) => sum + (l.debit - l.credit), 0);

    return NextResponse.json({
      startDate,
      endDate,
      cashAccount: { accountCode: cashMapping.account.accountCode, accountName: cashMapping.account.accountName },
      beginningBalance,
      netChange,
      endingBalance: beginningBalance + netChange,
      activity,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
