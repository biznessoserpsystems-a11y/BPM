import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';

const CAN_MANAGE_ACCESS = ['ADMIN'];

// Grant a permission to a role.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_ACCESS);
    if (roleError) return roleError;

    const { id } = await params;
    const roleId = Number(id);
    const body = await request.json();
    const permissionId = Number(body.permissionId);

    if (!permissionId) {
      throw new PharmacyServiceError('permissionId is required');
    }

    const [role, permission] = await Promise.all([
      db.role.findUnique({ where: { id: roleId } }),
      db.permission.findUnique({ where: { id: permissionId } }),
    ]);
    if (!role) throw new PharmacyServiceError('Role not found');
    if (!permission) throw new PharmacyServiceError('Permission not found');

    await db.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId } },
      update: {},
      create: { roleId, permissionId },
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

// Revoke a permission from a role.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_ACCESS);
    if (roleError) return roleError;

    const { id } = await params;
    const roleId = Number(id);
    const permissionId = Number(request.nextUrl.searchParams.get('permissionId'));

    if (!permissionId) {
      throw new PharmacyServiceError('permissionId query parameter is required');
    }

    await db.rolePermission.deleteMany({ where: { roleId, permissionId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
