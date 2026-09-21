import type { Prisma, PrismaClient } from '@prisma/client';
import { PharmacyServiceError } from './errors';

type Tx = PrismaClient | Prisma.TransactionClient;

/**
 * Same opt-in shape as assertPeriodOpenForDate: a company with no
 * trialExpiresAt set (null) is unrestricted, forever — that's anything
 * created outside self-service registration.
 * Only a company that actually has a trial window checks it, and only
 * throws once that window has genuinely passed.
 *
 * Deliberately checked at login only, not on every subsequent API call —
 * retrofitting an expiry check into 100+ existing routes for a 30-day
 * trial window is a much larger, separate undertaking than blocking new
 * sessions from starting once a trial's over. In practice this means
 * someone whose trial expires mid-session keeps working until their
 * existing token's own 12-hour expiry (see signToken in src/lib/auth.ts),
 * not until they close the tab — a known, deliberate scope boundary, not
 * an oversight.
 */
export async function assertCompanyActive(tx: Tx, companyId: string): Promise<void> {
  const company = await tx.company.findUnique({ where: { id: companyId } });
  if (!company) {
    throw new PharmacyServiceError('Company not found');
  }
  if (company.trialExpiresAt && company.trialExpiresAt < new Date()) {
    throw new PharmacyServiceError(
      `${company.name}'s 30-day trial ended on ${company.trialExpiresAt.toLocaleDateString()}. Request a reactivation code to continue.`,
      'TRIAL_EXPIRED'
    );
  }
}

/** Days remaining until trialExpiresAt, or null if the company has no trial window. */
export function daysUntilTrialExpiry(trialExpiresAt: Date | null): number | null {
  if (!trialExpiresAt) return null;
  const ms = trialExpiresAt.getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}
