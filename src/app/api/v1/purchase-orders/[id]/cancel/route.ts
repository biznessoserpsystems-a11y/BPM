import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit-log';
import type { CancelPurchaseOrderInput } from '@/types/pharmacy';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';

const CANCELLABLE_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'];

// Any pre-RECEIVED state -> CANCELLED. A partially received PO can still be
// cancelled (e.g. supplier can't fulfil the rest) — the stock already
// received stays in Stores; only the outstanding balance is void.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { id } = await params;
    const body: CancelPurchaseOrderInput = await request.json();

    if (!body.cancelledByUserId || !body.reason) {
      throw new PharmacyServiceError('cancelledByUserId and reason are required');
    }
    if (body.cancelledByUserId !== auth.userId) {
      throw new PharmacyServiceError('You can only cancel a purchase order as yourself');
    }

    const po = await db.purchaseOrder.findUnique({ where: { id } });
    if (!po) {
      throw new PharmacyServiceError('Purchase order not found');
    }
    if (!(await canAccessBranch(db, auth, po.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }
    if (!CANCELLABLE_STATUSES.includes(po.status)) {
      throw new PharmacyServiceError(`Purchase order in ${po.status} status cannot be cancelled`);
    }

    const updated = await db.$transaction(async (tx) => {
      const result = await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledReason: body.reason },
        include: { supplier: true, items: { include: { product: true } } },
      });

      await writeAuditLog(tx, {
        branchId: po.branchId,
        userId: body.cancelledByUserId,
        action: 'CANCEL_PURCHASE_ORDER',
        entityName: 'PurchaseOrder',
        entityId: id,
        details: { poNumber: po.poNumber, reason: body.reason, previousStatus: po.status },
      });

      return result;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
