import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { checkTokenCheckAllowed, recordTokenCheck } from '@/lib/rate-limit';
import { checkLicenseToken } from '@/lib/license-token';

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/**
 * Public and read-only — never consumes a slot, only reports whether one
 * exists. Still rate-limited, since it's a public endpoint someone could
 * otherwise use to enumerate tokens — but with its OWN allowance, not the
 * 5-per-hour company-registration one: the form calls this as the person
 * types or pastes, so sharing that tiny allowance made valid tokens look
 * broken after a couple of attempts (see rate-limit.ts).
 */
export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request);
    if (!checkTokenCheckAllowed(ip)) {
      throw new PharmacyServiceError('Too many token checks from this connection — wait a few minutes and try again.');
    }
    recordTokenCheck(ip);

    const body = await request.json();
    const token: string | undefined = body.token?.trim();
    if (!token) {
      throw new PharmacyServiceError('token is required');
    }

    const result = await checkLicenseToken(db, token);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
