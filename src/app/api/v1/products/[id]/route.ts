import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import type { UpdateProductInput } from '@/types/pharmacy';
import { getAuthPayload, isAuthError } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { id } = await params;
    const product = await db.product.findUnique({
      where: { id: Number(id) },
      include: { batches: true },
    });

    if (!product || product.companyId !== auth.companyId) {
      throw new PharmacyServiceError('Product not found');
    }

    return NextResponse.json(product);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { id } = await params;
    const body: UpdateProductInput = await request.json();

    const product = await db.product.findUnique({
      where: { id: Number(id) },
    });

    if (!product || product.companyId !== auth.companyId) {
      throw new PharmacyServiceError('Product not found');
    }

    const updated = await db.product.update({
      where: { id: Number(id) },
      data: {
        brandName: body.brandName,
        genericName: body.genericName,
        category: body.category,
        dosageForm: body.dosageForm,
        strength: body.strength,
        reorderLevel: body.reorderLevel,
        isControlledSubstance: body.isControlledSubstance,
        isPrescriptionRequired: body.isPrescriptionRequired,
        taxRate: body.taxRate,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
