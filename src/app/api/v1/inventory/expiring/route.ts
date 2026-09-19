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
    const withinDaysParam = request.nextUrl.searchParams.get('withinDays');
    const withinDays = withinDaysParam ? Number(withinDaysParam) : 30;

    if (!branchId) {
      throw new PharmacyServiceError('branchId query parameter is required');
    }
    if (!(await canAccessBranch(db, auth, branchId))) {
      throw new PharmacyServiceError('You do not have access to this branch\'s data');
    }

    const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);

    const batches = await db.productBatch.findMany({
      where: {
        branchId,
        quantityInStock: { gt: 0 },
        expiryDate: { lte: cutoff },
      },
      include: {
        product: true,
      },
      orderBy: { expiryDate: 'asc' },
    });

    const now = Date.now();
    const expiringItems = batches.map((batch) => ({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      productId: batch.productId,
      brandName: batch.product.brandName,
      genericName: batch.product.genericName,
      currentQty: batch.quantityInStock,
      expiryDate: batch.expiryDate,
      daysUntilExpiry: Math.ceil((new Date(batch.expiryDate).getTime() - now) / (24 * 60 * 60 * 1000)),
    }));

    return NextResponse.json(expiringItems);
  } catch (error) {
    return handleApiError(error);
  }
}
