import { describe, it, expect, beforeAll } from 'vitest';
import {
  db,
  createTestContext,
  createTestProduct,
  createTestBatch,
  createTestSupplier,
  createTestUserWithRole,
  type TestContext,
  type TestUser,
} from './fixtures';
import { makeRequest, routeParams, jsonOf } from './request-helpers';
import { PATCH as editBatch } from '../src/app/api/v1/inventory/batches/[id]/route';
import { POST as adjustStock } from '../src/app/api/v1/stock-adjustments/route';
import { GET as myPermissions } from '../src/app/api/v1/auth/me/permissions/route';
import { GET as getGrants, PUT as putGrant } from '../src/app/api/v1/auth/users/[id]/permissions/route';

// Editing received stock, changing expiry dates, and adjusting stock — and an
// Admin granting (or taking away) each of those for a specific person. All of
// it enforced by the API, against a real database.

function edit(batchId: string, caller: TestUser, body: Record<string, unknown>) {
  return editBatch(
    makeRequest(`/api/v1/inventory/batches/${batchId}`, { method: 'PATCH', token: caller.token, body }),
    routeParams({ id: batchId })
  );
}

function adjust(ctx: TestContext, caller: TestUser, batch: { id: string; productId: number }, quantityChanged: number, reason = 'Damaged') {
  return adjustStock(
    makeRequest('/api/v1/stock-adjustments', {
      token: caller.token,
      body: { branchId: ctx.branchId, batchId: batch.id, productId: batch.productId, userId: caller.id, quantityChanged, reason },
    })
  );
}

function grant(ctx: TestContext, caller: TestUser, target: TestUser, permission: string, setting: string) {
  return putGrant(
    makeRequest(`/api/v1/auth/users/${target.id}/permissions`, { method: 'PUT', token: caller.token, body: { permission, setting } }),
    routeParams({ id: String(target.id) })
  );
}

async function mine(caller: TestUser): Promise<Record<string, boolean>> {
  return (await jsonOf(await myPermissions(makeRequest('/api/v1/auth/me/permissions', { token: caller.token })))).permissions;
}

const stock = async (batchId: string) => (await db.productBatch.findUniqueOrThrow({ where: { id: batchId } })).quantityInStock;

