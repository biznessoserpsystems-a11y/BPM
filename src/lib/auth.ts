import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

export interface AuthPayload {
  userId: number;
  username: string;
  roleName: string;
  homeBranchId: string;
  companyId: string;
}

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set in .env');
}
// A short secret is brute-forceable and defeats the whole point of the
// warning already in .env — enforce a floor here rather than relying on
// everyone reading the comment. 32 chars is a minimum, not a target.
if (JWT_SECRET.length < 32) {
  throw new Error(
    'JWT_SECRET is too short to be secure (< 32 chars). Generate one with: ' +
      `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
  );
}

const JWT_ALGORITHM = 'HS256';

/**
 * Extracts and verifies the JWT from the Authorization header.
 * Returns the decoded payload or a 401 response if auth fails.
 * Use at the start of any protected API route.
 */
export function getAuthPayload(request: NextRequest): AuthPayload | NextResponse {
  const header = request.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Missing or malformed Authorization header' },
      { status: 401 }
    );
  }

  const token = header.slice('Bearer '.length);

  try {
    // Pin the algorithm explicitly rather than trusting the token's own
    // header — without this, jwt.verify() accepts any algorithm the
    // library supports, which is the setup for an algorithm-confusion
    // attack if that default behavior ever changes upstream.
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as AuthPayload;
    return payload;
  } catch {
    return NextResponse.json(
      { error: 'Invalid or expired token' },
      { status: 401 }
    );
  }
}

/**
 * Signs a JWT token for a user session.
 */
export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h', algorithm: JWT_ALGORITHM });
}

/**
 * Returns true if the response is a NextResponse (i.e., an auth error).
 * Use to check: `if (isAuthError(auth)) return auth;`
 */
export function isAuthError(result: AuthPayload | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}

/**
 * Role check for actions that need to be more restricted than "logged in" —
 * currently only period close/reopen. Kept as an opt-in helper rather than
 * something every route calls, since most of this app's routes don't gate
 * by role at all yet; this is deliberately narrow in scope.
 * Returns a 403 NextResponse if the role doesn't qualify, otherwise null.
 */
export function requireRole(auth: AuthPayload, allowedRoles: string[]): NextResponse | null {
  if (!allowedRoles.includes(auth.roleName)) {
    return NextResponse.json(
      { error: `This action requires one of these roles: ${allowedRoles.join(', ')}` },
      { status: 403 }
    );
  }
  return null;
}
