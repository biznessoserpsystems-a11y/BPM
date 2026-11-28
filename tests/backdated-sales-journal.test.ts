import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, createTestContext, createTestProduct, createTestBatch, createTestUserWithRole, type TestContext, type TestUser } from './fixtures';
import { makeRequest, jsonOf } from './request-helpers';
import { POST as postSale } from '../src/app/api/v1/sales/route';
import { POST as postJournal } from '../src/app/api/v1/journal-entries/route';
import { GET as weekly } from '../src/app/api/v1/reports/weekly-sales/route';

// Adding an omitted sale to an earlier date, and journal entries that carry a date and
// must name a product on inventory lines.

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('adding an omitted sale to a previous date', () => {
  let ctx: TestContext;
  let cashier: TestUser;
  let productId: number;

  beforeAll(async () => {
    ctx = await createTestContext('backdate');
    cashier = await createTestUserWithRole(ctx, 'EMPLOYEE', 'backdate-emp');
    productId = (await createTestProduct(ctx, { brandName: 'Paracetamol 500mg' })).id;
  });

  const sale = async (caller: TestUser, extra: Record<string, unknown>, quantity = 2) => {
    const batch = await createTestBatch(ctx, productId, { quantity: 50, purchasePrice: 4 });
    const res = await postSale(
      makeRequest('/api/v1/sales', {
        method: 'POST',
        token: caller.token,
        body: { branchId: ctx.branchId, userId: caller.id, paymentMethod: 'CASH', items: [{ productId, batchId: batch.id, quantity, unitPrice: 10 }], ...extra },
      })
    );
    return { res, batchId: batch.id };
  };

  it('an Admin can add a sale to an earlier day: dated that day, posted to the books on that day, stock taken off', async () => {
    const day = daysAgo(5);
    const { res, batchId } = await sale(ctx.admin, { saleDate: day, reason: 'Sale was not entered on the day' });
    expect(res.status).toBe(201);
    const made = await jsonOf(res);
    const when = new Date(made.saleDate);
    expect([when.getFullYear(), when.getMonth() + 1, when.getDate()].join('-')).toBe(day.split('-').map(Number).join('-'));

    expect((await db.productBatch.findUniqueOrThrow({ where: { id: batchId } })).quantityInStock).toBe(48);
    const entry = await db.journalEntry.findFirstOrThrow({ where: { sourceType: 'SALE', sourceId: made.id } });
    expect(entry.entryDate.getTime()).toBe(when.getTime());

    const audit = await db.systemAuditLog.findFirst({ where: { action: 'CREATE_SALE', entityId: made.id } });
    expect(JSON.stringify(audit!.details)).toContain('Sale was not entered on the day');
  });

  it('shows up in that day\'s report, not today\'s', async () => {
    const day = daysAgo(9);
    expect((await sale(ctx.admin, { saleDate: day, reason: 'omitted earlier' }, 3)).res.status).toBe(201);
    const res = await weekly(makeRequest(`/api/v1/reports/weekly-sales?date=${day}&period=day&branchId=${ctx.branchId}`, { token: ctx.admin.token }));
    const r = await jsonOf(res);
    expect(r.invoices).toHaveLength(1);
    expect(r.summary.totalSales).toBe(30);
  });

  it('a reason is required, and without one nothing is recorded', async () => {
    const before = await db.sale.count({ where: { branchId: ctx.branchId } });
    const { res, batchId } = await sale(ctx.admin, { saleDate: daysAgo(3) });
    expect(res.status).not.toBe(201);
    expect(await db.sale.count({ where: { branchId: ctx.branchId } })).toBe(before);
    expect((await db.productBatch.findUniqueOrThrow({ where: { id: batchId } })).quantityInStock).toBe(50);
  });

  it('a cashier cannot back-date a sale until an Admin grants it', async () => {
    const refused = await sale(cashier, { saleDate: daysAgo(2), reason: 'forgot to enter' });
    expect(refused.res.status).not.toBe(201);
    expect(JSON.stringify(await jsonOf(refused.res))).toMatch(/previous date/);

    await db.userPermission.create({ data: { userId: cashier.id, permission: 'sales.add_past', allowed: true, updatedByUserId: ctx.admin.id } });
    expect((await sale(cashier, { saleDate: daysAgo(2), reason: 'forgot to enter' })).res.status).toBe(201);
  });

  it('an ordinary sale (no date) is unaffected and needs no permission', async () => {
    const plain = await createTestUserWithRole(ctx, 'EMPLOYEE', 'backdate-plain');
    expect((await sale(plain, {})).res.status).toBe(201);
    expect((await sale(plain, { saleDate: daysAgo(0) })).res.status).toBe(201); // today's date is just "now"
  });

  it('refuses a future date', async () => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    const future = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect((await sale(ctx.admin, { saleDate: future, reason: 'tomorrow' })).res.status).not.toBe(201);
  });

  describe('closed periods', () => {
    const period = { periodName: '2003-03', startDate: new Date(2003, 2, 1), endDate: new Date(2003, 2, 31, 23, 59, 59), status: 'CLOSED' };
    beforeAll(async () => { await db.accountingPeriod.create({ data: period }); });
    afterAll(async () => { await db.accountingPeriod.deleteMany({ where: { periodName: period.periodName } }); });

    it('refuses the whole sale when that day\'s accounting period is closed, instead of recording it with nothing posted', async () => {
      const { res, batchId } = await sale(ctx.admin, { saleDate: '2003-03-15', reason: 'very old sale' });
      expect(res.status).not.toBe(201);
      expect(JSON.stringify(await jsonOf(res))).toMatch(/accounting period/i);
      expect((await db.productBatch.findUniqueOrThrow({ where: { id: batchId } })).quantityInStock).toBe(50);
    });
  });
});

