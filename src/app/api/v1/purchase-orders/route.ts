import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit-log';
import type { CreatePurchaseOrderInput } from '@/types/pharmacy';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch, getCompanyBranchIds } from '@/lib/branch-access';

async function generatePoNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await db.purchaseOrder.count({
    where: { poNumber: { startsWith: `PO-${year}-` } },
  });
  return `PO-${year}-${String(count + 1).padStart(5, '0')}`;
}

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const branchId = request.nextUrl.searchParams.get('branchId');
    const status = request.nextUrl.searchParams.get('status');
    const supplierId = request.nextUrl.searchParams.get('supplierId');

    if (branchId && !(await canAccessBranch(db, auth, branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }
    const companyBranchIds = branchId ? undefined : await getCompanyBranchIds(db, auth.companyId);

    const where: Record<string, unknown> = branchId ? { branchId } : { branchId: { in: companyBranchIds } };
    if (status) where.status = status;
    if (supplierId) where.supplierId = Number(supplierId);

    const purchaseOrders = await db.purchaseOrder.findMany({
      where,
      include: {
        supplier: true,
        currency: true,
        requestedByUser: { select: { id: true, fullName: true, username: true } },
        approvedByUser: { select: { id: true, fullName: true, username: true } },
        items: { include: { product: true } },
        _count: { select: { goodsReceipts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(purchaseOrders);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const body: CreatePurchaseOrderInput = await request.json();

    if (!body.branchId || !body.supplierId || !body.requestedByUserId || !body.items?.length) {
      throw new PharmacyServiceError(
        'branchId, supplierId, requestedByUserId, and items are required'
      );
    }
    if (!(await canAccessBranch(db, auth, body.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }
    if (body.requestedByUserId !== auth.userId) {
      throw new PharmacyServiceError('You can only create a purchase order as yourself');
    }

    for (const item of body.items) {
      if (!item.productId || !item.quantityOrdered || item.quantityOrdered <= 0) {
        throw new PharmacyServiceError('Each item needs a productId and a positive quantityOrdered');
      }
      if (item.unitCost === undefined || item.unitCost < 0) {
        throw new PharmacyServiceError('Each item needs a non-negative unitCost');
      }
    }

    const poNumber = await generatePoNumber();

    // Compute per-line and order-level totals up front so the PO carries a
    // reliable snapshot even if product prices change later.
    const lineItems = body.items.map((item) => {
      const lineSubtotal = item.quantityOrdered * item.unitCost;
      return {
        productId: item.productId,
        quantityOrdered: item.quantityOrdered,
        unitCost: item.unitCost,
        taxRate: item.taxRate ?? 0,
        subtotal: lineSubtotal,
        tax: lineSubtotal * ((item.taxRate ?? 0) / 100),
      };
    });
    const subtotalAmount = lineItems.reduce((sum, l) => sum + l.subtotal, 0);
    const taxAmount = lineItems.reduce((sum, l) => sum + l.tax, 0);
    const totalAmount = subtotalAmount + taxAmount;

    const purchaseOrder = await db.$transaction(async (tx) => {
      const newPo = await tx.purchaseOrder.create({
        data: {
          poNumber,
          branchId: body.branchId,
          supplierId: body.supplierId,
          currencyId: body.currencyId,
          exchangeRate: body.exchangeRate ?? 1.0,
          expectedDeliveryDate: body.expectedDeliveryDate ? new Date(body.expectedDeliveryDate) : undefined,
          notes: body.notes,
          subtotalAmount,
          taxAmount,
          totalAmount,
          requestedByUserId: body.requestedByUserId,
          items: {
            create: lineItems.map((l) => ({
              productId: l.productId,
              quantityOrdered: l.quantityOrdered,
              unitCost: l.unitCost,
              taxRate: l.taxRate,
              subtotal: l.subtotal,
            })),
          },
        },
        include: {
          supplier: true,
          items: { include: { product: true } },
        },
      });

      await writeAuditLog(tx, {
        branchId: body.branchId,
        userId: body.requestedByUserId,
        action: 'CREATE_PURCHASE_ORDER',
        entityName: 'PurchaseOrder',
        entityId: newPo.id,
        details: { poNumber, supplierId: body.supplierId, totalAmount, itemCount: body.items.length },
      });

      return newPo;
    });

    return NextResponse.json(purchaseOrder, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
