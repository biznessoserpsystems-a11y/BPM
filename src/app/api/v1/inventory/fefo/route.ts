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
    const productId = request.nextUrl.searchParams.get('productId');

    if (!branchId || !productId) {
      throw new PharmacyServiceError('branchId and productId query parameters are required');
    }
    if (!(await canAccessBranch(db, auth, branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }

    // FEFO: First Expired, First Out — order by expiryDate ASC
    const batches = await db.productBatch.findMany({
      where: {
        branchId,
        productId: Number(productId),
        quantityInStock: { gt: 0 },
      },
      include: { product: true },
      orderBy: { expiryDate: 'asc' },
    });

    return NextResponse.json(batches);
  } catch (error) {
    return handleApiError(error);
  }
}
