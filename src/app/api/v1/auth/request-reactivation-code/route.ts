import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { checkRegistrationAllowed, recordRegistrationAttempt } from '@/lib/rate-limit';
import { generateReactivationCode } from '@/lib/reactivation-code';

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

const CODE_VALID_MINUTES = 60;

/**
 * Deliberately unauthenticated — the whole point is the requester can no
 * longer sign in. Reuses the same per-IP allowance as company
 * registration (5/hour) since both are rare, deliberate, self-service
 * actions rather than routine traffic.
 *
 * There is no email/SMS service configured in this deployment, so the
 * code is returned directly in the response rather than delivered
 * out-of-band. That's an honest limitation, not a placeholder for
 * something already working — a real deployment would email this
 * instead of displaying it.
 *
 * SECURITY NOTE: because this code is shown to whoever asks (not proven
 * to be the account owner), it must never be sufficient on its own to
 * log in — POST /api/v1/auth/reactivate also requires the account's
 * real password before it will exchange this code for a session. This
 * endpoint only ever hands out a code; it never authenticates anyone.
 *
 * Deliberately does NOT distinguish "no account with that username"
 * from "that account's trial hasn't expired" — both return the exact
 * same generic message. Login already avoids confirming whether a
 * username exists at all; returning two different, specific messages
 * here would have quietly reopened that same enumeration path through
 * this endpoint instead. A fully generic "if eligible, a code was
 * generated" response (never actually showing the code on failure)
 * would close this further, but this app has no email service to fall
 * back on — the code has to be shown directly to work at all, so full
 * request/response symmetry isn't available here the way it would be
 * in a system that emails the result instead.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request);
    if (!checkRegistrationAllowed(ip)) {
      throw new PharmacyServiceError('Too many requests from this connection — try again later.');
    }
    recordRegistrationAttempt(ip);

    const body = await request.json();
    const username: string | undefined = body.username?.trim();
    if (!username) {
      throw new PharmacyServiceError('username is required');
    }

    const genericFailure = () =>
      new PharmacyServiceError('Unable to generate a reactivation code for that username — check the username, or this account may not need one');

    const user = await db.user.findUnique({ where: { username } });
    if (!user) {
      throw genericFailure();
    }

    const company = await db.company.findUnique({ where: { id: user.companyId } });
    if (!company) {
      throw genericFailure();
    }
    if (!company.trialExpiresAt || company.trialExpiresAt >= new Date()) {
      throw genericFailure();
    }

    const code = generateReactivationCode();
    const expiresAt = new Date(Date.now() + CODE_VALID_MINUTES * 60 * 1000);

    await db.company.update({
      where: { id: company.id },
      data: { reactivationCode: code, reactivationCodeExpiresAt: expiresAt },
    });

    return NextResponse.json({
      code,
      expiresAt,
      companyName: company.name,
      note: 'This deployment has no email service configured, so the code is shown here directly rather than sent to you.',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
