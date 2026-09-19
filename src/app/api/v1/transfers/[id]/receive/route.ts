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
      if (existing.status !== 'DISPATCHED') {
        throw new PharmacyServiceError(`Transfer cannot be received. Current status: ${existing.status}`);
      }

      // Create or top-up batch at destination branch
      const sourceBatch = existing.sourceBatchId
        ? await tx.productBatch.findUnique({ where: { id: existing.sourceBatchId } })
        : null;

      // Check if a batch with the same batch number exists at the destination
      const destinationBatch = sourceBatch
        ? await tx.productBatch.findFirst({
            where: {
              branchId: existing.destinationBranchId,
              productId: existing.productId,
              batchNumber: sourceBatch.batchNumber,
            },
          })
        : null;

      if (destinationBatch) {
        // Top-up existing batch
        await tx.productBatch.update({
          where: { id: destinationBatch.id },
          data: { quantityInStock: { increment: existing.approvedQty } },
        });
      } else {
        // Create new batch at destination
        const sellingPrice = sourceBatch?.sellingPrice ?? 0;
        const purchasePrice = sourceBatch?.purchasePrice ?? 0;
        const expiryDate = sourceBatch?.expiryDate ?? new Date();
        const batchNumber = sourceBatch?.batchNumber ?? `TR-${Date.now()}`;

        await tx.productBatch.create({
          data: {
            branchId: existing.destinationBranchId,
            productId: existing.productId,
            batchNumber,
            expiryDate,
            purchasePrice,
            sellingPrice,
            quantityReceived: existing.approvedQty,
            quantityInStock: existing.approvedQty,
          },
        });
      }

      // Update transfer status
      const updated = await tx.interBranchTransfer.update({
        where: { id },
        data: { status: 'RECEIVED' },
        include: {
          product: true,
          sourceBatch: { include: { product: true } },
          requestedByUser: { select: { id: true, fullName: true, username: true } },
          approvedByUser: { select: { id: true, fullName: true, username: true } },
        },
      });

      await writeAuditLog(tx, {
        branchId: existing.destinationBranchId,
        userId,
        action: 'RECEIVE_TRANSFER',
        entityName: 'InterBranchTransfer',
        entityId: id,
        details: {
          transferCode: existing.transferCode,
          receivedQty: existing.approvedQty,
        },
      });

      return updated;
    });

    return NextResponse.json(transfer);
  } catch (error) {
    return handleApiError(error);
  }
}
