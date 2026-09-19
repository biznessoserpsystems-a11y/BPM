import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import type { CreatePermissionInput } from '@/types/pharmacy';

const CAN_MANAGE_PERMISSIONS = ['ADMIN'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const permissions = await db.permission.findMany({
      orderBy: { permissionName: 'asc' },
    });

    return NextResponse.json(permissions);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_PERMISSIONS);
    if (roleError) return roleError;

    const body: CreatePermissionInput = await request.json();

    if (!body.permissionName) {
      throw new PharmacyServiceError('permissionName is required');
    }

    const existing = await db.permission.findUnique({ where: { permissionName: body.permissionName } });
    if (existing) {
      throw new PharmacyServiceError(`Permission "${body.permissionName}" already exists`);
    }

    const permission = await db.permission.create({
      data: { permissionName: body.permissionName, description: body.description },
    });

    return NextResponse.json(permission, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
