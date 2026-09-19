import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { validatePasswordStrength } from '@/lib/password-policy';
import type { ChangePasswordInput } from '@/types/pharmacy';

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const body: ChangePasswordInput = await request.json();

    if (!body.currentPassword || !body.newPassword) {
      throw new PharmacyServiceError('currentPassword and newPassword are required');
    }
    const strength = validatePasswordStrength(body.newPassword);
    if (!strength.valid) {
      throw new PharmacyServiceError(strength.message!);
    }

    const user = await db.user.findUnique({ where: { id: auth.userId } });
    if (!user) {
      throw new PharmacyServiceError('User not found');
    }

    const currentMatches = await bcrypt.compare(body.currentPassword, user.passwordHash);
    if (!currentMatches) {
      throw new PharmacyServiceError('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(body.newPassword, 12);
    await db.user.update({ where: { id: auth.userId }, data: { passwordHash } });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
