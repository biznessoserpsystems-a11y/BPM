import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { checkRegistrationAllowed, recordRegistrationAttempt } from '@/lib/rate-limit';
import { checkLicenseToken } from '@/lib/license-token';

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/**
 * Public and read-only — never consumes a slot, only reports whether one
 * exists. Rate-limited the same as registration itself, since it's still
 * a public endpoint someone could otherwise use to enumerate tokens by
 * brute force.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request);
    if (!checkRegistrationAllowed(ip)) {
      throw new PharmacyServiceError('Too many attempts from this connection — try again later.');
    }
    recordRegistrationAttempt(ip);

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
