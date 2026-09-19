import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { canAccessBranch, getCompanyBranchIds } from '@/lib/branch-access';
import { PharmacyServiceError } from '@/lib/errors';

// The audit trail records who did what, system-wide — the same
// oversight-tier sensitivity as GL mappings and approval rules, so it
// gets the same restriction rather than being viewable by every role.
const CAN_VIEW_AUDIT_LOG = ['ADMIN', 'MANAGER'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_VIEW_AUDIT_LOG);
    if (roleError) return roleError;

    const branchId = request.nextUrl.searchParams.get('branchId');
    const userId = request.nextUrl.searchParams.get('userId');
    const entityName = request.nextUrl.searchParams.get('entityName');
    const limitParam = request.nextUrl.searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : undefined;

    if (branchId && !(await canAccessBranch(db, auth, branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }
    const companyBranchIds = branchId ? undefined : await getCompanyBranchIds(db, auth.companyId);

    const where: Record<string, unknown> = branchId ? { branchId } : { branchId: { in: companyBranchIds } };
    if (userId) where.userId = Number(userId);
    if (entityName) where.entityName = entityName;

    const logs = await db.systemAuditLog.findMany({
      where,
      include: {
        user: {
          select: { id: true, fullName: true, username: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit ?? 100,
    });

    return NextResponse.json(logs);
  } catch (error) {
    return handleApiError(error);
  }
}
