import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import type { UpdateUserAccessInput } from '@/types/pharmacy';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { id } = await params;
    const userId = Number(id);

    // Anyone can view their own record; viewing someone else's requires an
    // admin/manager role, matching the write-side restriction on
    // /api/v1/auth/users.
    if (userId !== auth.userId && !['ADMIN', 'MANAGER'].includes(auth.roleName)) {
      throw new PharmacyServiceError('Not permitted to view this user');
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    if (!user) {
      throw new PharmacyServiceError('User not found');
    }

    const { passwordHash, pinCode, ...safeUser } = user;

    return NextResponse.json({
      ...safeUser,
      permissions: user.role.permissions.map((rp) => rp.permission.permissionName),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// Manager can still deactivate/reactivate an account (routine day-to-day
// access management), but assigning a *role* is Admin-exclusive — see the
// roleId-specific check below.
const CAN_MANAGE_USER_ACCESS = ['ADMIN', 'MANAGER'];
const CAN_ASSIGN_ROLE = ['ADMIN'];

// Administrative edit of *another* user's access — role and active status.
// Deliberately separate from the self-service profile edit at
// PATCH /api/v1/auth/me, which only ever touches the caller's own record.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_USER_ACCESS);
    if (roleError) return roleError;

    const { id } = await params;
    const userId = Number(id);
    const body: UpdateUserAccessInput = await request.json();

    if (userId === auth.userId && body.isActive === false) {
      throw new PharmacyServiceError('You cannot deactivate your own account');
    }

    const existing = await db.user.findUnique({ where: { id: userId } });
    if (!existing) {
      throw new PharmacyServiceError('User not found');
    }

    if (body.roleId) {
      const assignRoleError = requireRole(auth, CAN_ASSIGN_ROLE);
      if (assignRoleError) return assignRoleError;

      const role = await db.role.findUnique({ where: { id: body.roleId } });
      if (!role) {
        throw new PharmacyServiceError(`Role ${body.roleId} not found`);
      }
    }

    const updated = await db.user.update({
      where: { id: userId },
      data: {
        roleId: body.roleId,
        isActive: body.isActive,
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        homeBranchId: true,
        licenseNumber: true,
        isActive: true,
        role: { select: { id: true, roleName: true } },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
