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

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [
      salesResult,
      lowStockProductCount,
      expiringSoonCount,
      pendingTransfers,
      activePrescriptions,
      recentSales,
    ] = await Promise.all([
      // Sales today
      db.sale.groupBy({
        by: ['branchId'],
        where: {
          branchId,
          saleDate: { gte: todayStart, lte: todayEnd },
        },
        _count: true,
        _sum: { totalAmount: true },
      }),
      // Low stock products at this branch — via Prisma's query builder
      // rather than raw SQL, same approach as /api/v1/inventory/low-stock.
      (async () => {
        const [stockByProduct, products] = await Promise.all([
          db.productBatch.groupBy({
            by: ['productId'],
            where: { branchId, quantityInStock: { gt: 0 } },
            _sum: { quantityInStock: true },
          }),
          db.product.findMany({ where: { companyId: auth.companyId }, select: { id: true, reorderLevel: true } }),
        ]);
        const stockByProductId = new Map(stockByProduct.map((s) => [s.productId, s._sum.quantityInStock ?? 0]));
        return products.filter((p) => (stockByProductId.get(p.id) ?? 0) <= p.reorderLevel).length;
      })(),
      // Batches expiring within 30 days
      db.productBatch.count({
        where: {
          branchId,
          quantityInStock: { gt: 0 },
          expiryDate: {
            lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        },
      }),
      // Pending transfers
      db.interBranchTransfer.count({
        where: {
          status: 'REQUESTED',
          OR: [{ sourceBranchId: branchId }, { destinationBranchId: branchId }],
        },
      }),
      // Active prescriptions (refills remaining and not expired)
      db.prescription.count({
        where: {
          items: {
            some: {
              refillsRemaining: { gt: 0 },
            },
          },
          expiryDate: { gte: new Date() },
        },
      }),
      // Recent sales (last 10)
      db.sale.findMany({
        where: { branchId },
        orderBy: { saleDate: 'desc' },
        take: 10,
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          paymentMethod: true,
          customerName: true,
          saleDate: true,
        },
      }),
    ]);

    const salesToday = salesResult[0]?._count ?? 0;
    const salesTodayAmount = salesResult[0]?._sum.totalAmount ?? 0;

    return NextResponse.json({
      salesToday,
      salesTodayAmount,
      lowStockCount: lowStockProductCount,
      expiringSoonCount,
      pendingTransfers,
      activePrescriptions,
      recentSales,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
