import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit-log';

const CAN_MANAGE_BRANCHES = ['ADMIN'];

// Branches are never hard-deleted: branchId is referenced (as a plain
// string, not an enforced FK) across sales, inventory, transfers, and
// audit logs. Deactivating instead of deleting keeps that history intact
// while removing the branch from pickers going forward.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_BRANCHES);
    if (roleError) return roleError;

    const { id } = await params;
    const existing = await db.branch.findUnique({ where: { id } });
    if (!existing) {
      throw new PharmacyServiceError(`Branch "${id}" not found`);
    }
    if (existing.companyId !== auth.companyId) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }

    const body = await request.json();
    const data: { name?: string; address?: string | null; phone?: string | null; isActive?: boolean } = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new PharmacyServiceError('Branch name cannot be empty');
      data.name = name;
    }
    if (body.address !== undefined) data.address = String(body.address).trim() || null;
    if (body.phone !== undefined) data.phone = String(body.phone).trim() || null;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const branch = await db.branch.update({ where: { id }, data });

    await writeAuditLog(db, {
      branchId: branch.id,
      userId: auth.userId,
      action: 'BRANCH_UPDATED',
      entityName: 'Branch',
      entityId: branch.id,
      details: data,
    });

    return NextResponse.json(branch);
  } catch (error) {
    return handleApiError(error);
  }
}
