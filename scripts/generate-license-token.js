/**
 * Generates a new license token for self-service company registration.
 * Run directly on the server — there is no seller-facing admin panel in
 * this app for this, matching the same plain-JS pattern as
 * prisma/seed.js and prisma/backfill-company.js (no ts-node/tsx is
 * configured in this project, so this needs to run with plain `node`).
 *
 * Usage:
 *   node scripts/generate-license-token.js ["optional label, e.g. a customer name"] [maxCompanies]
 *
 * Examples:
 *   node scripts/generate-license-token.js
 *   node scripts/generate-license-token.js "Acme Pharmacy Group"
 *   node scripts/generate-license-token.js "Acme Pharmacy Group" 5
 */
const { PrismaClient } = require('@prisma/client');
const { randomInt } = require('crypto');

const prisma = new PrismaClient();

// Same safe-character set as reactivation codes — no 0/O or 1/I/L, since
// this is something a real customer will need to type accurately.
const SAFE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateToken() {
  // Four groups of four, license-key style — easier to read and type
  // correctly than one long unbroken string.
  const groups = [];
  for (let g = 0; g < 4; g++) {
    let group = '';
    for (let i = 0; i < 4; i++) {
      group += SAFE_CHARS[randomInt(SAFE_CHARS.length)];
    }
    groups.push(group);
  }
  return groups.join('-');
}

async function main() {
  const label = process.argv[2] || null;
  const maxCompanies = process.argv[3] ? parseInt(process.argv[3], 10) : 2;

  if (isNaN(maxCompanies) || maxCompanies < 1) {
    console.error('maxCompanies must be a positive number');
    process.exit(1);
  }

  const token = generateToken();

  const created = await prisma.licenseToken.create({
    data: { token, label, maxCompanies },
  });

  console.log('');
  console.log('License token created:');
  console.log('');
  console.log(`  ${created.token}`);
  console.log('');
  console.log(`  Allows up to ${maxCompanies} compan${maxCompanies === 1 ? 'y' : 'ies'} to be registered.`);
  if (label) console.log(`  Label: ${label}`);
  console.log('');
  console.log('Give this token to the customer — they enter it on the "Create a company" screen.');
  console.log('');
}

main()
  .catch((e) => {
    console.error('Failed to generate license token:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
