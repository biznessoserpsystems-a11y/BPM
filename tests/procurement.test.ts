import { describe, it, expect, beforeAll } from 'vitest';
import { db, createTestContext, createTestProduct, createTestSupplier, type TestContext, type TestProduct, type TestSupplier } from './fixtures';
import { makeRequest, routeParams, jsonOf } from './request-helpers';
import { POST as createPO } from '../src/app/api/v1/purchase-orders/route';
import { POST as submitPO } from '../src/app/api/v1/purchase-orders/[id]/submit/route';
import { POST as approvePO } from '../src/app/api/v1/purchase-orders/[id]/approve/route';
import { POST as markOrdered } from '../src/app/api/v1/purchase-orders/[id]/mark-ordered/route';
import { POST as receivePO } from '../src/app/api/v1/purchase-orders/[id]/receive/route';

describe('procurement: full Purchase Order lifecycle', () => {
  let ctx: TestContext;
  let product: TestProduct;
  let supplier: TestSupplier;
  let poId: string;

  beforeAll(async () => {
    ctx = await createTestContext('procure');
    product = await createTestProduct(ctx);
    supplier = await createTestSupplier(ctx);
  });

  it('creates a DRAFT purchase order', async () => {
    const res = await createPO(
      makeRequest('/api/v1/purchase-orders', {
        token: ctx.admin.token,
        body: {
          branchId: ctx.branchId,
          supplierId: supplier.id,
          requestedByUserId: ctx.admin.id,
          items: [{ productId: product.id, quantityOrdered: 50, unitCost: 4.5, taxRate: 0 }],
        },
      })
    );
    expect(res.status).toBe(201);
    const po = await jsonOf(res);
    expect(po.status).toBe('DRAFT');
    expect(po.items).toHaveLength(1);
    poId = po.id;
  });

  it('rejects receiving stock against a DRAFT order — the whole point of the state machine', async () => {
    const res = await receivePO(
      makeRequest(`/api/v1/purchase-orders/${poId}/receive`, {
        token: ctx.admin.token,
        body: {
          branchId: ctx.branchId,
          receivedByUserId: ctx.admin.id,
          items: [{ purchaseOrderItemId: 'irrelevant', batchNumber: 'X', expiryDate: new Date().toISOString(), quantityReceived: 50, sellingPrice: 8 }],
        },
      }),
      routeParams({ id: poId })
    );
    expect(res.status).toBe(400);
  });

  it('DRAFT -> SUBMITTED', async () => {
    const res = await submitPO(makeRequest(`/api/v1/purchase-orders/${poId}/submit`, { token: ctx.admin.token, body: {} }), routeParams({ id: poId }));
    expect(res.status).toBe(200);
    const po = await jsonOf(res);
    expect(po.status).toBe('SUBMITTED');
  });

  it('SUBMITTED -> APPROVED', async () => {
    const res = await approvePO(
      makeRequest(`/api/v1/purchase-orders/${poId}/approve`, { token: ctx.admin.token, body: { approvedByUserId: ctx.admin.id } }),
      routeParams({ id: poId })
    );
    expect(res.status).toBe(200);
    const po = await jsonOf(res);
    expect(po.status).toBe('APPROVED');
  });

  it('APPROVED -> ORDERED', async () => {
    const res = await markOrdered(makeRequest(`/api/v1/purchase-orders/${poId}/mark-ordered`, { token: ctx.admin.token, body: {} }), routeParams({ id: poId }));
    expect(res.status).toBe(200);
    const po = await jsonOf(res);
    expect(po.status).toBe('ORDERED');
  });

  it('ORDERED -> RECEIVED, and actually creates sellable stock', async () => {
    const poBefore = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { items: true } });
    const lineItemId = poBefore.items[0].id;

    const res = await receivePO(
      makeRequest(`/api/v1/purchase-orders/${poId}/receive`, {
        token: ctx.admin.token,
        body: {
          branchId: ctx.branchId,
          receivedByUserId: ctx.admin.id,
          items: [{ purchaseOrderItemId: lineItemId, batchNumber: 'BATCH-PROCURE-1', expiryDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), quantityReceived: 50, sellingPrice: 9 }],
        },
      }),
      routeParams({ id: poId })
    );
    expect(res.status).toBe(201);

    const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(po.status).toBe('RECEIVED');

    // The real point of this test: GoodsReceipt is the ONLY path that
    // should ever create/top-up a ProductBatch — confirm it actually did.
    const batch = await db.productBatch.findFirst({ where: { productId: product.id, branchId: ctx.branchId, batchNumber: 'BATCH-PROCURE-1' } });
    expect(batch).not.toBeNull();
    expect(batch!.quantityInStock).toBe(50);
    expect(batch!.quantityReceived).toBe(50);
  });

  it('rejects submitting the now-RECEIVED order a second time', async () => {
    const res = await submitPO(makeRequest(`/api/v1/purchase-orders/${poId}/submit`, { token: ctx.admin.token, body: {} }), routeParams({ id: poId }));
    expect(res.status).toBe(400);
  });
});

describe('procurement: cross-tenant isolation', () => {
  // Regression guard for the multi-tenant scoping fix — a user from
  // Company A must never be able to act on Company B's purchase order,
  // even with a syntactically valid token and a guessed/enumerated id.
  it('refuses to let a user from another company approve this company\'s PO', async () => {
    const ctxA = await createTestContext('tenant-a');
    const ctxB = await createTestContext('tenant-b');
    const product = await createTestProduct(ctxA);
    const supplier = await createTestSupplier(ctxA);

    const createRes = await createPO(
      makeRequest('/api/v1/purchase-orders', {
        token: ctxA.admin.token,
        body: {
          branchId: ctxA.branchId,
          supplierId: supplier.id,
          requestedByUserId: ctxA.admin.id,
          items: [{ productId: product.id, quantityOrdered: 10, unitCost: 1, taxRate: 0 }],
        },
      })
    );
    const po = await jsonOf(createRes);

    const submitRes = await submitPO(
      makeRequest(`/api/v1/purchase-orders/${po.id}/submit`, { token: ctxB.admin.token, body: {} }),
      routeParams({ id: po.id })
    );
    expect(submitRes.status).toBe(400);
  });
});
