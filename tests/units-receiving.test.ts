import { describe, it, expect, beforeAll } from 'vitest';
import { db, createTestContext, createTestProduct, createTestUserWithRole, type TestContext, type TestUser } from './fixtures';
import { makeRequest, routeParams, jsonOf } from './request-helpers';
import { POST as receive } from '../src/app/api/v1/inventory/batches/route';
import { GET as getUnits } from '../src/app/api/v1/product-units/route';
import { PUT as putUnits } from '../src/app/api/v1/products/[id]/units/route';

// Receiving stock in packaging units ("5 boxes", 1 box = 10 pieces), against a
// real database. Stock is always stored in the product's base unit.

let seq = 0;
function receiveReq(ctx: TestContext, productId: number, extra: Record<string, unknown>, caller: TestUser = ctx.admin) {
  return receive(
    makeRequest('/api/v1/inventory/batches', {
      token: caller.token,
      body: {
        branchId: ctx.branchId,
        productId,
        batchNumber: `UNITS-${ctx.suffix}-${++seq}`,
        expiryDate: '2030-12-31',
        purchasePrice: 0,
        sellingPrice: 5,
        quantityReceived: 1,
        receivedByUserId: caller.id,
        ...extra,
      },
    })
  );
}

function saveUnits(ctx: TestContext, productId: number, body: unknown, caller: TestUser = ctx.admin) {
  return putUnits(
    makeRequest(`/api/v1/products/${productId}/units`, { method: 'PUT', token: caller.token, body }),
    routeParams({ id: String(productId) })
  );
}

