import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit-log';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';

// APPROVED -> ORDERED. Marks that the order has actually been placed with
// the supplier (PO sent / confirmed) — still no stock exists yet.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { id } = await params;

    const po = await db.purchaseOrder.findUnique({ where: { id } });
    if (!po) {
      throw new PharmacyServiceError('Purchase order not found');
    }
    if (!(await canAccessBranch(db, auth, po.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }
    if (po.status !== 'APPROVED') {
      throw new PharmacyServiceError(`Only APPROVED purchase orders can be marked as ordered (current status: ${po.status})`);
    }

    const updated = await db.$transaction(async (tx) => {
      const result = await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'ORDERED' },
        include: { supplier: true, items: { include: { product: true } } },
      });

      await writeAuditLog(tx, {
        branchId: po.branchId,
        action: 'MARK_PURCHASE_ORDER_ORDERED',
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