describe('journal entries', () => {
  let ctx: TestContext;
  let manager: TestUser;
  let cash: number;
  let revenue: number;
  let inventory: number;
  let para: number;
  let amox: number;

  beforeAll(async () => {
    ctx = await createTestContext('jrnl');
    manager = await createTestUserWithRole(ctx, 'MANAGER', 'jrnl-mgr');
    const acct = async (key: string) => (await db.gLAccountMapping.findUniqueOrThrow({ where: { companyId_mappingKey: { companyId: ctx.companyId, mappingKey: key } } })).accountId;
    cash = await acct('CASH');
    revenue = await acct('SALES_REVENUE');
    inventory = await acct('INVENTORY_ASSET');
    para = (await createTestProduct(ctx, { brandName: 'Paracetamol 500mg' })).id;
    amox = (await createTestProduct(ctx, { brandName: 'Amoxicillin 250mg' })).id;
  });

  const post = (caller: TestUser, body: Record<string, unknown>) =>
    postJournal(
      makeRequest('/api/v1/journal-entries', {
        method: 'POST',
        token: caller.token,
        body: { branchId: ctx.branchId, sourceType: 'MANUAL', postedByUserId: caller.id, entryDate: new Date(2026, 10, 23, 12).toISOString(), ...body },
      })
    );

  it('is recorded on the date chosen', async () => {
    const res = await post(manager, { lines: [{ accountId: cash, debit: 50 }, { accountId: revenue, credit: 50 }] });
    expect(res.status).toBe(201);
    const made = await jsonOf(res);
    const d = new Date(made.entryDate);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 11, 23]);
  });

  it('refuses a missing or invalid date', async () => {
    for (const entryDate of ['', 'not a date', '1990-01-01']) {
      const res = await post(manager, { entryDate, lines: [{ accountId: cash, debit: 5 }, { accountId: revenue, credit: 5 }] });
      expect(res.status).not.toBe(201);
    }
  });

  it('a line on the inventory account must say which product — Paracetamol, Amoxicillin or any other', async () => {
    const without = await post(manager, { lines: [{ accountId: inventory, debit: 100 }, { accountId: cash, credit: 100 }] });
    expect(without.status).not.toBe(201);
    expect(JSON.stringify(await jsonOf(without))).toMatch(/choose which product/);

    const withProduct = await post(manager, {
      lines: [{ accountId: inventory, debit: 60, productId: para }, { accountId: inventory, debit: 40, productId: amox }, { accountId: cash, credit: 100 }],
    });
    expect(withProduct.status).toBe(201);
    const lines = await db.journalLine.findMany({ where: { journalEntryId: (await jsonOf(withProduct)).id, accountId: inventory }, orderBy: { debit: 'desc' } });
    expect(lines.map((l) => [l.productId, l.debit])).toEqual([[para, 60], [amox, 40]]);
  });

  it("refuses another company's product", async () => {
    const other = await createTestContext('jrnl-other');
    const foreign = (await createTestProduct(other)).id;
    const res = await post(manager, { lines: [{ accountId: inventory, debit: 10, productId: foreign }, { accountId: cash, credit: 10 }] });
    expect(res.status).not.toBe(201);
  });

  it('lines on other accounts do not need a product', async () => {
    expect((await post(manager, { lines: [{ accountId: cash, debit: 5 }, { accountId: revenue, credit: 5 }] })).status).toBe(201);
  });
});
