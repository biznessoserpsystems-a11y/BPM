/**
 * One-time backfill for databases created BEFORE the Company model existed.
 * Plain JavaScript deliberately — this project has no ts-node/tsx
 * configured, so this runs directly with `node prisma/backfill-company.js`
 * with no extra tooling needed.
 *
 * Prisma's `db push` correctly refuses to add a required `companyId`
 * column to tables that already have rows — there's no value to put
 * there, and silently picking one would be worse than stopping. This
 * script is the safe fix: run it once, in between two `db push` calls,
 * to give every existing branch and user a real company before the
 * column is locked down to required. See the exact step-by-step sequence
 * in the delivery notes for when to run this relative to the two pushes.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Backfilling existing data into a default Company...');

  const defaultCompany = await prisma.company.upsert({
    where: { code: 'default' },
    update: {},
    create: { code: 'default', name: 'PharmaCare', isActive: true },
  });
  console.log(`  Default company: ${defaultCompany.name} (${defaultCompany.id})`);

  const branchResult = await prisma.branch.updateMany({
    where: { companyId: null },
    data: { companyId: defaultCompany.id },
  });
  console.log(`  Updated ${branchResult.count} branch(es)`);

  const userResult = await prisma.user.updateMany({
    where: { companyId: null },
    data: { companyId: defaultCompany.id },
  });
  console.log(`  Updated ${userResult.count} user(s)`);

  console.log('Done. Now switch companyId back to required in schema.prisma and run `npx prisma db push` again.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
