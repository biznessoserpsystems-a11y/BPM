import { describe, it, expect, beforeAll } from 'vitest';
import { db, createTestContext, createTestProduct, createTestBatch, type TestContext, type TestProduct } from './fixtures';
import { makeRequest, jsonOf } from './request-helpers';
import { POST as createSale } from '../src/app/api/v1/sales/route';

describe('checkout: POS sale creation', () => {
  let ctx: TestContext;
  let product: TestProduct;
  let batchId: string;

  beforeAll(async () => {
    ctx = await createTestContext('checkout');
    product = await createTestProduct(ctx);
    const batch = await createTestBatch(ctx, product.id, { quantity: 30, purchasePrice: 4, sellingPrice: 10 });
    batchId = batch.id;
  });

  it('records a cash sale, decrements stock, and totals correctly', async () => {
    const res = await createSale(
      makeRequest('/api/v1/sales', {
        token: ctx.admin.token,
        body: {
          branchId: ctx.branchId,
          userId: ctx.admin.id,
          paymentMethod: 'CASH',
          items: [{ productId: product.id, batchId, quantity: 5, unitPrice: 10 }],
        },
      })
    );
    expect(res.status).toBe(201);
    const sale = await jsonOf(res);
    expect(sale.totalAmount).toBe(50);
    expect(sale.saleItems).toHaveLength(1);

    // This regression class (userId hardcoded to 1 elsewhere in the app's
    // history — see SYSTEM-AUDIT.md's Functional section) is exactly why
    // this assertion matters: the sale must be attributed to the actual
    // caller, not silently misattributed.
    expect(sale.userId).toBe(ctx.admin.id);

    const batch = await db.productBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.quantityInStock).toBe(25); // 30 - 5
  });

  it('rejects a sale that would oversell a batch', async () => {
    const res = await createSale(
      makeRequest('/api/v1/sales', {
        token: ctx.admin.token,
        body: {
          branchId: ctx.branchId,
          userId: ctx.admin.id,
          paymentMethod: 'CASH',
          items: [{ productId: product.id, batchId, quantity: 9999, unitPrice: 10 }],
        },
      })
    );
    expect(res.status).toBe(400);

    // And stock must be untouched — the whole request should have rolled back.
    const batch = await db.productBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.quantityInStock).toBe(25);
  });

  it('rejects recording a sale as a different user than the caller', async () => {
    const res = await createSale(
      makeRequest('/api/v1/sales', {
        token: ctx.admin.token,
        body: {
          branchId: ctx.branchId,
          userId: ctx.admin.id + 999999,
          paymentMethod: 'CASH',
          items: [{ productId: product.id, batchId, quantity: 1, unitPrice: 10 }],
        },
      })
    );
    expect(res.status).toBe(400);
  });
});
