import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';

// Same tier as every other cross-branch financial report (AP/AR Aging,
// Audit Log) — company-wide by nature, not something a single-branch
// Employee needs to see.
const CAN_VIEW_BUSINESS_ANALYSIS = ['ADMIN', 'MANAGER'];

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_VIEW_BUSINESS_ANALYSIS);
    if (roleError) return roleError;

    // Every query below is scoped to this list, not left unfiltered —
    // Sale and ProductBatch have no direct companyId of their own (only
    // Branch does), so "all my company's data" means "every branch that
    // belongs to my company," explicitly, never an unscoped query across
    // the whole database. (Worth knowing: a few of the OTHER existing
    // report routes — Income Statement among them — don't apply this
    // same scoping when an Admin/Manager omits branchId for a combined
    // view, which on a deployment with more than one real company is a
    // real gap, not just a theoretical one. Flagging it here since this
    // route was built right after finding it, not fixing it there too.)
    const companyBranches = await db.branch.findMany({
      where: { companyId: auth.companyId },
      select: { id: true },
    });
    const branchIds = companyBranches.map((b) => b.id);

    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [batches, sales] = await Promise.all([
      db.productBatch.findMany({
        where: { branchId: { in: branchIds }, quantityInStock: { gt: 0 } },
        select: { quantityInStock: true, purchasePrice: true, expiryDate: true },
      }),
      db.sale.findMany({
        where: { branchId: { in: branchIds }, saleDate: { gte: sixMonthsAgo } },
        select: { totalAmount: true, paymentMethod: true, saleDate: true },
      }),
    ]);

    // --- Inventory health: batch value bucketed by expiry status ---
    const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const inventoryHealth = { expired: 0, expiringSoon: 0, healthy: 0 };
    for (const batch of batches) {
      const value = batch.quantityInStock * batch.purchasePrice;
      if (batch.expiryDate < now) inventoryHealth.expired += value;
      else if (batch.expiryDate <= thirtyDaysOut) inventoryHealth.expiringSoon += value;
      else inventoryHealth.healthy += value;
    }

    // --- Sales trend: last 6 months, oldest first ---
    const monthBuckets: { label: string; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthBuckets.push({ label: `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`, total: 0 });
    }
    for (const sale of sales) {
      const monthsAgo =
        (now.getFullYear() - sale.saleDate.getFullYear()) * 12 + (now.getMonth() - sale.saleDate.getMonth());
      const index = 5 - monthsAgo;
      if (index >= 0 && index < 6) monthBuckets[index].total += sale.totalAmount;
    }

    // --- Payment method breakdown, same 6-month window ---
    const paymentMethodTotals = new Map<string, number>();
    for (const sale of sales) {
      paymentMethodTotals.set(sale.paymentMethod, (paymentMethodTotals.get(sale.paymentMethod) ?? 0) + sale.totalAmount);
    }

    return NextResponse.json({
      generatedAt: now,
      periodMonths: 6,
      inventoryHealth,
      salesTrend: monthBuckets,
      paymentMethodBreakdown: Array.from(paymentMethodTotals.entries()).map(([method, total]) => ({ method, total })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
