import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { validatePasswordStrength } from '@/lib/password-policy';
import { writeAuditLog } from '@/lib/audit-log';
import type { AdminResetPasswordInput } from '@/types/pharmacy';

// Separate from the self-service change at /auth/me/password — this one
// doesn't require knowing the current password, which is exactly why it's
// restricted to Admin/Manager and audit-logged: it's how a forgotten
// password actually gets recovered, and also a capability worth a clear
// paper trail if ever misused.
const CAN_RESET_PASSWORD = ['ADMIN', 'MANAGER'];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_RESET_PASSWORD);
    if (roleError) return roleError;

    const { id } = await params;
    const userId = Number(id);
    const body: AdminResetPasswordInput = await request.json();

    const strength = validatePasswordStrength(body.newPassword);
    if (!strength.valid) {
      throw new PharmacyServiceError(strength.message!);
    }

    const targetUser = await db.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      throw new PharmacyServiceError('User not found');
    }

    const passwordHash = await bcrypt.hash(body.newPassword, 12);
    await db.user.update({ where: { id: userId }, data: { passwordHash } });

    await writeAuditLog(db, {
      userId: auth.userId,
      action: 'ADMIN_RESET_PASSWORD',
      entityName: 'User',
      entityId: String(userId),
      details: { targetUsername: targetUser.username },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
