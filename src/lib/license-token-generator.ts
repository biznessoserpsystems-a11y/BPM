// Same generation logic as scripts/generate-license-token.js's inline
// generateToken() — duplicated rather than shared, because that script is
// plain JS run directly with `node` (no ts-node/tsx configured in this
// project, matching prisma/seed.js and prisma/backfill-company.js), so it
// can't import a TypeScript module from src/. This file exists so the
// new web-based admin route (src/app/api/v1/admin/license-tokens/route.ts)
// has the same generator available at build/runtime. If you change the
// format here, update the CLI script's copy too.

// No 0/O or 1/I/L — a real customer has to type this accurately.
const SAFE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Four groups of four, license-key style — easier to read and type
 *  correctly than one long unbroken string. */
export function generateLicenseToken(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let group = '';
    for (let i = 0; i < 4; i++) {
      group += SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)];
    }
    groups.push(group);
  }
  return groups.join('-');
}
