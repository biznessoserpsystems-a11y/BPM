import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { signToken } from '@/lib/auth';
import { validatePasswordStrength } from '@/lib/password-policy';
import { checkRegistrationAllowed, recordRegistrationAttempt } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-log';
import { checkLicenseToken, consumeLicenseToken } from '@/lib/license-token';
import { isSafeImageDataUri } from '@/lib/logo-validation';
import { seedStarterAccounting } from '@/lib/default-accounting-setup';
import bcrypt from 'bcryptjs';

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/**
 * Deliberately unauthenticated — there's no user yet to authenticate as.
 * Creates a Company, a default first Branch for it, its first user
 * (always ADMIN, since someone has to be able to configure everything
 * else), and a starter Chart of Accounts/currency/GL mappings (see
 * seedStarterAccounting) so accounting features work immediately rather
 * than the new company starting with zero accounts. Returns a token
 * immediately, same shape as /auth/login, so the frontend can sign the
 * new admin straight in rather than bouncing them back to a separate
 * login step.
 *
 * Products and Suppliers are intentionally NOT seeded here — every
 * pharmacy's catalog and supplier list is genuinely their own, so a new
 * company reasonably starts empty and builds those up through Catalog →
 * Products/Suppliers, the same as any other new tenant onboarding.
 *
 * Role/Permission remain global by design (RBAC taxonomy, not tenant
 * business data — see the Company model's doc comment in
 * prisma/schema.prisma for the full reasoning).
 */
export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request);
    if (!checkRegistrationAllowed(ip)) {
      throw new PharmacyServiceError('Too many registration attempts from this connection — try again later.');
    }
    recordRegistrationAttempt(ip);

    const body = await request.json();
    const companyName: string | undefined = body.companyName?.trim();
    const companyCode: string | undefined = body.companyCode?.trim().toLowerCase();
    const logoUrl: string | undefined = body.logoUrl?.trim() || undefined;
    const adminFullName: string | undefined = body.adminFullName?.trim();
    const adminUsername: string | undefined = body.adminUsername?.trim();
    const adminEmail: string | undefined = body.adminEmail?.trim() || undefined;
    const adminPassword: string | undefined = body.adminPassword;
    const licenseToken: string | undefined = body.licenseToken?.trim();

    if (!companyName || !companyCode || !adminFullName || !adminUsername || !adminPassword || !licenseToken) {
      throw new PharmacyServiceError(
        'companyName, companyCode, adminFullName, adminUsername, adminPassword, and licenseToken are required'
      );
    }
    // Fast, clean rejection before anyone fills out the rest of the
    // form — read-only, doesn't consume a slot. The authoritative check
    // happens again inside the transaction below, atomically, right
    // before the actual writes.
    const earlyCheck = await checkLicenseToken(db, licenseToken);
    if (!earlyCheck.valid) {
      throw new PharmacyServiceError(earlyCheck.message ?? 'Invalid license token', 'INVALID_LICENSE_TOKEN');
    }
    if (!/^[a-z0-9-]+$/.test(companyCode)) {
      throw new PharmacyServiceError('Company code must be lowercase letters, numbers, and hyphens only (e.g. acme-pharma)');
    }
    if (logoUrl && logoUrl.length > 500_000) {
      throw new PharmacyServiceError('Logo image is too large — please use a smaller image (a few hundred KB or less)');
    }
    if (logoUrl && !isSafeImageDataUri(logoUrl)) {
      throw new PharmacyServiceError('Logo must be a PNG, JPEG, GIF, or WebP image');
    }
    const strength = validatePasswordStrength(adminPassword);
    if (!strength.valid) {
      throw new PharmacyServiceError(strength.message!);
    }

    const [existingCompany, existingUsername, existingEmail, adminRole] = await Promise.all([
      db.company.findUnique({ where: { code: companyCode } }),
      db.user.findUnique({ where: { username: adminUsername } }),
      adminEmail ? db.user.findUnique({ where: { email: adminEmail } }) : Promise.resolve(null),
      db.role.findUnique({ where: { roleName: 'ADMIN' } }),
    ]);
    if (existingCompany) {
      throw new PharmacyServiceError(`Company code "${companyCode}" is already taken`);
    }
    if (existingUsername) {
      throw new PharmacyServiceError(`Username "${adminUsername}" is already taken`);
    }
    if (existingEmail) {
      throw new PharmacyServiceError(`Email "${adminEmail}" is already in use`);
    }
    if (!adminRole) {
      // The ADMIN role is seeded with the database — this would only
      // happen on a database that was never seeded at all.
      throw new PharmacyServiceError('No ADMIN role exists in this system — the database may not have been seeded');
    }

    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const branchId = `BR-${companyCode.toUpperCase()}-01`;

    const result = await db.$transaction(async (tx) => {
      const licenseTokenId = await consumeLicenseToken(tx, licenseToken);

      const company = await tx.company.create({
        data: {
          name: companyName,
          code: companyCode,
          logoUrl,
          licenseTokenId,
          isActive: true,
          // No trial expiry — a company created here is unrestricted,
          // forever. See
          // assertCompanyActive() in src/lib/company-trial.ts: a company
          // with trialExpiresAt left null is opt-in-only, same shape as
          // accounting periods — nothing else needs to change for this
          // to take effect, since the enforcement, the trial banner in
          // app-shell.tsx, and the reactivation flow all already treat
          // null as "no restriction" rather than assuming one exists.
        },
      });

      const branch = await tx.branch.create({
        data: { id: branchId, name: `${companyName} — Head Office`, isActive: true, companyId: company.id },
      });

      // Every accounting feature (journal entries, reports, auto-posting
      // from sales/receipts/payroll/...) depends on this company having
      // its own Chart of Accounts, base currency, and GL mappings — those
      // are now company-scoped, so without this the new company would
      // start with literally zero accounts and accounting would silently
      // do nothing until an admin built one from scratch by hand.
      await seedStarterAccounting(tx, company.id);

      const user = await tx.user.create({
        data: {
          username: adminUsername,
          passwordHash,
          fullName: adminFullName,
          email: adminEmail,
          roleId: adminRole.id,
          homeBranchId: branch.id,
          companyId: company.id,
        },
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      });

      return { company, branch, user };
    });

    await writeAuditLog(db, {
      branchId: result.branch.id,
      userId: result.user.id,
      action: 'COMPANY_REGISTERED',
      entityName: 'Company',
      entityId: result.company.id,
      ipAddress: ip,
      details: { companyName, companyCode },
    });

    const token = signToken({
      userId: result.user.id,
      username: result.user.username,
      roleName: result.user.role.roleName,
      homeBranchId: result.user.homeBranchId,
      companyId: result.user.companyId,
    });

    const { passwordHash: _hash, pinCode: _pin, ...safeUser } = result.user;

    return NextResponse.json(
      {
        token,
        user: {
          ...safeUser,
          roleName: result.user.role.roleName,
          permissions: result.user.role.permissions.map((rp) => rp.permission.permissionName),
        },
        company: result.company,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
