import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import type { UpdateApprovalRuleInput } from '@/types/pharmacy';

const CAN_MANAGE_APPROVAL_RULES = ['ADMIN'];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_APPROVAL_RULES);
    if (roleError) return roleError;

    const { id } = await params;
    const body: UpdateApprovalRuleInput = await request.json();

    const existing = await db.approvalRule.findUnique({ where: { id } });
    if (!existing) {
      throw new PharmacyServiceError('Approval rule not found');
    }

    const minAmount = body.minAmount ?? existing.minAmount;
    const maxAmount = body.maxAmount === undefined ? existing.maxAmount : body.maxAmount;
    if (maxAmount != null && maxAmount <= minAmount) {
      throw new PharmacyServiceError('maxAmount must be greater than minAmount');
    }

    const updated = await db.approvalRule.update({
      where: { id },
      data: {
        minAmount: body.minAmount,
        maxAmount: body.maxAmount === undefined ? undefined : body.maxAmount,
        requiredRole: body.requiredRole,
        description: body.description,
        isActive: body.isActive,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
