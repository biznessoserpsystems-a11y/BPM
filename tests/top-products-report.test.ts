import { describe, it, expect, beforeAll } from 'vitest';
import { db, createTestContext, createTestProduct, createTestBatch, createTestUserWithRole, type TestContext, type TestUser } from './fixtures';
import { makeRequest, jsonOf } from './request-helpers';
import { GET as topProducts } from '../src/app/api/v1/reports/top-products/route';

// Top Products ranking against a real database. Window used: 1–30 Nov 2026, server-local time.

const at = (day: number, h = 12) => new Date(2026, 10, day, h, 0);
let seq = 0;

async function sell(ctx: TestContext, user: TestUser, when: Date, lines: { productId: number; batchId: string; quantity: number; unitPrice: number }[], branchId = ctx.branchId) {
  const subtotal = lines.reduce((n, l) => n + l.quantity * l.unitPrice, 0);
  return db.sale.create({
    data: {
      branchId, invoiceNumber: `INV-TP-${ctx.suffix}-${++seq}`, userId: user.id, subtotalAmount: subtotal, totalAmount: subtotal, paymentMethod: 'CASH', saleDate: when,
      saleItems: { create: lines.map((l) => ({ ...l, subtotal: l.quantity * l.unitPrice })) },
    },
    include: { saleItems: true },
  });
}

const get = (caller: TestUser, query: string) => topProducts(makeRequest(`/api/v1/reports/top-products?${query}`, { token: caller.token }));

describe('top products report', () => {
  let ctx: TestContext;
  let cashier: TestUser;
  let manager: TestUser;
  let para: { id: number; batchId: string };
  let amox: { id: number; batchId: string };
  let vitc: { id: number; batchId: string };

  beforeAll(async () => {
    ctx = await createTestContext('topprod');
    cashier = await createTestUserWithRole(ctx, 'EMPLOYEE', 'topprod-emp');
    manager = await createTestUserWithRole(ctx, 'MANAGER', 'topprod-mgr');
    const mk = async (brandName: string) => {
      const p = await createTestProduct(ctx, { brandName });
      return { id: p.id, batchId: (await createTestBatch(ctx, p.id)).id };
    };
    para = await mk('Paracetamol 500mg');
    amox = await mk('Amoxicillin 250mg');
    vitc = await mk('Vitamin C');

    await sell(ctx, cashier, at(3), [{ productId: para.id, batchId: para.batchId, quantity: 10, unitPrice: 5 }, { productId: amox.id, batchId: amox.batchId, quantity: 2, unitPrice: 30 }]);
    await sell(ctx, cashier, at(10), [{ productId: para.id, batchId: para.batchId, quantity: 5, unitPrice: 5 }]);
    await sell(ctx, cashier, at(12), [{ productId: vitc.id, batchId: vitc.batchId, quantity: 7, unitPrice: 4 }]);
    // outside the window, and another branch's sale
    await sell(ctx, cashier, new Date(2026, 9, 28, 12), [{ productId: vitc.id, batchId: vitc.batchId, quantity: 99, unitPrice: 4 }]);
    await sell(ctx, cashier, at(5), [{ productId: amox.id, batchId: amox.batchId, quantity: 50, unitPrice: 30 }], ctx.secondBranchId);
  });

  it('ranks products by quantity sold within the dates, adding up across invoices', async () => {
    const res = await get(manager, `from=2026-11-01&to=2026-11-30&branchId=${ctx.branchId}`);
    expect(res.status).toBe(200);
    const r = await jsonOf(res);
    expect(r.rows.map((x: { rank: number; productName: string; quantitySold: number }) => [x.rank, x.productName, x.quantitySold])).toEqual([
      [1, 'Paracetamol 500mg', 15], [2, 'Vitamin C', 7], [3, 'Amoxicillin 250mg', 2],
    ]);
    expect(r.rows[0]).toMatchObject({ revenue: 75, invoiceCount: 2 });
    expect(r.totalProducts).toBe(3);
  });

  it('can rank by revenue instead', async () => {
    const r = await jsonOf(await get(manager, `from=2026-11-01&to=2026-11-30&branchId=${ctx.branchId}&rankBy=revenue`));
    expect(r.rows.map((x: { productName: string }) => x.productName)).toEqual(['Paracetamol 500mg', 'Amoxicillin 250mg', 'Vitamin C']); // 75, 60, 28
  });

  it('the last day is included, and a manager sees all branches combined by default', async () => {
    const day = await jsonOf(await get(manager, 'from=2026-11-05&to=2026-11-05'));
    expect(day.rows.map((x: { productName: string; quantitySold: number }) => [x.productName, x.quantitySold])).toEqual([['Amoxicillin 250mg', 50]]);
  });

  it("a cashier only ever sees their own branch's sales", async () => {
    const r = await jsonOf(await get(cashier, 'from=2026-11-01&to=2026-11-30'));
    expect(r.rows.find((x: { productName: string }) => x.productName === 'Amoxicillin 250mg').quantitySold).toBe(2); // not 52
    const other = await get(cashier, `from=2026-11-01&to=2026-11-30&branchId=${ctx.secondBranchId}`);
    expect(other.status).not.toBe(200);
  });

  it('takes returns off the product they came back against', async () => {
    const sale = await sell(ctx, cashier, at(20), [{ productId: amox.id, batchId: amox.batchId, quantity: 4, unitPrice: 30 }]);
    await db.salesReturn.create({
      data: {
        saleId: sale.id, branchId: ctx.branchId, returnNumber: `SR-TP-${ctx.suffix}`, totalAmount: 60, processedByUserId: cashier.id,
        items: { create: [{ saleItemId: sale.saleItems[0].id, quantity: 2, amount: 60 }] },
      },
    });
    const r = await jsonOf(await get(manager, `from=2026-11-20&to=2026-11-20&branchId=${ctx.branchId}`));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ productName: 'Amoxicillin 250mg', quantitySold: 2, revenue: 60 });
  });

  it('refuses a missing, backwards or impossible date range', async () => {
    for (const q of ['', 'from=2026-11-01', 'from=2026-11-30&to=2026-11-01', 'from=2026-02-30&to=2026-03-01']) {
      expect((await get(manager, q)).status).not.toBe(200);
    }
  });

  it('only counts the caller\'s own company', async () => {
    const other = await createTestContext('topprod-other');
    const r = await jsonOf(await get(other.admin, 'from=2026-11-01&to=2026-11-30'));
    expect(r.rows).toEqual([]);
  });
});
