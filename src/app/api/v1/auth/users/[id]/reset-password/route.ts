import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { validatePasswordStrength } from '@/lib/password-policy';
import { writeAuditLog } from '@/lib/audit-log';
import { clearLoginAttempts } from '@/lib/rate-limit';
import type { AdminResetPasswordInput } from '@/types/pharmacy';

// Separate from the self-service change at /auth/me/password — this one
// doesn't require knowing the current password, which is exactly why it's
// restricted to Admin/Manager and audit-logged: it's how a forgotten
// password actually gets recovered, and also a capability worth a clear
// paper trail if ever misused.
//
// Three rules keep that capability from becoming an account-takeover path:
//  1. Same company only. The target is looked up WITHIN the caller's own
//     company, so another company's user (or a made-up id) is simply "not
//     found" — an Admin/Manager of one pharmacy can never reset a user of
//     another one hosted on the same server.
//  2. A Manager can reset staff, but never an Admin or another Manager —
//     otherwise a Manager could reset the Admin's password and sign in as
//     them. Admins can reset anyone in their company.
//  3. Never your own account here. Changing your own password goes through
//     Settings -> Change Password, which demands the CURRENT password; this
//     route doesn't, so allowing self-reset would let anyone holding a
//     stolen session lock the real owner out without knowing it.
const CAN_RESET_PASSWORD = ['ADMIN', 'MANAGER'];
const MANAGER_CANNOT_RESET = ['ADMIN', 'MANAGER'];

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

    // Scoped to the caller's company (rule 1) — same "User not found" for
    // "doesn't exist" and "belongs to someone else", so ids can't be probed.
    const targetUser = Number.isInteger(userId)
      ? await db.user.findFirst({
          where: { id: userId, companyId: auth.companyId },
          include: { role: true },
        })
      : null;
    if (!targetUser) {
      throw new PharmacyServiceError('User not found');
    }

    if (targetUser.id === auth.userId) {
      throw new PharmacyServiceError(
        'To change your own password, use Settings → Change Password. An administrator can reset other people’s passwords here.'
      );
    }

    if (auth.roleName !== 'ADMIN' && MANAGER_CANNOT_RESET.includes(targetUser.role.roleName)) {
      return NextResponse.json(
        { error: 'Only an Admin can reset the password of an Admin or Manager account' },
        { status: 403 }
      );
    }

    const passwordHash = await bcrypt.hash(body.newPassword, 12);
    await db.user.update({ where: { id: targetUser.id }, data: { passwordHash } });

    // If they'd been locked out by repeated failed logins (the usual reason
    // a password gets reset), let them straight in with the new one rather
    // than making them wait out the lockout first.
    clearLoginAttempts(targetUser.username);

    await writeAuditLog(db, {
      branchId: auth.homeBranchId,
      userId: auth.userId,
      action: 'ADMIN_RESET_PASSWORD',
      entityName: 'User',
      entityId: String(targetUser.id),
      details: { targetUsername: targetUser.username },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
