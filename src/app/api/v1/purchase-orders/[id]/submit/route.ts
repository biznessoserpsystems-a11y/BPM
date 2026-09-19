import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit-log';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';

// DRAFT -> SUBMITTED. Locks the PO's line items and sends it for approval.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { id } = await params;

    const po = await db.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!po) {
      throw new PharmacyServiceError('Purchase order not found');
    }
    if (!(await canAccessBranch(db, auth, po.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }
    if (po.status !== 'DRAFT') {
      throw new PharmacyServiceError(`Only DRAFT purchase orders can be submitted (current status: ${po.status})`);
    }
    if (po.items.length === 0) {
      throw new PharmacyServiceError('Cannot submit a purchase order with no line items');
    }

    const updated = await db.$transaction(async (tx) => {
      const result = await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'SUBMITTED' },
        include: { supplier: true, items: { include: { product: true } } },
      });

      await writeAuditLog(tx, {
        branchId: po.branchId,
        action: 'SUBMIT_PURCHASE_ORDER',
        entityName: 'PurchaseOrder',
        entityId: id,
        details: { poNumber: po.poNumber },
      });

      return result;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
