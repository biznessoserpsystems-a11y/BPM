import { describe, it, expect, beforeAll } from 'vitest';
import { db, createTestContext, createTestProduct, createTestBatch, createTestUserWithRole, type TestContext, type TestUser } from './fixtures';
import { makeRequest, jsonOf } from './request-helpers';
import { GET as weeklySales } from '../src/app/api/v1/reports/weekly-sales/route';

// The Weekly Sales Report: invoice ref, products sold, amounts, for one
// Monday–Sunday week. Run against a real database. The week used throughout
// is Monday 16 – Sunday 22 November 2026, in server-local time.

const at = (day: number, h = 12, min = 0, s = 0, ms = 0) => new Date(2026, 10, day, h, min, s, ms);

let seq = 0;
interface Line {
  productId: number;
  batchId: string;
  quantity: number;
  unitPrice: number;
}

async function makeSale(
  ctx: TestContext,
  user: TestUser,
  saleDate: Date,
  lines: Line[],
  opts: { branchId?: string; discount?: number; tax?: number; invoice?: string } = {}
) {
  const subtotal = lines.reduce((n, l) => n + l.quantity * l.unitPrice, 0);
  const discount = opts.discount ?? 0;
  const tax = opts.tax ?? 0;
  return db.sale.create({
    data: {
      branchId: opts.branchId ?? ctx.branchId,
      invoiceNumber: opts.invoice ?? `INV-${ctx.suffix}-${++seq}`,
      userId: user.id,
      subtotalAmount: subtotal,
      discountAmount: discount,
      taxAmount: tax,
      totalAmount: subtotal - discount + tax,
      paymentMethod: 'CASH',
      saleDate,
      saleItems: {
        create: lines.map((l) => ({
          productId: l.productId,
          batchId: l.batchId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          subtotal: l.quantity * l.unitPrice,
        })),
      },
    },
    include: { saleItems: true },
  });
}

function report(caller: TestUser, query = 'date=2026-11-18') {
  return weeklySales(makeRequest(`/api/v1/reports/weekly-sales?${query}`, { token: caller.token }));
}

