import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { signToken } from '@/lib/auth';
import {
  checkRegistrationAllowed,
  recordRegistrationAttempt,
  checkLoginLockout,
  recordFailedLogin,
  clearLoginAttempts,
} from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-log';
import bcrypt from 'bcryptjs';

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/**
 * SECURITY: the reactivation code alone is NOT sufficient to mint a
 * session. This deployment has no email service, so the code from
 * /request-reactivation-code is shown directly in that response — which
 * means anyone who knows (or guesses) a username can obtain a valid code
 * for it without proving they own the account. Requiring the account's
 * real password here, in addition to the code, is what actually closes
 * that gap: knowing the code is no longer enough to log in as someone
 * else. This mirrors login's own password check exactly, including
 * reusing the same per-username lockout store — this endpoint is a second
 * password-verification surface and needs the same brute-force
 * protection login has, not a lighter version of it.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request);
    if (!checkRegistrationAllowed(ip)) {
      throw new PharmacyServiceError('Too many attempts from this connection — try again later.');
    }
    recordRegistrationAttempt(ip);

    const body = await request.json();
    const username: string | undefined = body.username?.trim();
    const code: string | undefined = body.code?.trim().toUpperCase();
    const password: string | undefined = body.password;
    if (!username || !code || !password) {
      throw new PharmacyServiceError('username, code, and password are required');
    }

    const lockedForSeconds = checkLoginLockout(username);
    if (lockedForSeconds !== null) {
      const minutes = Math.ceil(lockedForSeconds / 60);
      throw new PharmacyServiceError(
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
      );
    }

    // "No account found", "wrong/expired code", and "wrong password" are
    // deliberately the same generic message — same reasoning as login's
    // "invalid username or password": revealing which part failed would
    // let someone probe this public, unauthenticated endpoint to learn
    // which usernames are real accounts on this deployment.
    const genericFailure = () => new PharmacyServiceError('That username, code, or password is invalid or has expired');

    const user = await db.user.findUnique({
      where: { username },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    if (!user) {
      recordFailedLogin(username);
      throw genericFailure();
    }

    const company = await db.company.findUnique({ where: { id: user.companyId } });
    if (!company) {
      recordFailedLogin(username);
      throw genericFailure();
    }
    if (
      !company.reactivationCode ||
      company.reactivationCode !== code ||
      !company.reactivationCodeExpiresAt ||
      company.reactivationCodeExpiresAt < new Date()
    ) {
      recordFailedLogin(username);
      throw genericFailure();
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      recordFailedLogin(username);
      await writeAuditLog(db, {
        userId: user.id,
        branchId: user.homeBranchId,
        action: 'REACTIVATION_FAILED',
        entityName: 'Company',
        entityId: company.id,
        ipAddress: ip,
        details: { reason: 'wrong_password' },
      });
      throw genericFailure();
    }

    clearLoginAttempts(username);

    const updatedCompany = await db.company.update({
      where: { id: company.id },
      data: {
        // Permanently removes the restriction rather than pushing the
        // clock forward another 30 days — new companies no longer get a
        // trial at all (see POST /auth/register-company), so anyone
        // still caught by the old system gets a one-time, permanent
        // unlock here instead of a recurring countdown.
        trialExpiresAt: null,
        reactivationCode: null,
        reactivationCodeExpiresAt: null,
      },
    });

    await writeAuditLog(db, {
      branchId: user.homeBranchId,
      userId: user.id,
      action: 'COMPANY_REACTIVATED',
      entityName: 'Company',
      entityId: company.id,
      ipAddress: ip,
      details: { companyName: company.name, newTrialExpiresAt: updatedCompany.trialExpiresAt },
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
        roleName: user.role.roleName,
        permissions: user.role.permissions.map((rp) => rp.permission.permissionName),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
