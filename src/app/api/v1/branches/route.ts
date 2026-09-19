import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit-log';

const CAN_MANAGE_BRANCHES = ['ADMIN'];

// All authenticated users can list branches — the branch switcher, transfer
// picker, and user-branch assignment dropdowns all need this regardless of
// role. Only Admins can create new ones (see requireRole check in POST).
// Always scoped to the caller's own company — no one, regardless of role,
// ever sees or picks a branch belonging to a different company.
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const branches = await db.branch.findMany({
      where: { companyId: auth.companyId },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json(branches);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_BRANCHES);
    if (roleError) return roleError;

    const body = await request.json();
    const id: string | undefined = body.id?.trim();
    const name: string | undefined = body.name?.trim();
    const address: string | undefined = body.address?.trim() || undefined;
    const phone: string | undefined = body.phone?.trim() || undefined;

    if (!id || !name) {
      throw new PharmacyServiceError('Branch code and name are required');
    }
    if (!/^[A-Z0-9-]+$/.test(id)) {
      throw new PharmacyServiceError('Branch code must be uppercase letters, numbers, and hyphens only (e.g. BR-TAKORADI-03)');
    }

    const existing = await db.branch.findUnique({ where: { id } });
    if (existing) {
      throw new PharmacyServiceError(`Branch code "${id}" already exists`);
    }

    const branch = await db.branch.create({
      data: { id, name, address, phone, companyId: auth.companyId },
    });

    await writeAuditLog(db, {
      branchId: branch.id,
      userId: auth.userId,
      action: 'BRANCH_CREATED',
      entityName: 'Branch',
      entityId: branch.id,
      details: { name: branch.name },
    });

    return NextResponse.json(branch, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