describe('weekly sales report', () => {
  let ctx: TestContext;
  let employee: TestUser;
  let manager: TestUser;
  let para: { id: number; batchId: string };
  let amox: { id: number; batchId: string };

  beforeAll(async () => {
    ctx = await createTestContext('wkrep');
    employee = await createTestUserWithRole(ctx, 'EMPLOYEE', 'wkrep-emp');
    manager = await createTestUserWithRole(ctx, 'MANAGER', 'wkrep-mgr');
    const p1 = await createTestProduct(ctx, { brandName: 'Paracetamol 500mg' });
    const p2 = await createTestProduct(ctx, { brandName: 'Amoxicillin 250mg' });
    para = { id: p1.id, batchId: (await createTestBatch(ctx, p1.id)).id };
    amox = { id: p2.id, batchId: (await createTestBatch(ctx, p2.id)).id };

    // Wed: two lines, with a discount and tax.  Fri: one line.
    await makeSale(ctx, employee, at(18, 9, 30), [
      { productId: para.id, batchId: para.batchId, quantity: 2, unitPrice: 5 },
      { productId: amox.id, batchId: amox.batchId, quantity: 1, unitPrice: 12 },
    ], { invoice: 'INV-WK-0001', discount: 2, tax: 1.1 });
    await makeSale(ctx, employee, at(20, 16, 45), [{ productId: para.id, batchId: para.batchId, quantity: 3, unitPrice: 5 }], { invoice: 'INV-WK-0002' });
  });

  it('shows each invoice with its ref, the products sold, quantities and amounts', async () => {
    const res = await report(ctx.admin);
    expect(res.status).toBe(200);
    const r = await jsonOf(res);

    expect(r.weekStart).toBe('2026-11-16');
    expect(r.weekEnd).toBe('2026-11-22');
    expect(r.invoices.map((i: { invoiceNumber: string }) => i.invoiceNumber)).toEqual(['INV-WK-0001', 'INV-WK-0002']);

    const first = r.invoices[0];
    expect(first.items.map((i: { productName: string; quantity: number; amount: number }) => [i.productName, i.quantity, i.amount])).toEqual([
      ['Paracetamol 500mg', 2, 10],
      ['Amoxicillin 250mg', 1, 12],
    ]);
    // the invoice total is after discount and tax: 22 - 2 + 1.1
    expect(first).toMatchObject({ subtotalAmount: 22, discountAmount: 2, taxAmount: 1.1, totalAmount: 21.1 });
    expect(first.cashier).toBeTruthy();
    expect(r.invoices[1].items).toHaveLength(1);
  });

  it('totals the week: invoices, items sold, gross, discounts, tax and the amount taken', async () => {
    const r = await jsonOf(await report(ctx.admin));
    expect(r.summary).toMatchObject({
      invoiceCount: 2,
      itemsSold: 6, // 2 + 1 + 3
      grossSales: 37, // 10 + 12 + 15
      discounts: 2,
      tax: 1.1,
      totalSales: 36.1, // 21.1 + 15
      returnsTotal: 0,
      netSales: 36.1,
    });
  });

  it('breaks the week down by day, Monday to Sunday', async () => {
    const r = await jsonOf(await report(ctx.admin));
    expect(r.days.map((d: { label: string }) => d.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    const byDate = Object.fromEntries(r.days.map((d: { date: string; invoiceCount: number; total: number }) => [d.date, [d.invoiceCount, d.total]]));
    expect(byDate['2026-11-18']).toEqual([1, 21.1]);
    expect(byDate['2026-11-20']).toEqual([1, 15]);
    expect(byDate['2026-11-16']).toEqual([0, 0]);
    expect(r.days.reduce((n: number, d: { total: number }) => n + d.total, 0)).toBeCloseTo(r.summary.totalSales, 6);
  });

  it('any day of the week gives the same week — including Sunday, and Monday', async () => {
    for (const date of ['2026-11-16', '2026-11-18', '2026-11-22']) {
      const r = await jsonOf(await report(ctx.admin, `date=${date}`));
      expect(r.weekStart).toBe('2026-11-16');
      expect(r.summary.invoiceCount).toBe(2);
    }
  });

  it('defaults to the current week when no date is given', async () => {
    const res = await report(ctx.admin, '');
    expect(res.status).toBe(200);
    const r = await jsonOf(res);
    expect(r.days).toHaveLength(7);
    expect(r.invoices).toEqual([]); // nothing sold in the real current week
  });

  it('rejects a date that is not a real date', async () => {
    for (const bad of ['2026-02-30', 'last-week', '2026-11-16T00:00:00']) {
      const res = await report(ctx.admin, `date=${bad}`);
      expect(res.status).toBe(400);
      expect((await jsonOf(res)).error).toMatch(/YYYY-MM-DD/);
    }
  });

  it('an empty week is a clean zero report, not an error', async () => {
    const r = await jsonOf(await report(ctx.admin, 'date=2026-11-04'));
    expect(r.invoices).toEqual([]);
    expect(r.summary).toMatchObject({ invoiceCount: 0, itemsSold: 0, totalSales: 0, netSales: 0 });
    expect(r.days.every((d: { total: number }) => d.total === 0)).toBe(true);
  });
});

describe('week boundaries', () => {
  it('counts Monday 00:00 and Sunday 23:59:59.999, and nothing outside them', async () => {
    const ctx = await createTestContext('wkbound');
    const p = await createTestProduct(ctx);
    const batch = await createTestBatch(ctx, p.id);
    const line = [{ productId: p.id, batchId: batch.id, quantity: 1, unitPrice: 10 }];
    await makeSale(ctx, ctx.admin, at(15, 23, 59, 59, 999), line, { invoice: 'PREV-SUN-LAST' });   // previous week
    await makeSale(ctx, ctx.admin, at(16, 0, 0, 0, 0), line, { invoice: 'MON-FIRST' });            // in
    await makeSale(ctx, ctx.admin, at(22, 23, 59, 59, 999), line, { invoice: 'SUN-LAST' });        // in
    await makeSale(ctx, ctx.admin, at(23, 0, 0, 0, 0), line, { invoice: 'NEXT-MON-FIRST' });       // next week

    const r = await jsonOf(await report(ctx.admin, 'date=2026-11-18'));
    expect(r.invoices.map((i: { invoiceNumber: string }) => i.invoiceNumber)).toEqual(['MON-FIRST', 'SUN-LAST']);
    const byDate = Object.fromEntries(r.days.map((d: { date: string; invoiceCount: number }) => [d.date, d.invoiceCount]));
    expect(byDate['2026-11-16']).toBe(1);
    expect(byDate['2026-11-22']).toBe(1);

    const next = await jsonOf(await report(ctx.admin, 'date=2026-11-23'));
    expect(next.invoices.map((i: { invoiceNumber: string }) => i.invoiceNumber)).toEqual(['NEXT-MON-FIRST']);
  });
});

describe('returns', () => {
  it('shows returns made this week and nets them off, whichever week the sale was in', async () => {
    const ctx = await createTestContext('wkret');
    const p = await createTestProduct(ctx);
    const batch = await createTestBatch(ctx, p.id);
    const line = [{ productId: p.id, batchId: batch.id, quantity: 4, unitPrice: 10 }];

    const thisWeek = await makeSale(ctx, ctx.admin, at(17), line, { invoice: 'RET-SALE-NOW' });   // total 40
    const lastWeek = await makeSale(ctx, ctx.admin, at(10), line, { invoice: 'RET-SALE-OLD' });   // total 40, outside the week

    // 1 unit of this week's sale returned this week; 2 units of LAST week's sale returned this week
    await db.salesReturn.create({
      data: {
        saleId: thisWeek.id, branchId: ctx.branchId, returnNumber: `RT-${ctx.suffix}-1`, reason: 'Wrong item', totalAmount: 10,
        processedByUserId: ctx.admin.id, returnDate: at(19),
        items: { create: [{ saleItemId: thisWeek.saleItems[0].id, quantity: 1, amount: 10 }] },
      },
    });
    await db.salesReturn.create({
      data: {
        saleId: lastWeek.id, branchId: ctx.branchId, returnNumber: `RT-${ctx.suffix}-2`, totalAmount: 20,
        processedByUserId: ctx.admin.id, returnDate: at(18),
        items: { create: [{ saleItemId: lastWeek.saleItems[0].id, quantity: 2, amount: 20 }] },
      },
    });
    // a return made NEXT week must not appear
    await db.salesReturn.create({
      data: {
        saleId: thisWeek.id, branchId: ctx.branchId, returnNumber: `RT-${ctx.suffix}-3`, totalAmount: 10,
        processedByUserId: ctx.admin.id, returnDate: at(24),
        items: { create: [{ saleItemId: thisWeek.saleItems[0].id, quantity: 1, amount: 10 }] },
      },
    });

    const r = await jsonOf(await report(ctx.admin));
    expect(r.invoices.map((i: { invoiceNumber: string }) => i.invoiceNumber)).toEqual(['RET-SALE-NOW']);
    expect(r.returns.map((x: { invoiceNumber: string; amount: number }) => [x.invoiceNumber, x.amount])).toEqual([
      ['RET-SALE-OLD', 20],
      ['RET-SALE-NOW', 10],
    ]);
    expect(r.summary).toMatchObject({ totalSales: 40, returnsTotal: 30, netSales: 10 });
    // the sold line notes how much of it has been returned (all time: 1 now + 1 next week)
    expect(r.invoices[0].items[0].returnedQuantity).toBe(2);
  });
});

describe('who sees which branch', () => {
  let ctx: TestContext;
  let employee: TestUser;
  let manager: TestUser;

  beforeAll(async () => {
    ctx = await createTestContext('wkscope');
    employee = await createTestUserWithRole(ctx, 'EMPLOYEE', 'wkscope-emp');
    manager = await createTestUserWithRole(ctx, 'MANAGER', 'wkscope-mgr');
    const p = await createTestProduct(ctx);
    const batch = await createTestBatch(ctx, p.id);
    const line = [{ productId: p.id, batchId: batch.id, quantity: 1, unitPrice: 10 }];
    await makeSale(ctx, ctx.admin, at(17), line, { invoice: 'MAIN-1' });
    await makeSale(ctx, ctx.admin, at(18), line, { invoice: 'SECOND-1', branchId: ctx.secondBranchId });
  });

  const refs = async (res: Response) => (await jsonOf(res)).invoices.map((i: { invoiceNumber: string }) => i.invoiceNumber).sort();

  it('an Admin or Manager sees every branch combined by default, or one branch on request', async () => {
    for (const who of [ctx.admin, manager]) {
      expect(await refs(await report(who))).toEqual(['MAIN-1', 'SECOND-1']);
      expect(await refs(await report(who, `date=2026-11-18&branchId=${ctx.secondBranchId}`))).toEqual(['SECOND-1']);
      expect(await refs(await report(who, `date=2026-11-18&branchId=${ctx.branchId}`))).toEqual(['MAIN-1']);
    }
  });

  it('an Employee sees only their own branch, even without asking', async () => {
    expect(await refs(await report(employee))).toEqual(['MAIN-1']);
    expect(await refs(await report(employee, `date=2026-11-18&branchId=${ctx.branchId}`))).toEqual(['MAIN-1']);
  });

  it("an Employee cannot ask for another branch's report", async () => {
    const res = await report(employee, `date=2026-11-18&branchId=${ctx.secondBranchId}`);
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toMatch(/do not have access/);
  });

  it("another company's sales never appear, and its branch can't be requested", async () => {
    const other = await createTestContext('wkscope-other');
    const p = await createTestProduct(other);
    const b = await createTestBatch(other, p.id);
    await makeSale(other, other.admin, at(18), [{ productId: p.id, batchId: b.id, quantity: 9, unitPrice: 99 }], { invoice: 'THEIRS-1' });

    expect(await refs(await report(ctx.admin))).not.toContain('THEIRS-1');
    const res = await report(ctx.admin, `date=2026-11-18&branchId=${other.branchId}`);
    expect(res.status).toBe(400);
  });

  it('needs a signed-in user', async () => {
    const res = await weeklySales(makeRequest('/api/v1/reports/weekly-sales?date=2026-11-18', {}));
    expect(res.status).toBe(401);
  });
});
