import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import type { CreateApprovalRuleInput } from '@/types/pharmacy';

// Only Admins configure who's allowed to approve what — this is itself an
// access-control setting, so it's more tightly held than the Manager-level
// access most other Settings screens allow.
const CAN_MANAGE_APPROVAL_RULES = ['ADMIN'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const entityType = request.nextUrl.searchParams.get('entityType');

    const rules = await db.approvalRule.findMany({
      where: entityType ? { entityType } : undefined,
      orderBy: [{ entityType: 'asc' }, { minAmount: 'asc' }],
    });

    return NextResponse.json(rules);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_APPROVAL_RULES);
    if (roleError) return roleError;

    const body: CreateApprovalRuleInput = await request.json();

    if (!body.entityType || !body.requiredRole) {
      throw new PharmacyServiceError('entityType and requiredRole are required');
    }
    if (body.minAmount !== undefined && body.minAmount < 0) {
      throw new PharmacyServiceError('minAmount cannot be negative');
    }
    if (body.maxAmount != null && body.minAmount != null && body.maxAmount <= body.minAmount) {
      throw new PharmacyServiceError('maxAmount must be greater than minAmount');
    }

    const rule = await db.approvalRule.create({
      data: {
        entityType: body.entityType,
        minAmount: body.minAmount ?? 0,
        maxAmount: body.maxAmount ?? undefined,
        requiredRole: body.requiredRole,
        description: body.description,
      },
    });

    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
