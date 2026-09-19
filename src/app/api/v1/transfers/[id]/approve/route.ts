import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit-log';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { resolveRequiredApprovalRoles, canApprove } from '@/lib/approval';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { id } = await params;
    const { sourceBatchId, approvedQty, approvedByUserId } = await request.json();

    if (!sourceBatchId || !approvedQty || !approvedByUserId) {
      throw new PharmacyServiceError('sourceBatchId, approvedQty, and approvedByUserId are required');
    }
    if (approvedByUserId !== auth.userId) {
      throw new PharmacyServiceError('You can only approve a transfer as yourself');
    }

    const transfer = await db.$transaction(async (tx) => {
      const existing = await tx.interBranchTransfer.findUnique({ where: { id } });
      if (!existing) {
        throw new PharmacyServiceError('Transfer not found');
      }
      if (!(await canAccessBranch(tx, auth, existing.sourceBranchId)) || !(await canAccessBranch(tx, auth, existing.destinationBranchId))) {
        throw new PharmacyServiceError("You do not have access to one of these branches");
      }
      if (existing.status !== 'REQUESTED') {
        throw new PharmacyServiceError(`Transfer cannot be approved. Current status: ${existing.status}`);
      }

      // Verify source batch has enough stock
      const batch = await tx.productBatch.findUnique({ where: { id: sourceBatchId } });
      if (!batch) {
        throw new PharmacyServiceError('Source batch not found');
      }
      if (batch.branchId !== existing.sourceBranchId) {
        throw new PharmacyServiceError('Source batch does not belong to the transfer source branch');
      }
      if (batch.productId !== existing.productId) {
        throw new PharmacyServiceError('Source batch does not match the transfer product');
      }
      if (batch.quantityInStock < approvedQty) {
        throw new PharmacyServiceError(
          `Insufficient stock in source batch. Available: ${batch.quantityInStock}, Requested: ${approvedQty}`
        );
      }

      // Same tiered approval mechanism as Purchase Orders (Settings ->
      // Approval Workflow) — the amount basis here is the value of stock
      // being transferred, not just the raw quantity, so a threshold rule
      // means the same thing in both places.
      const transferValue = batch.purchasePrice * approvedQty;
      const requiredRoles = await resolveRequiredApprovalRoles(tx, 'TRANSFER', transferValue);
      if (!canApprove(auth.roleName, requiredRoles)) {
        throw new PharmacyServiceError(
          `This transfer's value requires approval from: ${requiredRoles.join(' or ')} (your role: ${auth.roleName})`
        );
      }

      // Decrement source batch stock (reserve it)
      await tx.productBatch.update({
        where: { id: sourceBatchId },
        data: { quantityInStock: { decrement: approvedQty } },
      });

      // Update transfer
      const updated = await tx.interBranchTransfer.update({
        where: { id },
        data: {
          status: 'APPROVED',
          sourceBatchId,
          approvedQty,
          approvedByUserId,
        },
        include: {
          product: true,
          sourceBatch: { include: { product: true } },
          requestedByUser: { select: { id: true, fullName: true, username: true } },
          approvedByUser: { select: { id: true, fullName: true, username: true } },
        },
      });

      await writeAuditLog(tx, {
        branchId: existing.sourceBranchId,
        userId: approvedByUserId,
        action: 'APPROVE_TRANSFER',
        entityName: 'InterBranchTransfer',
        entityId: id,
        details: {
          transferCode: existing.transferCode,
          approvedQty,
          sourceBatchId,
        },
      });

      return updated;
    });

    return NextResponse.json(transfer);
  } catch (error) {
    return handleApiError(error);
  }
}
