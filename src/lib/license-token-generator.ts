import { randomInt } from 'crypto';

// Same safe-character set as reactivation codes — no 0/O or 1/I/L, since
// this is something a real customer will need to type accurately.
const SAFE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Four groups of four, license-key style (e.g. K7QM-2XR9-HNP4-W3TD).
 * Uses crypto.randomInt rather than Math.random(): Math.random() is not
 * cryptographically secure, so tokens made with it are predictable.
 * (Validation/consumption logic lives in ./license-token.ts.)
 */
export function generateLicenseToken(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let group = '';
    for (let i = 0; i < 4; i++) {
      group += SAFE_CHARS[randomInt(SAFE_CHARS.length)];
    }
    groups.push(group);
  }
  return groups.join('-');
}
