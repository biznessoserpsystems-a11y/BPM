import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit-log';
import type { CreateTransferInput } from '@/types/pharmacy';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch, getCompanyBranchIds } from '@/lib/branch-access';

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const branchId = request.nextUrl.searchParams.get('branchId');

    if (branchId && !(await canAccessBranch(db, auth, branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }

    // Transfers inherently span two branches — never scoped to a single
    // branchId gate the way most other resources are (see the docstring
    // on canAccessBranch). Omitting branchId means "every transfer
    // touching any of my company's branches," on either side, not an
    // unscoped query across every company on the deployment.
    const companyBranchIds = branchId ? undefined : await getCompanyBranchIds(db, auth.companyId);
    const where = branchId
      ? {
          OR: [{ sourceBranchId: branchId }, { destinationBranchId: branchId }],
        }
      : {
          OR: [{ sourceBranchId: { in: companyBranchIds } }, { destinationBranchId: { in: companyBranchIds } }],
        };

    const transfers = await db.interBranchTransfer.findMany({
      where,
      include: {
        product: true,
        sourceBatch: { include: { product: true } },
        requestedByUser: { select: { id: true, fullName: true, username: true } },
        approvedByUser: { select: { id: true, fullName: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(transfers);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const body: CreateTransferInput = await request.json();

    if (!body.sourceBranchId || !body.destinationBranchId || !body.productId || !body.requestedQty || !body.requestedByUserId) {
      throw new PharmacyServiceError(
        'sourceBranchId, destinationBranchId, productId, requestedQty, and requestedByUserId are required'
      );
    }
    // Both sides checked individually — a transfer can never legitimately
    // span two different companies' branches, so both ends need to
    // belong to the caller's own company (and pass the same role-based
    // access canAccessBranch already applies to a single branch).
    if (!(await canAccessBranch(db, auth, body.sourceBranchId)) || !(await canAccessBranch(db, auth, body.destinationBranchId))) {
      throw new PharmacyServiceError("You do not have access to one of these branches");
    }
    if (body.requestedByUserId !== auth.userId) {
      throw new PharmacyServiceError('You can only request a transfer as yourself');
    }

    if (body.sourceBranchId === body.destinationBranchId) {
      throw new PharmacyServiceError('Source and destination branches must be different');
    }

    // Generate transfer code
    const transferCode = `TR-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const transfer = await db.$transaction(async (tx) => {
      const newTransfer = await tx.interBranchTransfer.create({
        data: {
          transferCode,
          sourceBranchId: body.sourceBranchId,
          destinationBranchId: body.destinationBranchId,
          productId: body.productId,
          requestedQty: body.requestedQty,
          requestedByUserId: body.requestedByUserId,
          status: 'REQUESTED',
        },
        include: {
          product: true,
          requestedByUser: { select: { id: true, fullName: true, username: true } },
        },
      });

      await writeAuditLog(tx, {
        branchId: body.sourceBranchId,
        userId: body.requestedByUserId,
        action: 'CREATE_TRANSFER',
        entityName: 'InterBranchTransfer',
        entityId: newTransfer.id,
        details: {
          transferCode,
          productId: body.productId,
          requestedQty: body.requestedQty,
        },
      });

      return newTransfer;
    });

    return NextResponse.json(transfer, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
