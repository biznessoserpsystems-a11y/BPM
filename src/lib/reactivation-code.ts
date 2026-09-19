// Excludes 0/O and 1/I/L — characters people commonly mistype when
// reading a short code off a screen and typing it into another field.
const SAFE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateReactivationCode(length = 8): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)];
  }
  return code;
}
