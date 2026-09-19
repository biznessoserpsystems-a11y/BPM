import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import type { ReceiveBatchInput } from '@/types/pharmacy';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const branchId = request.nextUrl.searchParams.get('branchId');
    const productId = request.nextUrl.searchParams.get('productId');

    if (!branchId) {
      throw new PharmacyServiceError('branchId query parameter is required');
    }
    if (!(await canAccessBranch(db, auth, branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }

    const where: Record<string, unknown> = { branchId };
    if (productId) {
      where.productId = Number(productId);
    }

    const batches = await db.productBatch.findMany({
      where,
      include: {
        product: true,
        supplier: true,
      },
      orderBy: { receivedDate: 'desc' },
    });

    return NextResponse.json(batches);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const body: ReceiveBatchInput = await request.json();

    if (!body.branchId || !body.productId || !body.batchNumber || !body.expiryDate || !body.sellingPrice || !body.quantityReceived) {
      throw new PharmacyServiceError(
        'branchId, productId, batchNumber, expiryDate, sellingPrice, and quantityReceived are required'
      );
    }
    if (!(await canAccessBranch(db, auth, body.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }

    const batch = await db.productBatch.create({
      data: {
        branchId: body.branchId,
        productId: body.productId,
        supplierId: body.supplierId,
        batchNumber: body.batchNumber,
        expiryDate: new Date(body.expiryDate),
        purchasePrice: body.purchasePrice ?? 0,
        sellingPrice: body.sellingPrice,
        quantityReceived: body.quantityReceived,
        quantityInStock: body.quantityReceived,
      },
      include: { product: true, supplier: true },
    });

    return NextResponse.json(batch, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
