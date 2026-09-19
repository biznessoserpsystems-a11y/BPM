import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import type { UpdateProfileInput } from '@/types/pharmacy';

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    return NextResponse.json({
      userId: auth.userId,
      username: auth.username,
      roleName: auth.roleName,
      homeBranchId: auth.homeBranchId,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// A user editing their own profile — name, email, phone. Deliberately does
// not allow changing username, role, or home branch here; those are
// administrative changes and stay under /api/v1/auth/users (Admin/Manager).
export async function PATCH(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const body: UpdateProfileInput = await request.json();

    if (body.email !== undefined && body.email !== '' && !body.email.includes('@')) {
      throw new PharmacyServiceError('Enter a valid email address');
    }

    if (body.email) {
      const existing = await db.user.findUnique({ where: { email: body.email } });
      if (existing && existing.id !== auth.userId) {
        throw new PharmacyServiceError('That email address is already in use by another account');
      }
    }

    const updated = await db.user.update({
      where: { id: auth.userId },
      data: {
        fullName: body.fullName || undefined,
        email: body.email || undefined,
        phone: body.phone || undefined,
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        homeBranchId: true,
        licenseNumber: true,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
