const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * This seed script provisions only global, cross-tenant reference data —
 * the RBAC role taxonomy and the current accounting period. It does NOT
 * create any company, branch, user, or sample business data: a fresh
 * install starts genuinely empty, and the first real company/admin is
 * created through the "Create a company" flow on the login screen
 * (POST /api/v1/auth/register-company), which also seeds that company's
 * own starter currency, Chart of Accounts, GL mappings, and payroll tax
 * settings — see src/lib/default-accounting-setup.ts.
 */
async function main() {
  console.log('Seeding reference data...');

  // ROLES — RBAC taxonomy, not tenant business data, so these stay
  // global across every company on this deployment (see the Company
  // model's doc comment in prisma/schema.prisma for the full reasoning).
  console.log('  -> Roles...');
  await prisma.role.upsert({
    where: { roleName: 'ADMIN' },
    update: {},
    create: { roleName: 'ADMIN', description: 'System Administrator' },
  });

  await prisma.role.upsert({
    where: { roleName: 'MANAGER' },
    update: {},
    create: { roleName: 'MANAGER', description: 'Pharmacy Manager' },
  });

  const employeeRole = await prisma.role.upsert({
    where: { roleName: 'EMPLOYEE' },
    update: {},
    create: { roleName: 'EMPLOYEE', description: 'Pharmacy Employee (pharmacist or technician duties)' },
  });

  // Migration for databases seeded before PHARMACIST/TECHNICIAN were
  // consolidated into EMPLOYEE — reassigns any real user still on either
  // old role (by role ID, so this correctly covers real company staff on
  // an existing deployment) before removing the now-unreferenced role
  // rows. Safe to run repeatedly: once no user references them, findFirst
  // below returns null and this whole block is skipped.
  const oldPharmacistRole = await prisma.role.findFirst({ where: { roleName: 'PHARMACIST' } });
  const oldTechnicianRole = await prisma.role.findFirst({ where: { roleName: 'TECHNICIAN' } });
  const oldRoleIds = [oldPharmacistRole?.id, oldTechnicianRole?.id].filter((id) => id != null);
  if (oldRoleIds.length > 0) {
    console.log('  -> Migrating PHARMACIST/TECHNICIAN users to EMPLOYEE...');
    const { count } = await prisma.user.updateMany({
      where: { roleId: { in: oldRoleIds } },
      data: { roleId: employeeRole.id },
    });
    if (count > 0) console.log(`     Reassigned ${count} user(s) to EMPLOYEE.`);
    await prisma.role.deleteMany({ where: { id: { in: oldRoleIds } } });
  }

  // CURRENT ACCOUNTING PERIOD — genuinely global (unique by periodName,
  // no companyId on this model yet; see prisma/schema.prisma), so it
  // belongs here rather than in the per-company starter setup.
  console.log('  -> Accounting period...');
  const now = new Date();
  const periodName = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  await prisma.accountingPeriod.upsert({
    where: { periodName },
    update: {},
    create: {
      periodName,
      startDate: new Date(now.getFullYear(), now.getMonth(), 1),
      endDate: new Date(now.getFullYear(), now.getMonth() + 1, 0),
      status: 'OPEN',
    },
  });

  console.log('Seed complete! No company, users, or sample data were created.');
  console.log('Use "Create a company" on the login screen to set up the first real company and admin.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