describe('receiving stock in packaging units', () => {
  let ctx: TestContext;
  let staff: TestUser;

  beforeAll(async () => {
    ctx = await createTestContext('unitsrx');
    staff = await createTestUserWithRole(ctx, 'PHARMACIST', 'unitsrx-staff');
  });

  it('a product with no setup behaves exactly as before: whole units, price as typed', async () => {
    const p = await createTestProduct(ctx);
    const res = await receiveReq(ctx, p.id, { quantityReceived: 24, purchasePrice: 2.5 });
    expect(res.status).toBe(201);
    const batch = await jsonOf(res);
    expect(batch.quantityReceived).toBe(24);
    expect(batch.quantityInStock).toBe(24);
    expect(batch.purchasePrice).toBe(2.5);
    expect(batch.received).toMatchObject({ unit: 'piece', unitsPer: 1, baseQuantity: 24 });
  });

  it('1 box = 10 pieces set up on the form: 5 boxes puts 50 pieces in stock, box price becomes a per-piece cost', async () => {
    const p = await createTestProduct(ctx);
    const res = await receiveReq(ctx, p.id, {
      receivingUnit: 'box',
      defineUnit: { name: 'box', unitsPer: 10 },
      quantityReceived: 5,
      purchasePrice: 100, // per box
      sellingPrice: 12, // per piece
    });
    expect(res.status).toBe(201);
    const batch = await jsonOf(res);
    expect(batch.quantityReceived).toBe(50);
    expect(batch.quantityInStock).toBe(50);
    expect(batch.purchasePrice).toBe(10); // 100 per box / 10 pieces
    expect(batch.sellingPrice).toBe(12); // untouched
    expect(batch.received).toEqual({ quantity: 5, unit: 'box', unitsPer: 10, baseQuantity: 50, baseUnit: 'piece' });

    const stored = await db.productBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(stored.quantityInStock).toBe(50);
  });

  it('"1 pac = 10 strips" with a custom base unit', async () => {
    const p = await createTestProduct(ctx);
    const res = await receiveReq(ctx, p.id, {
      receivingUnit: 'pac',
      defineUnit: { name: 'pac', unitsPer: 10, baseUnit: 'strip' },
      quantityReceived: 3,
      purchasePrice: 50,
    });
    expect(res.status).toBe(201);
    expect((await jsonOf(res)).received).toMatchObject({ unit: 'pac', baseUnit: 'strip', baseQuantity: 30 });
    const units = await jsonOf(await getUnits(makeRequest(`/api/v1/product-units?productId=${p.id}`, { token: ctx.admin.token })));
    expect(units).toEqual({ productId: p.id, baseUnit: 'strip', packs: [{ name: 'pac', unitsPer: 10 }] });
  });

  it('once set up, later receipts just name the unit', async () => {
    const p = await createTestProduct(ctx);
    await receiveReq(ctx, p.id, { receivingUnit: 'box', defineUnit: { name: 'box', unitsPer: 12 }, quantityReceived: 1 });
    const res = await receiveReq(ctx, p.id, { receivingUnit: 'BOX', quantityReceived: 2, purchasePrice: 24 });
    expect(res.status).toBe(201);
    const batch = await jsonOf(res);
    expect(batch.quantityInStock).toBe(24);
    expect(batch.purchasePrice).toBe(2);
  });

  it('receiving in the base unit by name needs no conversion', async () => {
    const p = await createTestProduct(ctx);
    await saveUnits(ctx, p.id, { baseUnit: 'strip', packs: [{ name: 'pack', unitsPer: 10 }] });
    const res = await receiveReq(ctx, p.id, { receivingUnit: 'strip', quantityReceived: 7, purchasePrice: 3 });
    const batch = await jsonOf(res);
    expect(batch.quantityInStock).toBe(7);
    expect(batch.purchasePrice).toBe(3);
  });

  it('refuses a unit the product has no setup for, and stores nothing', async () => {
    const p = await createTestProduct(ctx);
    const before = await db.productBatch.count({ where: { productId: p.id } });
    const res = await receiveReq(ctx, p.id, { receivingUnit: 'carton', quantityReceived: 1 });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toMatch(/isn't set up/);
    expect(await db.productBatch.count({ where: { productId: p.id } })).toBe(before);
  });

  it('refuses to silently change an existing conversion from the receive form', async () => {
    const p = await createTestProduct(ctx);
    await saveUnits(ctx, p.id, { packs: [{ name: 'box', unitsPer: 10 }] });
    const res = await receiveReq(ctx, p.id, { receivingUnit: 'box', defineUnit: { name: 'box', unitsPer: 20 }, quantityReceived: 1 });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toMatch(/already set up as 10 piece/);
    const units = await jsonOf(await getUnits(makeRequest(`/api/v1/product-units?productId=${p.id}`, { token: ctx.admin.token })));
    expect(units.packs).toEqual([{ name: 'box', unitsPer: 10 }]);
  });

  it('a failed receipt does not leave a half-saved unit behind', async () => {
    const p = await createTestProduct(ctx);
    // valid new unit, but a quantity that is invalid -> whole receipt rolls back
    const res = await receiveReq(ctx, p.id, { receivingUnit: 'box', defineUnit: { name: 'box', unitsPer: 10 }, quantityReceived: 1.5 });
    expect(res.status).toBe(400);
    const units = await jsonOf(await getUnits(makeRequest(`/api/v1/product-units?productId=${p.id}`, { token: ctx.admin.token })));
    expect(units.packs).toEqual([]);
  });

  it.each([0, -3, 2.5])('rejects a quantity of %s', async (quantityReceived) => {
    const p = await createTestProduct(ctx);
    const res = await receiveReq(ctx, p.id, { quantityReceived });
    expect(res.status).toBe(400);
  });

  it('leaves a trail when a conversion happened (and only then)', async () => {
    const p = await createTestProduct(ctx);
    const plain = await jsonOf(await receiveReq(ctx, p.id, { quantityReceived: 4 }));
    const packed = await jsonOf(await receiveReq(ctx, p.id, { receivingUnit: 'box', defineUnit: { name: 'box', unitsPer: 10 }, quantityReceived: 2 }));
    expect(await db.systemAuditLog.findFirst({ where: { action: 'RECEIVE_BATCH_IN_PACKS', entityId: String(plain.id) } })).toBeNull();
    const entry = await db.systemAuditLog.findFirst({ where: { action: 'RECEIVE_BATCH_IN_PACKS', entityId: String(packed.id) } });
    expect(entry).not.toBeNull();
    expect(entry!.userId).toBe(ctx.admin.id);
    expect(entry!.details).toContain('20 piece');
  });

  it('staff can set up a NEW unit while receiving', async () => {
    const p = await createTestProduct(ctx);
    const res = await receiveReq(ctx, p.id, { receivingUnit: 'box', defineUnit: { name: 'box', unitsPer: 10 }, quantityReceived: 1 }, staff);
    expect(res.status).toBe(201);
  });

  it('cannot receive against another company\'s product', async () => {
    const other = await createTestContext('unitsrx-other');
    const foreign = await createTestProduct(other);
    const res = await receiveReq(ctx, foreign.id, { quantityReceived: 5 });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe('Product not found');
    expect(await db.productBatch.count({ where: { productId: foreign.id } })).toBe(0);
  });
});

describe('managing unit setups', () => {
  let ctx: TestContext;
  let manager: TestUser;
  let staff: TestUser;

  beforeAll(async () => {
    ctx = await createTestContext('unitsset');
    manager = await createTestUserWithRole(ctx, 'MANAGER', 'unitsset-mgr');
    staff = await createTestUserWithRole(ctx, 'PHARMACIST', 'unitsset-staff');
  });

  it('an Admin or Manager can save a setup and read it back', async () => {
    const p = await createTestProduct(ctx);
    const body = { baseUnit: 'Strip', packs: [{ name: 'Pack', unitsPer: 10 }, { name: 'carton', unitsPer: 100 }] };
    expect((await saveUnits(ctx, p.id, body, manager)).status).toBe(200);
    const got = await jsonOf(await getUnits(makeRequest(`/api/v1/product-units?productId=${p.id}`, { token: staff.token })));
    expect(got).toEqual({
      productId: p.id,
      baseUnit: 'strip',
      packs: [{ name: 'pack', unitsPer: 10 }, { name: 'carton', unitsPer: 100 }],
    });
  });

  it('saving replaces the old setup, and the default with no packs clears it', async () => {
    const p = await createTestProduct(ctx);
    await saveUnits(ctx, p.id, { packs: [{ name: 'box', unitsPer: 10 }] });
    await saveUnits(ctx, p.id, { baseUnit: 'piece', packs: [] });
    expect(await db.productUnit.count({ where: { productId: p.id } })).toBe(0);
  });

  it('staff cannot change setups', async () => {
    const p = await createTestProduct(ctx);
    const res = await saveUnits(ctx, p.id, { packs: [{ name: 'box', unitsPer: 10 }] }, staff);
    expect(res.status).toBe(403);
    expect(await db.productUnit.count({ where: { productId: p.id } })).toBe(0);
  });

  it('rejects an invalid setup with a readable message and changes nothing', async () => {
    const p = await createTestProduct(ctx);
    await saveUnits(ctx, p.id, { packs: [{ name: 'box', unitsPer: 10 }] });
    const res = await saveUnits(ctx, p.id, { packs: [{ name: 'box', unitsPer: 1 }] });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toMatch(/at least 2/);
    expect((await db.productUnit.findFirstOrThrow({ where: { productId: p.id, name: 'box' } })).unitsPer).toBe(10);
  });

  it('changing a setup does not touch stock already on hand', async () => {
    const p = await createTestProduct(ctx);
    const batch = await jsonOf(await receiveReq(ctx, p.id, { receivingUnit: 'box', defineUnit: { name: 'box', unitsPer: 10 }, quantityReceived: 5 }));
    await saveUnits(ctx, p.id, { baseUnit: 'tablet', packs: [{ name: 'box', unitsPer: 20 }] });
    expect((await db.productBatch.findUniqueOrThrow({ where: { id: batch.id } })).quantityInStock).toBe(50);
  });

  it('records the change in the audit log', async () => {
    const p = await createTestProduct(ctx);
    await saveUnits(ctx, p.id, { packs: [{ name: 'box', unitsPer: 10 }] });
    const entry = await db.systemAuditLog.findFirst({ where: { action: 'UPDATE_PRODUCT_UNITS', entityId: String(p.id) } });
    expect(entry).not.toBeNull();
    expect(entry!.userId).toBe(ctx.admin.id);
  });

  it('lists only the caller\'s own company\'s setups', async () => {
    const other = await createTestContext('unitsset-other');
    const mine = await createTestProduct(ctx);
    const theirs = await createTestProduct(other);
    await saveUnits(ctx, mine.id, { packs: [{ name: 'box', unitsPer: 10 }] });
    await saveUnits(other, theirs.id, { packs: [{ name: 'box', unitsPer: 6 }] }, other.admin);
    const list: { productId: number }[] = await jsonOf(await getUnits(makeRequest('/api/v1/product-units', { token: ctx.admin.token })));
    const ids = list.map((u) => u.productId);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });

  it('another company\'s product can neither be read nor changed', async () => {
    const other = await createTestContext('unitsset-other2');
    const theirs = await createTestProduct(other);
    const read = await getUnits(makeRequest(`/api/v1/product-units?productId=${theirs.id}`, { token: ctx.admin.token }));
    expect(read.status).toBe(400);
    const write = await saveUnits(ctx, theirs.id, { packs: [{ name: 'box', unitsPer: 10 }] });
    expect(write.status).toBe(400);
    expect(await db.productUnit.count({ where: { productId: theirs.id } })).toBe(0);
  });
});
