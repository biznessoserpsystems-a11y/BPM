import { PrismaClient } from '@prisma/client';

/**
 * Runs once, before any test file, in the same process that will later
 * fork the single worker (see vitest.config.ts). Seeds only the handful
 * of rows that are genuinely global by design — Role definitions (see
 * the Company model's doc comment in prisma/schema.prisma for why Role
 * stays unscoped) — everything else (Company, Branch, Users, Chart of
 * Accounts, Products, ...) is created fresh per-test via tests/fixtures.ts
 * so tests never depend on shared, mutable state from one another.
 *
 * Requires the test database to already exist and be pushed to the
 * current schema — see the "pretest" script in package.json. This file
 * only seeds rows into it, it never creates or migrates the schema
 * itself.
 */
export default async function globalSetup() {
  const prisma = new PrismaClient();
  try {
    for (const roleName of ['ADMIN', 'MANAGER', 'PHARMACIST', 'TECHNICIAN']) {
      await prisma.role.upsert({
        where: { roleName },
        update: {},
        create: { roleName, description: roleName },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}