describe('editing a received batch', () => {
  let ctx: TestContext;
  let manager: TestUser;
  let employee: TestUser;
  let productId: number;

  beforeAll(async () => {
    ctx = await createTestContext('invedit');
    manager = await createTestUserWithRole(ctx, 'MANAGER', 'invedit-mgr');
    employee = await createTestUserWithRole(ctx, 'EMPLOYEE', 'invedit-emp');
    productId = (await createTestProduct(ctx)).id;
  });

  it('an Admin can correct the batch number, supplier and prices, and it is audit-logged with before/after', async () => {
    const batch = await createTestBatch(ctx, productId);
    const supplier = await createTestSupplier(ctx);
    const res = await edit(batch.id, ctx.admin, { batchNumber: ' LOT-9 ', supplierId: supplier.id, purchasePrice: 7.5, sellingPrice: 12 });
    expect(res.status).toBe(200);
    const stored = await db.productBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(stored).toMatchObject({ batchNumber: 'LOT-9', supplierId: supplier.id, purchasePrice: 7.5, sellingPrice: 12 });
    expect(stored.quantityInStock).toBe(100); // quantity is never touched here

    const log = await db.systemAuditLog.findFirst({ where: { action: 'EDIT_BATCH', entityId: batch.id } });
    expect(log).not.toBeNull();
    expect(log!.userId).toBe(ctx.admin.id);
    expect(log!.details).toContain('"purchasePrice":{"from":5,"to":7.5}');
  });

  it('a Manager or Employee cannot edit by default', async () => {
    const batch = await createTestBatch(ctx, productId);
    for (const who of [manager, employee]) {
      const res = await edit(batch.id, who, { sellingPrice: 99 });
      expect(res.status).toBe(403);
      expect((await jsonOf(res)).error).toMatch(/edit batch details/i);
    }
    expect((await db.productBatch.findUniqueOrThrow({ where: { id: batch.id } })).sellingPrice).toBe(10);
  });

  it('once an Admin grants it, they can — and only that', async () => {
    const batch = await createTestBatch(ctx, productId);
    expect((await grant(ctx, ctx.admin, employee, 'inventory.edit', 'ALLOW')).status).toBe(200);
    expect((await edit(batch.id, employee, { sellingPrice: 15 })).status).toBe(200);
    // the grant covers prices, not expiry
    const res = await edit(batch.id, employee, { expiryDate: '2031-01-31', reason: 'supplier correction' });
    expect(res.status).toBe(403);
    expect((await jsonOf(res)).error).toMatch(/change expiry dates/i);
  });

  it('takes effect immediately when revoked — no re-login needed', async () => {
    const batch = await createTestBatch(ctx, productId);
    await grant(ctx, ctx.admin, manager, 'inventory.edit', 'ALLOW');
    expect((await edit(batch.id, manager, { sellingPrice: 11 })).status).toBe(200);
    await grant(ctx, ctx.admin, manager, 'inventory.edit', 'DEFAULT');
    expect((await edit(batch.id, manager, { sellingPrice: 12 })).status).toBe(403);
  });

  it('changing the expiry date needs its own permission AND a reason, and records both', async () => {
    const batch = await createTestBatch(ctx, productId);
    const noReason = await edit(batch.id, ctx.admin, { expiryDate: '2031-06-30' });
    expect(noReason.status).toBe(400);
    expect((await jsonOf(noReason)).error).toMatch(/reason/i);

    const ok = await edit(batch.id, ctx.admin, { expiryDate: '2031-06-30', reason: 'Label misread at receiving' });
    expect(ok.status).toBe(200);
    expect((await db.productBatch.findUniqueOrThrow({ where: { id: batch.id } })).expiryDate.toISOString().slice(0, 10)).toBe('2031-06-30');
    const log = await db.systemAuditLog.findFirst({ where: { action: 'EDIT_BATCH_EXPIRY', entityId: batch.id } });
    expect(log!.details).toContain('Label misread at receiving');
    expect(log!.details).toContain('2031-06-30');
  });

  it('a person with only the expiry permission can change expiry but not prices', async () => {
    const batch = await createTestBatch(ctx, productId);
    const expiryOnly = await createTestUserWithRole(ctx, 'EMPLOYEE', 'invedit-expiry');
    await grant(ctx, ctx.admin, expiryOnly, 'inventory.edit_expiry', 'ALLOW');
    expect((await edit(batch.id, expiryOnly, { expiryDate: '2032-02-02', reason: 'recheck' })).status).toBe(200);
    expect((await edit(batch.id, expiryOnly, { sellingPrice: 50 })).status).toBe(403);
  });

  it('a change that needs two permissions is refused unless the person has both, and nothing is applied', async () => {
    const batch = await createTestBatch(ctx, productId);
    const priceOnly = await createTestUserWithRole(ctx, 'EMPLOYEE', 'invedit-priceonly');
    await grant(ctx, ctx.admin, priceOnly, 'inventory.edit', 'ALLOW');
    const res = await edit(batch.id, priceOnly, { sellingPrice: 77, expiryDate: '2033-03-03', reason: 'both' });
    expect(res.status).toBe(403);
    const stored = await db.productBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(stored.sellingPrice).toBe(10);
  });

  it('refuses nothing-to-change, bad values, and a duplicate batch number', async () => {
    const a = await createTestBatch(ctx, productId);
    const b = await createTestBatch(ctx, productId);
    expect((await edit(a.id, ctx.admin, { sellingPrice: a.sellingPrice })).status).toBe(400);
    expect((await edit(a.id, ctx.admin, { sellingPrice: 0 })).status).toBe(400);
    expect((await edit(a.id, ctx.admin, { purchasePrice: -1 })).status).toBe(400);
    expect((await edit(a.id, ctx.admin, { batchNumber: '   ' })).status).toBe(400);
    expect((await edit(a.id, ctx.admin, { expiryDate: 'not a date', reason: 'x y z' })).status).toBe(400);
    const dup = await edit(a.id, ctx.admin, { batchNumber: b.batchNumber });
    expect(dup.status).toBe(400);
    expect((await jsonOf(dup)).error).toMatch(/already has a batch numbered/);
  });

  it('never changes quantity — a quantityInStock field is simply ignored', async () => {
    const batch = await createTestBatch(ctx, productId, { quantity: 40 });
    const res = await edit(batch.id, ctx.admin, { sellingPrice: 13, quantityInStock: 9999 });
    expect(res.status).toBe(200);
    expect(await stock(batch.id)).toBe(40);
  });

  it("another company's batch cannot be edited or even confirmed to exist", async () => {
    const other = await createTestContext('invedit-other');
    const theirs = await createTestBatch(other, (await createTestProduct(other)).id);
    const res = await edit(theirs.id, ctx.admin, { sellingPrice: 1 });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe('Batch not found');
    expect((await db.productBatch.findUniqueOrThrow({ where: { id: theirs.id } })).sellingPrice).toBe(10);
  });

  it("a supplier from another company cannot be attached", async () => {
    const other = await createTestContext('invedit-other2');
    const foreignSupplier = await createTestSupplier(other);
    const batch = await createTestBatch(ctx, productId);
    const res = await edit(batch.id, ctx.admin, { supplierId: foreignSupplier.id });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe('Supplier not found');
  });
});

