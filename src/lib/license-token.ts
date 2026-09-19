import type { Prisma, PrismaClient } from '@prisma/client';
import { PharmacyServiceError } from './errors';

type Tx = PrismaClient | Prisma.TransactionClient;

export interface LicenseTokenCheck {
  valid: boolean;
  remaining: number;
  message?: string;
}

/**
 * Read-only check — does NOT consume a slot. Used both by the real-time
 * validation endpoint (so the person sees "valid, 1 company remaining"
 * before submitting the full form) and internally by
 * consumeLicenseToken below, which re-checks then writes atomically.
 */
export async function checkLicenseToken(tx: Tx, tokenValue: string): Promise<LicenseTokenCheck> {
  const token = await tx.licenseToken.findUnique({ where: { token: tokenValue } });
  if (!token) {
    return { valid: false, remaining: 0, message: 'That license token was not recognized' };
  }
  if (!token.isActive) {
    return { valid: false, remaining: 0, message: 'That license token has been deactivated' };
  }
  const remaining = token.maxCompanies - token.companiesCreated;
  if (remaining <= 0) {
    return { valid: false, remaining: 0, message: 'That license token has already been used for its maximum number of companies' };
  }
  return { valid: true, remaining };
}

/**
 * Validates and atomically consumes one slot on the token in a single
 * conditional UPDATE, returning its id to link the new Company to it.
 * Deliberately not implemented as "read the count, then write" — two
 * simultaneous registrations both reading the same token's last
 * remaining slot before either writes would let both succeed, silently
 * over-consuming the token. A single UPDATE ... WHERE companies_created
 * < max_companies is atomic at the database level: at most one
 * concurrent caller can ever be the one whose row actually matches.
 */
export async function consumeLicenseToken(tx: Tx, tokenValue: string): Promise<string> {
  const updatedRows = await tx.$executeRaw`
    UPDATE license_tokens
    SET companies_created = companies_created + 1
    WHERE token = ${tokenValue} AND is_active = 1 AND companies_created < max_companies
  `;

  if (updatedRows === 0) {
    // The atomic update didn't apply — read-only, so it's safe to run
    // after the fact purely to produce a specific, accurate error
    // message (token missing vs. inactive vs. exhausted) rather than one
    // generic failure.
    const check = await checkLicenseToken(tx, tokenValue);
    throw new PharmacyServiceError(check.message ?? 'Invalid license token', 'INVALID_LICENSE_TOKEN');
  }

  const token = await tx.licenseToken.findUnique({ where: { token: tokenValue } });
  return token!.id;
}
