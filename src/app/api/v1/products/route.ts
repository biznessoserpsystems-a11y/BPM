import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import type { CreateProductInput } from '@/types/pharmacy';
import { getAuthPayload, isAuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const search = request.nextUrl.searchParams.get('search');

    const where = search
      ? {
          companyId: auth.companyId,
          OR: [
            { brandName: { contains: search } },
            { genericName: { contains: search } },
            { skuCode: { contains: search } },
          ],
        }
      : { companyId: auth.companyId };

    const products = await db.product.findMany({
      where,
      include: { batches: { take: 1 } },
      orderBy: { brandName: 'asc' },
    });

    return NextResponse.json(products);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const body: CreateProductInput = await request.json();

    if (!body.skuCode || !body.brandName || !body.genericName || !body.category || !body.dosageForm) {
      throw new PharmacyServiceError(
        'skuCode, brandName, genericName, category, and dosageForm are required'
      );
    }

    const product = await db.product.create({
      data: {
        companyId: auth.companyId,
        skuCode: body.skuCode,
        barcode: body.barcode,
        brandName: body.brandName,
        genericName: body.genericName,
        category: body.category,
        dosageForm: body.dosageForm,
        strength: body.strength,
        reorderLevel: body.reorderLevel ?? 10,
        isControlledSubstance: body.isControlledSubstance ?? false,
        isPrescriptionRequired: body.isPrescriptionRequired ?? true,
        taxRate: body.taxRate ?? 0,
      },
    });

    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
