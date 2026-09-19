import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit-log';
import type { UpdatePurchaseOrderInput } from '@/types/pharmacy';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { id } = await params;

    const purchaseOrder = await db.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        currency: true,
        requestedByUser: { select: { id: true, fullName: true, username: true } },
        approvedByUser: { select: { id: true, fullName: true, username: true } },
        items: { include: { product: true } },
        goodsReceipts: {
          include: {
            receivedByUser: { select: { id: true, fullName: true, username: true } },
            items: { include: { product: true, batch: true } },
          },
          orderBy: { receivedDate: 'desc' },
        },
      },
    });

    if (!purchaseOrder) {
      throw new PharmacyServiceError('Purchase order not found');
    }
    if (!(await canAccessBranch(db, auth, purchaseOrder.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }

    return NextResponse.json(purchaseOrder);
  } catch (error) {
    return handleApiError(error);
  }
}

// Editing (including replacing line items) is only allowed while the PO is
// still a DRAFT — once it's submitted for approval, the numbers need to stay
// stable for whoever is approving it.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { id } = await params;
    const body: UpdatePurchaseOrderInput = await request.json();

    const existing = await db.purchaseOrder.findUnique({ where: { id } });
    if (!existing) {
      throw new PharmacyServiceError('Purchase order not found');
    }
    if (!(await canAccessBranch(db, auth, existing.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }
    if (existing.status !== 'DRAFT') {
      throw new PharmacyServiceError(
        `Cannot edit a purchase order in ${existing.status} status — only DRAFT purchase orders can be edited`
      );
    }

    const updated = await db.$transaction(async (tx) => {
      if (body.items) {
        for (const item of body.items) {
          if (!item.productId || !item.quantityOrdered || item.quantityOrdered <= 0) {
            throw new PharmacyServiceError('Each item needs a productId and a positive quantityOrdered');
          }
          if (item.unitCost === undefined || item.unitCost < 0) {
            throw new PharmacyServiceError('Each item needs a non-negative unitCost');
          }
        }

        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });

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

        await tx.purchaseOrder.update({
          where: { id },
          data: {
            subtotalAmount,
            taxAmount,
            totalAmount: subtotalAmount + taxAmount,
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
        });
      }

      const result = await tx.purchaseOrder.update({
        where: { id },
        data: {
          supplierId: body.supplierId,
          expectedDeliveryDate: body.expectedDeliveryDate ? new Date(body.expectedDeliveryDate) : undefined,
          notes: body.notes,
        },
        include: { supplier: true, items: { include: { product: true } } },
      });

      await writeAuditLog(tx, {
        branchId: result.branchId,
        action: 'UPDATE_PURCHASE_ORDER',
        entityName: 'PurchaseOrder',
        entityId: id,
        details: { poNumber: result.poNumber },
      });

      return result;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
