import bcrypt from 'bcryptjs';
import { db } from '../src/lib/db';
import { seedStarterAccounting } from '../src/lib/default-accounting-setup';
import { signToken } from '../src/lib/auth';

/** A unique-enough suffix so parallel test *files* (even though they run
 *  sequentially — see vitest.config.ts — this also protects against
 *  re-runs without a fresh DB) never collide on unique fields like
 *  Company.code or User.username. */
function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface TestUser {
  id: number;
  username: string;
  token: string;
  roleName: string;
  homeBranchId: string;
  companyId: string;
}

export interface TestContext {
  suffix: string;
  companyId: string;
  branchId: string;
  secondBranchId: string;
  admin: TestUser;
  /** Convenience: the ADMIN user's own auth headers, ready to spread into a fetch/NextRequest init. */
  adminAuthHeader: { authorization: string };
}

const PASSWORD = 'Test-Password-1234!';

async function makeUser(
  companyId: string,
  branchId: string,
  roleName: string,
  usernamePrefix: string
): Promise<TestUser> {
  const role = await db.role.findUniqueOrThrow({ where: { roleName } });
  const username = `${usernamePrefix}-${uniqueSuffix()}`;
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const user = await db.user.create({
    data: {
      companyId,
      username,
      passwordHash,
      fullName: `Test ${roleName}`,
      roleId: role.id,
      homeBranchId: branchId,
    },
  });
  const token = signToken({
    userId: user.id,
    username: user.username,
    roleName,
    homeBranchId: branchId,
    companyId,
  });
  return { id: user.id, username: user.username, token, roleName, homeBranchId: branchId, companyId };
}

/**
 * Creates one fully isolated tenant: a Company, two Branches (transfer
 * tests need a source and destination), a starter Chart of
 * Accounts/currency/GL mappings (same helper /auth/register-company
 * uses), and an ADMIN user. Every test file should call this once in a
 * `beforeAll` and build on top of it — never share a TestContext across
 * files, since each one asserts real side effects (stock levels, GL
 * postings) that would collide if two test files touched the same rows.
 */
export async function createTestContext(prefix: string): Promise<TestContext> {
  const suffix = uniqueSuffix();
  const company = await db.company.create({
    data: { code: `${prefix}-${suffix}`, name: `Test Co ${suffix}`, isActive: true },
  });
  const branch = await db.branch.create({
    data: { id: `BR-${prefix.toUpperCase()}-${suffix}`, name: 'Main Branch', isActive: true, companyId: company.id },
  });
  const secondBranch = await db.branch.create({
    data: { id: `BR2-${prefix.toUpperCase()}-${suffix}`, name: 'Second Branch', isActive: true, companyId: company.id },
  });
  await seedStarterAccounting(db, company.id);
  const admin = await makeUser(company.id, branch.id, 'ADMIN', `${prefix}-admin`);

  return {
    suffix,
    companyId: company.id,
    branchId: branch.id,
    secondBranchId: secondBranch.id,
    admin,
    adminAuthHeader: { authorization: `Bearer ${admin.token}` },
  };
}

export async function createTestUserWithRole(ctx: TestContext, roleName: string, prefix: string): Promise<TestUser> {
  return makeUser(ctx.companyId, ctx.branchId, roleName, prefix);
}

export interface TestProduct {
  id: number;
  skuCode: string;
}

export async function createTestProduct(ctx: TestContext, overrides: Partial<{ brandName: string; reorderLevel: number }> = {}): Promise<TestProduct> {
  const product = await db.product.create({
    data: {
      companyId: ctx.companyId,
      skuCode: `SKU-${uniqueSuffix()}`,
      brandName: overrides.brandName ?? 'Test Amoxicillin 500mg',
      genericName: 'Amoxicillin',
      category: 'Antibiotic',
      dosageForm: 'Capsule',
      reorderLevel: overrides.reorderLevel ?? 10,
      isPrescriptionRequired: false,
    },
  });
  return { id: product.id, skuCode: product.skuCode };
}

export interface TestSupplier {
  id: number;
  name: string;
}

export async function createTestSupplier(ctx: TestContext): Promise<TestSupplier> {
  const supplier = await db.supplier.create({
    data: { companyId: ctx.companyId, name: `Test Supplier ${uniqueSuffix()}`, phone: '0000000000' },
  });
  return { id: supplier.id, name: supplier.name };
}

/** Creates an in-stock batch directly (bypassing procurement) — useful for
 *  tests (checkout, transfers) that need existing stock but aren't
 *  themselves testing how that stock got there. */
export async function createTestBatch(
  ctx: TestContext,
  productId: number,
  opts: { branchId?: string; quantity?: number; purchasePrice?: number; sellingPrice?: number } = {}
) {
  return db.productBatch.create({
    data: {
      branchId: opts.branchId ?? ctx.branchId,
      productId,
      batchNumber: `BATCH-${uniqueSuffix()}`,
      expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      purchasePrice: opts.purchasePrice ?? 5,
      sellingPrice: opts.sellingPrice ?? 10,
      quantityReceived: opts.quantity ?? 100,
      quantityInStock: opts.quantity ?? 100,
    },
  });
}

export { db };
