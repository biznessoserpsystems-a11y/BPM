import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit-log';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { id } = await params;
    const { userId } = await request.json();

    if (!userId) {
      throw new PharmacyServiceError('userId is required');
    }
    if (userId !== auth.userId) {
      throw new PharmacyServiceError('You can only perform this action as yourself');
    }

    const transfer = await db.$transaction(async (tx) => {
      const existing = await tx.interBranchTransfer.findUnique({ where: { id } });
      if (!existing) {
        throw new PharmacyServiceError('Transfer not found');
      }
      if (!(await canAccessBranch(tx, auth, existing.sourceBranchId)) || !(await canAccessBranch(tx, auth, existing.destinationBranchId))) {
        throw new PharmacyServiceError("You do not have access to one of these branches");
      }
      if (existing.status === 'RECEIVED' || existing.status === 'CANCELLED' || existing.status === 'REJECTED') {
        throw new PharmacyServiceError(`Transfer cannot be cancelled. Current status: ${existing.status}`);
      }

      // Release reserved stock if already approved
      if (
        existing.status === 'APPROVED' || existing.status === 'DISPATCHED'
      ) {
        if (existing.sourceBatchId) {
          await tx.productBatch.update({
            where: { id: existing.sourceBatchId },
            data: { quantityInStock: { increment: existing.approvedQty } },
          });
        }
      }

      const updated = await tx.interBranchTransfer.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: {
          product: true,
          sourceBatch: { include: { product: true } },
          requestedByUser: { select: { id: true, fullName: true, username: true } },
          approvedByUser: { select: { id: true, fullName: true, username: true } },
        },
      });

      await writeAuditLog(tx, {
        branchId: existing.sourceBranchId,
        userId,
        action: 'CANCEL_TRANSFER',
        entityName: 'InterBranchTransfer',
        entityId: id,
        details: { transferCode: existing.transferCode },
      });

      return updated;
    });

    return NextResponse.json(transfer);
  } catch (error) {
    return handleApiError(error);
  }
}
