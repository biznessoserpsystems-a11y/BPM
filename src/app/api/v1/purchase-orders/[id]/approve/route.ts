import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit-log';
import type { ApprovePurchaseOrderInput } from '@/types/pharmacy';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { resolveRequiredApprovalRoles, canApprove } from '@/lib/approval';

// SUBMITTED -> APPROVED. Records who signed off and when.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { id } = await params;
    const body: ApprovePurchaseOrderInput = await request.json();

    if (!body.approvedByUserId) {
      throw new PharmacyServiceError('approvedByUserId is required');
    }
    if (body.approvedByUserId !== auth.userId) {
      throw new PharmacyServiceError('You can only approve a purchase order as yourself');
    }

    const po = await db.purchaseOrder.findUnique({ where: { id } });
    if (!po) {
      throw new PharmacyServiceError('Purchase order not found');
    }
    if (!(await canAccessBranch(db, auth, po.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }
    if (po.status !== 'SUBMITTED') {
      throw new PharmacyServiceError(`Only SUBMITTED purchase orders can be approved (current status: ${po.status})`);
    }

    const requiredRoles = await resolveRequiredApprovalRoles(db, 'PURCHASE_ORDER', po.totalAmount);
    if (!canApprove(auth.roleName, requiredRoles)) {
      throw new PharmacyServiceError(
        `This purchase order's amount requires approval from: ${requiredRoles.join(' or ')} (your role: ${auth.roleName})`
      );
    }

    const updated = await db.$transaction(async (tx) => {
      const result = await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedByUserId: body.approvedByUserId,
          approvedAt: new Date(),
        },
        include: { supplier: true, items: { include: { product: true } } },
      });

      await writeAuditLog(tx, {
        branchId: po.branchId,
        userId: body.approvedByUserId,
        action: 'APPROVE_PURCHASE_ORDER',
        entityName: 'PurchaseOrder',
        entityId: id,
        details: { poNumber: po.poNumber, totalAmount: po.totalAmount },
      });

      return result;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
