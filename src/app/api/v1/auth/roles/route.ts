import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { getAuthPayload, isAuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const roles = await db.role.findMany({
      include: {
        permissions: {
          include: { permission: true },
        },
      },
      orderBy: { roleName: 'asc' },
    });

    const rolesWithPermissions = roles.map((role) => ({
      id: role.id,
      roleName: role.roleName,
      description: role.description,
      permissions: role.permissions.map((rp) => ({
        id: rp.permission.id,
        permissionName: rp.permission.permissionName,
        description: rp.permission.description,
      })),
    }));

    return NextResponse.json(rolesWithPermissions);
  } catch (error) {
    return handleApiError(error);
  }
}
