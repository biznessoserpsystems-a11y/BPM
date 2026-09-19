import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';

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

    // Sum in-stock quantity per product at this branch (via Prisma's query
    // builder rather than raw SQL — safer across schema/driver changes and
    // fully type-checked), then join against each product's reorder level
    // and keep only the ones at or below it.
    const stockByProduct = await db.productBatch.groupBy({
      by: ['productId'],
      where: { branchId, quantityInStock: { gt: 0 } },
      _sum: { quantityInStock: true },
    });

    const products = await db.product.findMany({
      where: { companyId: auth.companyId },
      select: { id: true, skuCode: true, brandName: true, genericName: true, reorderLevel: true },
    });

    const stockByProductId = new Map(stockByProduct.map((s) => [s.productId, s._sum.quantityInStock ?? 0]));

    const lowStockProducts = products
      .map((p) => ({
        productId: p.id,
        skuCode: p.skuCode,
        brandName: p.brandName,
        genericName: p.genericName,
        totalQty: stockByProductId.get(p.id) ?? 0,
        reorderLevel: p.reorderLevel,
      }))
      .filter((p) => p.totalQty <= p.reorderLevel)
      .sort((a, b) => a.totalQty - b.totalQty);

    return NextResponse.json(lowStockProducts);
  } catch (error) {
    return handleApiError(error);
  }
}
