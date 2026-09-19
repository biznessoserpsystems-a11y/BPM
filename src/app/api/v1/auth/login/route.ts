import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { signToken } from '@/lib/auth';
import { checkLoginLockout, recordFailedLogin, clearLoginAttempts } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-log';
import { assertCompanyActive } from '@/lib/company-trial';
import bcrypt from 'bcryptjs';
import type { LoginInput } from '@/types/pharmacy';

function clientIp(request: NextRequest): string | undefined {
  // Standard proxy header first (this app's own reverse proxy or a
  // platform load balancer would set this); no direct socket access is
  // available from a Next.js Request object.
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
}

export async function POST(request: NextRequest) {
  try {
    const body: LoginInput = await request.json();
    const ipAddress = clientIp(request);

    if (!body.username || !body.password) {
      throw new PharmacyServiceError('username and password are required');
    }

    const lockedForSeconds = checkLoginLockout(body.username);
    if (lockedForSeconds !== null) {
      const minutes = Math.ceil(lockedForSeconds / 60);
      await writeAuditLog(db, {
        action: 'LOGIN_BLOCKED_LOCKOUT',
        entityName: 'User',
        ipAddress,
        details: { attemptedUsername: body.username },
      });
      throw new PharmacyServiceError(
        `Too many failed login attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
      );
    }

    const user = await db.user.findUnique({
      where: { username: body.username },
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        },
      },
    });

    // Same generic message and same failed-attempt tracking whether the
    // username doesn't exist or the password is wrong — treating these
    // differently (or only rate-limiting one of them) would let an
    // attacker use the lockout behavior itself to enumerate which
    // usernames are real.
    if (!user) {
      recordFailedLogin(body.username);
      await writeAuditLog(db, {
        action: 'LOGIN_FAILED',
        entityName: 'User',
        ipAddress,
        details: { attemptedUsername: body.username, reason: 'unknown_username' },
      });
      throw new PharmacyServiceError('Invalid username or password');
    }

    if (!user.isActive) {
      await writeAuditLog(db, {
        userId: user.id,
        branchId: user.homeBranchId,
        action: 'LOGIN_BLOCKED_INACTIVE',
        entityName: 'User',
        entityId: String(user.id),
        ipAddress,
      });
      throw new PharmacyServiceError('Account is deactivated');
    }

    try {
      await assertCompanyActive(db, user.companyId);
    } catch (trialError) {
      await writeAuditLog(db, {
        userId: user.id,
        branchId: user.homeBranchId,
        action: 'LOGIN_BLOCKED_TRIAL_EXPIRED',
        entityName: 'User',
        entityId: String(user.id),
        ipAddress,
      });
      throw trialError;
    }

    const isValid = await bcrypt.compare(body.password, user.passwordHash);
    if (!isValid) {
      recordFailedLogin(body.username);
      await writeAuditLog(db, {
        userId: user.id,
        branchId: user.homeBranchId,
        action: 'LOGIN_FAILED',
        entityName: 'User',
        entityId: String(user.id),
        ipAddress,
        details: { reason: 'wrong_password' },
      });
      throw new PharmacyServiceError('Invalid username or password');
    }

    clearLoginAttempts(body.username);

    await writeAuditLog(db, {
      userId: user.id,
      branchId: user.homeBranchId,
      action: 'LOGIN_SUCCESS',
      entityName: 'User',
      entityId: String(user.id),
      ipAddress,
    });

    const token = signToken({
      userId: user.id,
      username: user.username,
      roleName: user.role.roleName,
      homeBranchId: user.homeBranchId,
      companyId: user.companyId,
    });

    const { passwordHash, pinCode, ...safeUser } = user;

    return NextResponse.json({
      token,
      user: {
        ...safeUser,
        // The frontend's AuthUser type (src/lib/store.ts) expects a flat
        // roleName alongside the nested role object below — every
        // client-side role check throughout the app (canEdit, canManage,
        // sidebar visibility, etc.) reads user.roleName directly. Without
        // this, every one of those checks silently evaluates false for
        // everyone, including Admins — hiding admin-only UI from actual
        // admins, not exposing anything to people who shouldn't see it,
        // but broken either way. The JWT payload above already had this
        // right; the response body sent to the browser didn't.
        roleName: user.role.roleName,
        permissions: user.role.permissions.map((rp) => rp.permission.permissionName),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
