import { describe, it, expect, beforeAll } from 'vitest';
import { db, createTestContext, createTestProduct, createTestBatch, type TestContext, type TestProduct } from './fixtures';
import { makeRequest, routeParams, jsonOf } from './request-helpers';
import { POST as createTransfer } from '../src/app/api/v1/transfers/route';
import { POST as approveTransfer } from '../src/app/api/v1/transfers/[id]/approve/route';
import { POST as dispatchTransfer } from '../src/app/api/v1/transfers/[id]/dispatch/route';
import { POST as receiveTransfer } from '../src/app/api/v1/transfers/[id]/receive/route';

describe('transfers: full inter-branch transfer lifecycle', () => {
  let ctx: TestContext;
  let product: TestProduct;
  let sourceBatchId: string;
  let transferId: string;

  beforeAll(async () => {
    ctx = await createTestContext('transfer');
    product = await createTestProduct(ctx);
    const batch = await createTestBatch(ctx, product.id, { branchId: ctx.branchId, quantity: 40 });
    sourceBatchId = batch.id;
  });

  it('REQUESTED: creates a transfer request between two branches', async () => {
    const res = await createTransfer(
      makeRequest('/api/v1/transfers', {
        token: ctx.admin.token,
        body: {
          sourceBranchId: ctx.branchId,
          destinationBranchId: ctx.secondBranchId,
          productId: product.id,
          requestedQty: 15,
          requestedByUserId: ctx.admin.id,
        },
      })
    );
    expect(res.status).toBe(201);
    const transfer = await jsonOf(res);
    expect(transfer.status).toBe('REQUESTED');
    transferId = transfer.id;
  });

  it('rejects dispatching a transfer that has not been approved yet', async () => {
    const res = await dispatchTransfer(
      makeRequest(`/api/v1/transfers/${transferId}/dispatch`, { token: ctx.admin.token, body: { userId: ctx.admin.id } }),
      routeParams({ id: transferId })
    );
    expect(res.status).toBe(400);
  });

  it('REQUESTED -> APPROVED, and reserves stock out of the source batch', async () => {
    const res = await approveTransfer(
      makeRequest(`/api/v1/transfers/${transferId}/approve`, {
        token: ctx.admin.token,
        body: { sourceBatchId, approvedQty: 15, approvedByUserId: ctx.admin.id },
      }),
      routeParams({ id: transferId })
    );
    expect(res.status).toBe(200);
    const transfer = await jsonOf(res);
    expect(transfer.status).toBe('APPROVED');

    const batch = await db.productBatch.findUniqueOrThrow({ where: { id: sourceBatchId } });
    expect(batch.quantityInStock).toBe(25); // 40 - 15 reserved
  });

  it('rejects approving stock beyond what the source batch actually has', async () => {
    // A second, freshly-created transfer to test the insufficient-stock guard in isolation.
    const overRequest = await createTransfer(
      makeRequest('/api/v1/transfers', {
        token: ctx.admin.token,
        body: { sourceBranchId: ctx.branchId, destinationBranchId: ctx.secondBranchId, productId: product.id, requestedQty: 9999, requestedByUserId: ctx.admin.id },
      })
    );
    const overTransfer = await jsonOf(overRequest);

    const res = await approveTransfer(
      makeRequest(`/api/v1/transfers/${overTransfer.id}/approve`, {
        token: ctx.admin.token,
        body: { sourceBatchId, approvedQty: 9999, approvedByUserId: ctx.admin.id },
      }),
      routeParams({ id: overTransfer.id })
    );
    expect(res.status).toBe(400);
  });

  it('APPROVED -> DISPATCHED', async () => {
    const res = await dispatchTransfer(
      makeRequest(`/api/v1/transfers/${transferId}/dispatch`, { token: ctx.admin.token, body: { userId: ctx.admin.id } }),
      routeParams({ id: transferId })
    );
    expect(res.status).toBe(200);
    const transfer = await jsonOf(res);
    expect(transfer.status).toBe('DISPATCHED');
  });

  it('DISPATCHED -> RECEIVED, and the stock actually lands at the destination branch', async () => {
    const res = await receiveTransfer(
      makeRequest(`/api/v1/transfers/${transferId}/receive`, { token: ctx.admin.token, body: { userId: ctx.admin.id } }),
      routeParams({ id: transferId })
    );
    expect(res.status).toBe(200);
    const transfer = await jsonOf(res);
    expect(transfer.status).toBe('RECEIVED');

    const destBatch = await db.productBatch.findFirst({ where: { productId: product.id, branchId: ctx.secondBranchId } });
    expect(destBatch).not.toBeNull();
    expect(destBatch!.quantityInStock).toBe(15);

    // And the source batch's reserved stock never came back — it left for good.
    const sourceBatch = await db.productBatch.findUniqueOrThrow({ where: { id: sourceBatchId } });
    expect(sourceBatch.quantityInStock).toBe(25);
  });
});
