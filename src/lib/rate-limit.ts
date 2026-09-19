/**
 * In-memory brute-force protection for login. Locks out a username after
 * too many failed attempts in a short window.
 *
 * This is intentionally simple and appropriate for this app's actual
 * deployment model — a single long-running Node process (`npm start`),
 * not a serverless/multi-instance one. If this is ever deployed behind
 * multiple server instances or as serverless functions, this in-memory
 * Map won't be shared across them and stops being effective; that setup
 * needs a shared store instead (Redis, or a rate limiter at the edge/WAF
 * layer) rather than this module.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

interface Attempts {
  count: number;
  firstAttemptAt: number;
  lockedUntil: number | null;
}

const attemptsByUsername = new Map<string, Attempts>();

// Periodic cleanup so this doesn't grow unbounded over a long-running
// process's lifetime — stale entries (no longer locked, window expired)
// are dropped every hour.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attemptsByUsername) {
    const windowExpired = now - entry.firstAttemptAt > WINDOW_MS;
    const lockExpired = !entry.lockedUntil || now > entry.lockedUntil;
    if (windowExpired && lockExpired) {
      attemptsByUsername.delete(key);
    }
  }
}, 60 * 60 * 1000).unref();

/** Throws-free check: returns remaining lockout seconds, or null if not locked. */
export function checkLoginLockout(username: string): number | null {
  const entry = attemptsByUsername.get(username.toLowerCase());
  if (!entry?.lockedUntil) return null;
  const remainingMs = entry.lockedUntil - Date.now();
  if (remainingMs <= 0) return null;
  return Math.ceil(remainingMs / 1000);
}

/** Call after a failed password check. */
export function recordFailedLogin(username: string): void {
  const key = username.toLowerCase();
  const now = Date.now();
  const entry = attemptsByUsername.get(key);

  if (!entry || now - entry.firstAttemptAt > WINDOW_MS) {
    attemptsByUsername.set(key, { count: 1, firstAttemptAt: now, lockedUntil: null });
    return;
  }

  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_MS;
  }
}

/** Call after a successful login — clears any accumulated failed attempts. */
export function clearLoginAttempts(username: string): void {
  attemptsByUsername.delete(username.toLowerCase());
}

// ---------------------------------------------------------------------------
// Company registration — self-service, so unlike login there's no username
// to key on yet; this limits by IP instead. Deliberately more generous
// than the login lockout (registering a company is a rare, deliberate
// action, not something a legitimate user retries 5 times in 15 minutes)
// but still bounded, so scripting a flood of fake companies isn't free.
// ---------------------------------------------------------------------------

const REGISTRATION_MAX = 5;
const REGISTRATION_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const registrationsByIp = new Map<string, { count: number; firstAttemptAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of registrationsByIp) {
    if (now - entry.firstAttemptAt > REGISTRATION_WINDOW_MS) {
      registrationsByIp.delete(key);
    }
  }
}, 60 * 60 * 1000).unref();

/** Returns true if this IP is still within its allowance. */
export function checkRegistrationAllowed(ip: string): boolean {
  const entry = registrationsByIp.get(ip);
  if (!entry || Date.now() - entry.firstAttemptAt > REGISTRATION_WINDOW_MS) return true;
  return entry.count < REGISTRATION_MAX;
}

/** Call on every registration attempt (successful or not). */
export function recordRegistrationAttempt(ip: string): void {
  const now = Date.now();
  const entry = registrationsByIp.get(ip);
  if (!entry || now - entry.firstAttemptAt > REGISTRATION_WINDOW_MS) {
    registrationsByIp.set(ip, { count: 1, firstAttemptAt: now });
  } else {
    entry.count += 1;
  }
}
