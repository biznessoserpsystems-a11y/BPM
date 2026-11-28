import { describe, it, expect, beforeAll } from 'vitest';
import { db, createTestContext, createTestProduct, createTestBatch, createTestUserWithRole, type TestContext, type TestUser } from './fixtures';
import { makeRequest, jsonOf, routeParams } from './request-helpers';
import { PATCH as editSale } from '../src/app/api/v1/sales/[id]/route';
import { buildSaleLines } from '../src/lib/sale-journal';

// Editing a recorded sale, against a real database: who may, that stock and the
// books are corrected to match, and that a refused edit changes nothing.

let seq = 0;

describe('editing a sale', () => {
  let ctx: TestContext;
  let cashier: TestUser;
  let otherCashier: TestUser;
  let accounts: Record<string, number>;
  let currencyId: number;
  let productId: number;

  beforeAll(async () => {
    ctx = await createTestContext('saleedit');
    cashier = await createTestUserWithRole(ctx, 'EMPLOYEE', 'saleedit-a');
    otherCashier = await createTestUserWithRole(ctx, 'EMPLOYEE', 'saleedit-b');
    productId = (await createTestProduct(ctx, { brandName: 'Paracetamol 500mg' })).id;

    // createTestContext already seeds a starter chart of accounts, a base currency and the GL mappings.
    currencyId = (await db.currency.findFirstOrThrow({ where: { companyId: ctx.companyId, isBaseCurrency: true } })).id;
    accounts = {};
    const defs: [string, string, string, string][] = [
      ['CASH', 'ASSET', 'DEBIT', '1000'], ['SALES_REVENUE', 'REVENUE', 'CREDIT', '4000'], ['TAX_PAYABLE', 'LIABILITY', 'CREDIT', '2100'],
      ['COGS', 'EXPENSE', 'DEBIT', '5000'], ['INVENTORY_ASSET', 'ASSET', 'DEBIT', '1200'],
    ];
    for (const [key, type, normal, code] of defs) {
      const existing = await db.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: ctx.companyId, mappingKey: key } } });
      if (existing) {
        accounts[key] = existing.accountId;
        continue;
      }
      const acct = await db.account.create({ data: { companyId: ctx.companyId, accountCode: `${code}-${ctx.suffix}`, accountName: key, accountType: type, normalBalance: normal } });
      accounts[key] = acct.id;
      await db.gLAccountMapping.create({ data: { companyId: ctx.companyId, mappingKey: key, accountId: acct.id } });
    }
  });

  /** A sale of `qty` x 10 (cost 5 each), already posted to the books, with its stock taken off. */
  async function makeSale(user: TestUser, saleDate: Date, qty = 2, opts: { posted?: boolean } = {}) {
    const batch = await createTestBatch(ctx, productId, { quantity: 100, purchasePrice: 5 });
    await db.productBatch.update({ where: { id: batch.id }, data: { quantityInStock: 100 - qty } });
    const invoiceNumber = `INV-SE-${ctx.suffix}-${++seq}`;
    const sale = await db.sale.create({
      data: {
        branchId: ctx.branchId, invoiceNumber, userId: user.id, subtotalAmount: qty * 10, totalAmount: qty * 10, paymentMethod: 'CASH', saleDate,
        saleItems: { create: [{ productId, batchId: batch.id, quantity: qty, unitPrice: 10, subtotal: qty * 10 }] },
      },
      include: { saleItems: true },
    });
    if (opts.posted !== false) {
      await db.journalEntry.create({
        data: {
          entryNumber: `JE-SE-${ctx.suffix}-${seq}`, branchId: ctx.branchId, entryDate: saleDate, description: 'POS sale', sourceType: 'SALE', sourceId: sale.id,
          currencyId, postedByUserId: user.id,
          lines: { createMany: { data: buildSaleLines({
            invoiceNumber, subtotalAmount: qty * 10, discountAmount: 0, taxAmount: 0, totalAmount: qty * 10, costOfGoodsSold: qty * 5,
            accounts: { payment: accounts.CASH, revenue: accounts.SALES_REVENUE, tax: accounts.TAX_PAYABLE, cogs: accounts.COGS, inventory: accounts.INVENTORY_ASSET },
          }) } },
        },
      });
    }
    return { sale, batchId: batch.id, itemId: sale.saleItems[0].id };
  }

  const patch = (caller: TestUser, saleId: string, body: Record<string, unknown>) =>
    editSale(makeRequest(`/api/v1/sales/${saleId}`, { method: 'PATCH', token: caller.token, body }), routeParams({ id: saleId }));

  /** Net effect on one account across every entry for the sale: debit minus credit. */
  async function net(saleId: string, key: string) {
    const lines = await db.journalLine.findMany({ where: { accountId: accounts[key], journalEntry: { sourceId: saleId } } });
    return lines.reduce((n, l) => n + l.debit - l.credit, 0);
  }

  it("a cashier corrects their own sale from today: totals, stock and the books all follow", async () => {
    const { sale, batchId, itemId } = await makeSale(cashier, new Date());
    const res = await patch(cashier, sale.id, { reason: 'Wrong quantity at the till', items: [{ id: itemId, quantity: 5, unitPrice: 12 }], paymentMethod: 'MOBILE_MONEY', customerName: 'Ama' });
    expect(res.status).toBe(200);
    const updated = await jsonOf(res);
    expect(updated).toMatchObject({ subtotalAmount: 60, totalAmount: 60, paymentMethod: 'MOBILE_MONEY', customerName: 'Ama' });

    expect((await db.productBatch.findUniqueOrThrow({ where: { id: batchId } })).quantityInStock).toBe(95); // 98 -> 95: three more sold

    // the ledger now says 60 revenue / 60 cash in / 25 cost, with the original kept and reversed
    expect(await net(sale.id, 'SALES_REVENUE')).toBe(-60);
    expect(await net(sale.id, 'CASH')).toBe(60);
    expect(await net(sale.id, 'COGS')).toBe(25);
    expect(await net(sale.id, 'INVENTORY_ASSET')).toBe(-25);
    const entries = await db.journalEntry.findMany({ where: { sourceId: sale.id }, orderBy: { createdAt: 'asc' } });
    expect(entries.map((e) => [e.sourceType, e.status])).toEqual([['SALE', 'REVERSED'], ['SALE_EDIT_REVERSAL', 'POSTED'], ['SALE_EDIT', 'POSTED']]);
    expect(new Set(entries.map((e) => e.entryNumber)).size).toBe(3);

    const audit = await db.systemAuditLog.findFirst({ where: { action: 'EDIT_SALE', entityId: sale.id } });
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit!.details)).toContain('Wrong quantity at the till');
  });

  it('a second edit reverses the first correction, so the books always show the latest', async () => {
    const { sale, itemId } = await makeSale(cashier, new Date());
    expect((await patch(cashier, sale.id, { reason: 'first fix', items: [{ id: itemId, quantity: 4 }] })).status).toBe(200);
    expect((await patch(cashier, sale.id, { reason: 'second fix', items: [{ id: itemId, unitPrice: 8 }] })).status).toBe(200);
    expect(await net(sale.id, 'SALES_REVENUE')).toBe(-32); // 4 x 8
    expect(await net(sale.id, 'INVENTORY_ASSET')).toBe(-20); // 4 x cost 5
  });

  it('a reason is required, and nothing changes without one', async () => {
    const { sale, batchId, itemId } = await makeSale(cashier, new Date());
    const res = await patch(cashier, sale.id, { reason: ' ', items: [{ id: itemId, quantity: 9 }] });
    expect(res.status).not.toBe(200);
    expect((await db.productBatch.findUniqueOrThrow({ where: { id: batchId } })).quantityInStock).toBe(98);
    expect((await db.sale.findUniqueOrThrow({ where: { id: sale.id } })).totalAmount).toBe(20);
  });

  it("a cashier cannot edit someone else's sale, even from today", async () => {
    const { sale, itemId } = await makeSale(cashier, new Date());
    const res = await patch(otherCashier, sale.id, { reason: 'not mine', items: [{ id: itemId, quantity: 3 }] });
    expect(res.status).not.toBe(200);
    expect(JSON.stringify(await jsonOf(res))).toMatch(/only edit sales you made/);
    expect((await db.sale.findUniqueOrThrow({ where: { id: sale.id } })).totalAmount).toBe(20);
  });

  it('an earlier day needs the "previous days" permission: Admin yes, a cashier no, until granted', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    const { sale, itemId } = await makeSale(cashier, threeDaysAgo);
    const refused = await patch(cashier, sale.id, { reason: 'old sale', items: [{ id: itemId, quantity: 3 }] });
    expect(refused.status).not.toBe(200);
    expect(JSON.stringify(await jsonOf(refused))).toMatch(/previous days/);

    expect((await patch(ctx.admin, sale.id, { reason: 'admin fix', items: [{ id: itemId, quantity: 3 }] })).status).toBe(200);

    await db.userPermission.create({ data: { userId: cashier.id, permission: 'sales.edit_past', allowed: true, updatedByUserId: ctx.admin.id } });
    expect((await patch(cashier, sale.id, { reason: 'now allowed', items: [{ id: itemId, quantity: 4 }] })).status).toBe(200);
  });

  it('an Admin can take today\'s editing away from a cashier', async () => {
    const taken = await createTestUserWithRole(ctx, 'EMPLOYEE', 'saleedit-taken');
    await db.userPermission.create({ data: { userId: taken.id, permission: 'sales.edit_today', allowed: false, updatedByUserId: ctx.admin.id } });
    const { sale, itemId } = await makeSale(taken, new Date());
    expect((await patch(taken, sale.id, { reason: 'denied', items: [{ id: itemId, quantity: 3 }] })).status).not.toBe(200);
  });

  it('refuses to sell more than the batch has, and applies nothing', async () => {
    const { sale, batchId, itemId } = await makeSale(cashier, new Date());
    const res = await patch(cashier, sale.id, { reason: 'too many', items: [{ id: itemId, quantity: 500 }] });
    expect(res.status).not.toBe(200);
    expect(JSON.stringify(await jsonOf(res))).toMatch(/Not enough stock/);
    expect((await db.productBatch.findUniqueOrThrow({ where: { id: batchId } })).quantityInStock).toBe(98);
    expect(await db.journalEntry.count({ where: { sourceId: sale.id, sourceType: { not: 'SALE' } } })).toBe(0);
  });

  it('cannot take a line below what was already returned', async () => {
    const { sale, itemId } = await makeSale(cashier, new Date(), 5);
    const ret = await db.salesReturn.create({
      data: { saleId: sale.id, branchId: ctx.branchId, returnNumber: `SR-SE-${ctx.suffix}`, totalAmount: 30, processedByUserId: cashier.id, items: { create: [{ saleItemId: itemId, quantity: 3, amount: 30 }] } },
    });
    expect(ret.id).toBeTruthy();
    const res = await patch(cashier, sale.id, { reason: 'too low', items: [{ id: itemId, quantity: 2 }] });
    expect(res.status).not.toBe(200);
    expect(JSON.stringify(await jsonOf(res))).toMatch(/already been returned/);
    expect((await patch(cashier, sale.id, { reason: 'ok to 3', items: [{ id: itemId, quantity: 3 }] })).status).toBe(200);
  });

  it('a details-only edit (no money change) leaves the books and stock alone', async () => {
    const { sale, batchId } = await makeSale(cashier, new Date());
    const res = await patch(cashier, sale.id, { reason: 'spelling', customerName: 'Kofi Mensah', doctorName: 'Dr Addo' });
    expect(res.status).toBe(200);
    expect(await db.journalEntry.count({ where: { sourceId: sale.id } })).toBe(1);
    expect((await db.productBatch.findUniqueOrThrow({ where: { id: batchId } })).quantityInStock).toBe(98);
  });

  it('a sale that was never posted to the books can still be edited; stock follows', async () => {
    const { sale, batchId, itemId } = await makeSale(cashier, new Date(), 2, { posted: false });
    expect((await patch(cashier, sale.id, { reason: 'fix', items: [{ id: itemId, quantity: 3 }] })).status).toBe(200);
    expect(await db.journalEntry.count({ where: { sourceId: sale.id } })).toBe(0);
    expect((await db.productBatch.findUniqueOrThrow({ where: { id: batchId } })).quantityInStock).toBe(97);
  });

  it("another company's sale is not found", async () => {
    const other = await createTestContext('saleedit-other');
    const { sale, itemId } = await makeSale(cashier, new Date());
    const res = await patch(other.admin, sale.id, { reason: 'sneaky', items: [{ id: itemId, quantity: 3 }] });
    expect(res.status).not.toBe(200);
  });
});
