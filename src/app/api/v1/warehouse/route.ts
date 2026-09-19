import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';

const EXPIRING_SOON_DAYS = 30;

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const branchId = request.nextUrl.searchParams.get('branchId');
    if (!branchId) {
      throw new PharmacyServiceError('branchId query parameter is required');
    }
    if (!(await canAccessBranch(db, auth, branchId))) {
      throw new PharmacyServiceError('You do not have access to this branch\'s data');
    }

    // Pull every in-stock batch at this branch once, then aggregate per
    // product in JS — same query-builder-over-raw-SQL approach used by
    // /api/v1/inventory/low-stock, for the same reasons (type safety,
    // no driver-specific SQL quirks).
    const [batches, products] = await Promise.all([
      db.productBatch.findMany({
        where: { branchId, quantityInStock: { gt: 0 } },
        select: { productId: true, quantityInStock: true, purchasePrice: true, expiryDate: true },
      }),
      db.product.findMany({
        where: { companyId: auth.companyId },
        select: { id: true, skuCode: true, brandName: true, genericName: true, category: true, reorderLevel: true },
      }),
    ]);

    const byProduct = new Map<
      number,
      { totalQuantity: number; totalValue: number; nearestExpiryDate: Date | null; batchCount: number }
    >();

    for (const b of batches) {
      const existing = byProduct.get(b.productId) ?? {
        totalQuantity: 0,
        totalValue: 0,
        nearestExpiryDate: null as Date | null,
        batchCount: 0,
      };
      existing.totalQuantity += b.quantityInStock;
      existing.totalValue += b.quantityInStock * b.purchasePrice;
      existing.batchCount += 1;
      if (!existing.nearestExpiryDate || b.expiryDate < existing.nearestExpiryDate) {
        existing.nearestExpiryDate = b.expiryDate;
      }
      byProduct.set(b.productId, existing);
    }

    const expiringCutoff = new Date();
    expiringCutoff.setDate(expiringCutoff.getDate() + EXPIRING_SOON_DAYS);

    const shelves = products
      .map((p) => {
        const agg = byProduct.get(p.id) ?? { totalQuantity: 0, totalValue: 0, nearestExpiryDate: null, batchCount: 0 };
        return {
          productId: p.id,
          skuCode: p.skuCode,
          brandName: p.brandName,
          genericName: p.genericName,
          category: p.category,
          reorderLevel: p.reorderLevel,
          totalQuantity: agg.totalQuantity,
          totalValue: agg.totalValue,
          nearestExpiryDate: agg.nearestExpiryDate,
          batchCount: agg.batchCount,
          isLowStock: agg.totalQuantity <= p.reorderLevel,
          isExpiringSoon: agg.nearestExpiryDate != null && agg.nearestExpiryDate <= expiringCutoff,
          isEmpty: agg.totalQuantity === 0,
        };
      })
      // Show what's actually on the shelf first; empty shelves last, since
      // there's nothing to inspect there beyond "reorder this."
      .sort((a, b) => b.totalQuantity - a.totalQuantity);

    return NextResponse.json(shelves);
  } catch (error) {
    return handleApiError(error);
  }
}
