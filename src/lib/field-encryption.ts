import crypto from 'crypto';

// Same "dev-only default, must be regenerated before real deployment"
// pattern as JWT_SECRET in src/lib/auth.ts — this key encrypts SSNIT
// numbers, TINs, and bank account numbers at rest (see
// src/app/api/v1/employees/route.ts and its [id] counterpart). Anyone
// who has this exact value can decrypt every employee's stored PII, so
// treat it with the same seriousness as JWT_SECRET, not as an
// afterthought.
const ENCRYPTION_KEY_RAW = process.env.FIELD_ENCRYPTION_KEY;

if (!ENCRYPTION_KEY_RAW) {
  throw new Error('FIELD_ENCRYPTION_KEY is not set in .env');
}
if (ENCRYPTION_KEY_RAW.length < 32) {
  throw new Error(
    'FIELD_ENCRYPTION_KEY is too short to be secure (< 32 chars). Generate one with: ' +
      `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
  );
}

// AES-256-GCM needs an exact 32-byte key — the env var itself can be any
// length (same as JWT_SECRET), so it's hashed down to exactly 32 bytes
// rather than truncated or padded.
const KEY = crypto.createHash('sha256').update(ENCRYPTION_KEY_RAW).digest();
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // standard for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypts a single field's plaintext value for storage. Returns a
 * single base64 string (iv + auth tag + ciphertext concatenated) that
 * fits in the same String? column the field already used — no schema
 * change needed, only what's stored inside it changes.
 */
export function encryptField(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypts a value produced by encryptField. Throws if the value was
 * tampered with (GCM's built-in authentication) or wasn't actually
 * encrypted by this function — callers should only call this on values
 * they know came from encryptField, never on arbitrary user input.
 */
export function decryptField(encoded: string): string {
  const data = Buffer.from(encoded, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/** Convenience wrapper — encrypts if present, passes through null/undefined unchanged. */
export function encryptFieldIfPresent(plaintext: string | null | undefined): string | null | undefined {
  if (plaintext == null) return plaintext;
  return encryptField(plaintext);
}

/**
 * Convenience wrapper for decrypting — passes through null/undefined,
 * and (deliberately) falls back to returning the raw stored value rather
 * than throwing if decryption fails. This specifically covers the
 * migration case: records created before this encryption existed have
 * plaintext values already in the database, and those would fail
 * decryption (they're not valid ciphertext) — falling back rather than
 * crashing the whole request means existing data keeps working, and
 * simply gets encrypted going forward the next time it's saved.
 */
export function decryptFieldIfPresent(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;
  try {
    return decryptField(value);
  } catch {
    return value;
  }
}