describe('making stock adjustments', () => {
  let ctx: TestContext;
  let manager: TestUser;
  let employee: TestUser;
  let productId: number;

  beforeAll(async () => {
    ctx = await createTestContext('invadj');
    manager = await createTestUserWithRole(ctx, 'MANAGER', 'invadj-mgr');
    employee = await createTestUserWithRole(ctx, 'EMPLOYEE', 'invadj-emp');
    productId = (await createTestProduct(ctx)).id;
  });

  it('Admin, Manager and Employee can adjust by default — exactly as before', async () => {
    const batch = await createTestBatch(ctx, productId, { quantity: 50 });
    for (const who of [ctx.admin, manager, employee]) {
      expect((await adjust(ctx, who, batch, -1)).status).toBe(201);
    }
    expect(await stock(batch.id)).toBe(47);
  });

  it('adds stock with a positive number and removes it with a negative one', async () => {
    const batch = await createTestBatch(ctx, productId, { quantity: 10 });
    expect((await adjust(ctx, ctx.admin, batch, 5, 'Recount')).status).toBe(201);
    expect(await stock(batch.id)).toBe(15);
    expect((await adjust(ctx, ctx.admin, batch, -4, 'Damaged')).status).toBe(201);
    expect(await stock(batch.id)).toBe(11);
  });

  it('refuses to remove more than is in stock, and changes nothing', async () => {
    const batch = await createTestBatch(ctx, productId, { quantity: 3 });
    const res = await adjust(ctx, ctx.admin, batch, -5);
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toMatch(/Only 3 in stock/);
    expect(await stock(batch.id)).toBe(3);
  });

  it.each([0, 1.5, -2.5])('refuses a change of %s', async (qty) => {
    const batch = await createTestBatch(ctx, productId, { quantity: 10 });
    expect((await adjust(ctx, ctx.admin, batch, qty)).status).toBe(400);
    expect(await stock(batch.id)).toBe(10);
  });

  it('an Admin can take adjusting away from a specific person, and give it back', async () => {
    const batch = await createTestBatch(ctx, productId, { quantity: 20 });
    expect((await grant(ctx, ctx.admin, employee, 'inventory.adjust', 'DENY')).status).toBe(200);
    const res = await adjust(ctx, employee, batch, -1);
    expect(res.status).toBe(403);
    expect(await stock(batch.id)).toBe(20);
    // others are unaffected
    expect((await adjust(ctx, manager, batch, -1)).status).toBe(201);
    await grant(ctx, ctx.admin, employee, 'inventory.adjust', 'DEFAULT');
    expect((await adjust(ctx, employee, batch, -1)).status).toBe(201);
  });

  it('a role with no default (here a pharmacist) can adjust once granted', async () => {
    const batch = await createTestBatch(ctx, productId, { quantity: 20 });
    const pharmacist = await createTestUserWithRole(ctx, 'PHARMACIST', 'invadj-ph');
    expect((await adjust(ctx, pharmacist, batch, -1)).status).toBe(403);
    await grant(ctx, ctx.admin, pharmacist, 'inventory.adjust', 'ALLOW');
    expect((await adjust(ctx, pharmacist, batch, -1)).status).toBe(201);
  });

  it("cannot adjust another company's batch, or a batch under the wrong branch/product", async () => {
    const other = await createTestContext('invadj-other');
    const theirs = await createTestBatch(other, (await createTestProduct(other)).id, { quantity: 10 });
    const res = await adjustStock(
      makeRequest('/api/v1/stock-adjustments', {
        token: ctx.admin.token,
        body: { branchId: ctx.branchId, batchId: theirs.id, productId: theirs.productId, userId: ctx.admin.id, quantityChanged: -5, reason: 'Damaged' },
      })
    );
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe('Batch not found at this branch');
    expect(await stock(theirs.id)).toBe(10);

    const mine = await createTestBatch(ctx, productId, { quantity: 10 });
    const wrongProduct = await createTestProduct(ctx);
    const res2 = await adjust(ctx, ctx.admin, { id: mine.id, productId: wrongProduct.id }, -1);
    expect(res2.status).toBe(400);
    expect(await stock(mine.id)).toBe(10);
  });
});

