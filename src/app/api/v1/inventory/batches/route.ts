import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import type { ReceiveBatchInput } from '@/types/pharmacy';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { writeAuditLog } from '@/lib/audit-log';
import { costPerBaseUnit, resolveReceivingUnit, toBaseQuantity } from '@/lib/product-units';

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

    // The product must be one of the caller's own company's (this was never
    // checked: stock could be received against another company's product).
    const product = await db.product.findFirst({
      where: { id: body.productId, companyId: auth.companyId },
      select: { id: true },
    });
    if (!product) {
      throw new PharmacyServiceError('Product not found');
    }

    // Stock is always stored in the product's BASE unit. If the quantity was
    // entered in a packaging unit ("5 boxes", 1 box = 10 pieces) it's
    // converted HERE, on the server, from the product's saved setup — the
    // client's arithmetic is only ever a preview. The purchase price is
    // quoted per receiving unit and becomes a per-base-unit cost; the selling
    // price is per base unit already (it's what the till sells by).
    const { batch, unit, baseQuantity } = await db.$transaction(async (tx) => {
      const unit = await resolveReceivingUnit(tx, product.id, {
        unit: body.receivingUnit,
        define: body.defineUnit,
      });
      const baseQuantity = toBaseQuantity(body.quantityReceived, unit.unitsPer);
      const costPerBase = costPerBaseUnit(body.purchasePrice ?? 0, unit.unitsPer);

      const batch = await tx.productBatch.create({
        data: {
          branchId: body.branchId,
          productId: product.id,
          supplierId: body.supplierId,
          batchNumber: body.batchNumber,
          expiryDate: new Date(body.expiryDate),
          purchasePrice: costPerBase,
          sellingPrice: body.sellingPrice,
          quantityReceived: baseQuantity,
          quantityInStock: baseQuantity,
        },
        include: { product: true, supplier: true },
      });

      // Only worth a trail when a conversion actually happened.
      if (unit.unitsPer !== 1) {
        await writeAuditLog(tx, {
          branchId: body.branchId,
          userId: auth.userId,
          action: 'RECEIVE_BATCH_IN_PACKS',
          entityName: 'ProductBatch',
          entityId: String(batch.id),
          details: {
            received: `${body.quantityReceived} ${unit.unit}`,
            unitsPerPack: unit.unitsPer,
            addedToStock: `${baseQuantity} ${unit.baseUnit}`,
            purchasePricePerUnit: body.purchasePrice ?? 0,
            costPerBaseUnit: costPerBase,
          },
        });
      }
      return { batch, unit, baseQuantity };
    });

    // The batch, plus a plain description of what was converted so the form
    // can tell the person exactly what went into stock.
    return NextResponse.json(
      {
        ...batch,
        received: {
          quantity: body.quantityReceived,
          unit: unit.unit,
          unitsPer: unit.unitsPer,
          baseQuantity,
          baseUnit: unit.baseUnit,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
