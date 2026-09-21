import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { generateLicenseToken } from '@/lib/license-token-generator';

export const dynamic = 'force-dynamic';

/**
 * Seller-facing license administration. This is deliberately NOT behind
 * the tenant login (JWT/roles): the people who log in to this app are
 * pharmacy staff, and a pharmacy admin must never be able to mint
 * licenses. Access instead requires a separate secret, LICENSE_ADMIN_SECRET
 * in the server's .env, sent in the x-admin-secret header. If it is
 * missing or too short the endpoint refuses to work at all.
 */
const MIN_SECRET_LENGTH = 24;

function secretMatches(provided: string, expected: string): boolean {
  // Hash both sides so lengths always match, then compare in constant time.
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// Failed-attempt limiter: 5 wrong secrets per IP per 15 minutes. In-memory,
// same single-process assumption as src/lib/rate-limit.ts.
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failsByIp = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of failsByIp) {
    if (entry.resetAt <= now) failsByIp.delete(ip);
  }
}, 60 * 60 * 1000).unref();

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/** Returns an error response if the caller is not authorized, otherwise null. */
function authorize(request: NextRequest): NextResponse | null {
  const expected = process.env.LICENSE_ADMIN_SECRET;
  if (!expected || expected.length < MIN_SECRET_LENGTH) {
    return NextResponse.json(
      { error: 'License admin is not configured on this server.' },
      { status: 503 }
    );
  }

  const ip = clientIp(request);
  const now = Date.now();
  const entry = failsByIp.get(ip);
  if (entry && entry.resetAt > now && entry.count >= MAX_FAILS) {
    return NextResponse.json(
      { error: 'Too many failed attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((entry.resetAt - now) / 1000)) } }
    );
  }

  const provided = request.headers.get('x-admin-secret') ?? '';
  if (!provided || !secretMatches(provided, expected)) {
    const current = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + WINDOW_MS };
    current.count += 1;
    failsByIp.set(ip, current);
    return NextResponse.json({ error: 'Invalid admin secret.' }, { status: 401 });
  }

  failsByIp.delete(ip);
  return null;
}

/** List all license tokens, newest first. */
export async function GET(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    const tokens = await db.licenseToken.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        token: true,
        label: true,
        maxCompanies: true,
        companiesCreated: true,
        isActive: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ tokens });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Create a token. Body: { label?: string, maxCompanies?: number (1–1000, default 2) } */
export async function POST(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    let body: { label?: unknown; maxCompanies?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      // An empty body is fine — defaults apply.
    }

    const label =
      typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 100) : null;

    const maxCompanies = body.maxCompanies === undefined ? 2 : Number(body.maxCompanies);
    if (!Number.isInteger(maxCompanies) || maxCompanies < 1 || maxCompanies > 1000) {
      return NextResponse.json(
        { error: 'maxCompanies must be a whole number between 1 and 1000.' },
        { status: 400 }
      );
    }

    // Retry on the (astronomically unlikely) chance of a duplicate token.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const created = await db.licenseToken.create({
          data: { token: generateLicenseToken(), label, maxCompanies },
          select: {
            id: true,
            token: true,
            label: true,
            maxCompanies: true,
            companiesCreated: true,
            isActive: true,
            createdAt: true,
          },
        });
        return NextResponse.json({ token: created }, { status: 201 });
      } catch (e: unknown) {
        if ((e as { code?: string })?.code !== 'P2002') throw e;
      }
    }
    return NextResponse.json({ error: 'Could not create a unique token. Try again.' }, { status: 500 });
  } catch (error) {
    return handleApiError(error);
  }
}