describe('granting access', () => {
  let ctx: TestContext;
  let manager: TestUser;
  let employee: TestUser;

  beforeAll(async () => {
    ctx = await createTestContext('invgrant');
    manager = await createTestUserWithRole(ctx, 'MANAGER', 'invgrant-mgr');
    employee = await createTestUserWithRole(ctx, 'EMPLOYEE', 'invgrant-emp');
  });

  it("each person's own permissions are reported correctly, including after a grant and a denial", async () => {
    expect(await mine(ctx.admin)).toMatchObject({ 'inventory.edit': true, 'inventory.edit_expiry': true, 'inventory.adjust': true });
    expect(await mine(manager)).toMatchObject({ 'inventory.edit': false, 'inventory.edit_expiry': false, 'inventory.adjust': true });
    await grant(ctx, ctx.admin, manager, 'inventory.edit_expiry', 'ALLOW');
    await grant(ctx, ctx.admin, manager, 'inventory.adjust', 'DENY');
    expect(await mine(manager)).toMatchObject({ 'inventory.edit': false, 'inventory.edit_expiry': true, 'inventory.adjust': false });
  });

  it('only an Admin can grant — a Manager cannot grant themselves or anyone else', async () => {
    for (const target of [manager, employee]) {
      const res = await grant(ctx, manager, target, 'inventory.edit_expiry', 'ALLOW');
      expect(res.status).toBe(403);
    }
    expect((await grant(ctx, employee, employee, 'inventory.edit', 'ALLOW')).status).toBe(403);
    expect((await mine(employee))['inventory.edit']).toBe(false);
  });

  it('shows the Admin what each person has: role default, override, and the result', async () => {
    await grant(ctx, ctx.admin, employee, 'inventory.edit', 'ALLOW');
    const view = await jsonOf(
      await getGrants(makeRequest(`/api/v1/auth/users/${employee.id}/permissions`, { token: ctx.admin.token }), routeParams({ id: String(employee.id) }))
    );
    expect(view.locked).toBe(false);
    const edit = view.permissions.find((p: { key: string }) => p.key === 'inventory.edit');
    expect(edit).toMatchObject({ roleDefault: false, setting: 'ALLOW', effective: true });
    const adjustPerm = view.permissions.find((p: { key: string }) => p.key === 'inventory.adjust');
    expect(adjustPerm).toMatchObject({ roleDefault: true, setting: null, effective: true });
  });

  it('Admins always have everything and cannot be restricted', async () => {
    const res = await grant(ctx, ctx.admin, ctx.admin, 'inventory.adjust', 'DENY');
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toMatch(/always have every inventory permission/);
    expect((await mine(ctx.admin))['inventory.adjust']).toBe(true);
  });

  it('rejects unknown permissions and settings', async () => {
    expect((await grant(ctx, ctx.admin, employee, 'inventory.delete', 'ALLOW')).status).toBe(400);
    expect((await grant(ctx, ctx.admin, employee, 'inventory.edit', 'MAYBE')).status).toBe(400);
  });

  it('records every grant and revoke in the audit log', async () => {
    await grant(ctx, ctx.admin, employee, 'inventory.edit_expiry', 'ALLOW');
    await grant(ctx, ctx.admin, employee, 'inventory.edit_expiry', 'DEFAULT');
    const entries = await db.systemAuditLog.findMany({
      where: { action: 'UPDATE_USER_PERMISSION', entityId: String(employee.id) },
      orderBy: { id: 'asc' },
    });
    const expiry = entries.filter((e) => e.details?.includes('inventory.edit_expiry'));
    expect(expiry.length).toBeGreaterThanOrEqual(2);
    expect(expiry.at(-2)!.details).toContain('"to":"ALLOW"');
    expect(expiry.at(-1)!.details).toContain('"from":"ALLOW"');
    expect(expiry.at(-1)!.details).toContain('"to":"DEFAULT"');
    expect(expiry.at(-1)!.userId).toBe(ctx.admin.id);
  });

  it("another company's users can neither be read nor granted anything", async () => {
    const other = await createTestContext('invgrant-other');
    const theirs = await createTestUserWithRole(other, 'EMPLOYEE', 'invgrant-theirs');
    const res = await grant(ctx, ctx.admin, theirs, 'inventory.edit', 'ALLOW');
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe('User not found');
    expect(await db.userPermission.count({ where: { userId: theirs.id } })).toBe(0);
    const read = await getGrants(makeRequest(`/api/v1/auth/users/${theirs.id}/permissions`, { token: ctx.admin.token }), routeParams({ id: String(theirs.id) }));
    expect(read.status).toBe(400);
  });
});
