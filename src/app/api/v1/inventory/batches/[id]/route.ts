import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { writeAuditLog } from '@/lib/audit-log';
import { requireInventoryPermission } from '@/lib/inventory-permissions';

// Correct a received batch: batch number, supplier, prices, expiry date.
//
// What this deliberately does NOT do is change the quantity. Stock counts
// move through Stock Adjustments (/stock-adjustments), which record who and
// why and post a write-down to the books — editing quantityInStock directly
// here would bypass all of that.
//
// Two permissions, checked by the API itself (see inventory-permissions.ts):
//   inventory.edit         -> batch number, supplier, purchase/selling price
//   inventory.edit_expiry  -> expiry date (also needs a recorded reason)
// Changing several fields needs every permission they require.

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

function parseExpiry(raw: unknown): Date {
  const d = typeof raw === 'string' || raw instanceof Date ? new Date(raw as string) : new Date(NaN);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < MIN_YEAR || d.getUTCFullYear() > MAX_YEAR) {
    throw new PharmacyServiceError('Enter a valid expiry date');
  }
  return d;
}

const sameDay = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { id } = await params;
    const body = await request.json();

    // Own company's batches only — another company's is just "not found".
    const batch = await db.productBatch.findFirst({
      where: { id, product: { companyId: auth.companyId } },
      include: { product: { select: { brandName: true } } },
    });
    if (!batch) throw new PharmacyServiceError('Batch not found');
    if (!(await canAccessBranch(db, auth, batch.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }

    // Work out what actually changes; anything sent but unchanged is ignored.
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const data: Record<string, unknown> = {};
    let needsEdit = false;
    let needsExpiry = false;

    if (body.batchNumber !== undefined) {
      const batchNumber = typeof body.batchNumber === 'string' ? body.batchNumber.trim() : '';
      if (!batchNumber || batchNumber.length > 60) {
        throw new PharmacyServiceError('Batch number is required (up to 60 characters)');
      }
      if (batchNumber !== batch.batchNumber) {
        const clash = await db.productBatch.findFirst({
          where: { branchId: batch.branchId, productId: batch.productId, batchNumber, NOT: { id: batch.id } },
          select: { id: true },
        });
        if (clash) {
          throw new PharmacyServiceError(`This product already has a batch numbered "${batchNumber}" at this branch`);
        }
        changes.batchNumber = { from: batch.batchNumber, to: batchNumber };
        data.batchNumber = batchNumber;
        needsEdit = true;
      }
    }

    if (body.supplierId !== undefined) {
      const supplierId = body.supplierId === null || body.supplierId === '' ? null : Number(body.supplierId);
      if (supplierId !== null) {
        const supplier = Number.isInteger(supplierId)
          ? await db.supplier.findFirst({ where: { id: supplierId, companyId: auth.companyId }, select: { id: true } })
          : null;
        if (!supplier) throw new PharmacyServiceError('Supplier not found');
      }
      if (supplierId !== batch.supplierId) {
        changes.supplierId = { from: batch.supplierId, to: supplierId };
        data.supplierId = supplierId;
        needsEdit = true;
      }
    }

    if (body.purchasePrice !== undefined) {
      const price = Number(body.purchasePrice);
      if (!Number.isFinite(price) || price < 0) throw new PharmacyServiceError('Purchase price must be zero or more');
      if (price !== batch.purchasePrice) {
        changes.purchasePrice = { from: batch.purchasePrice, to: price };
        data.purchasePrice = price;
        needsEdit = true;
      }
    }

    if (body.sellingPrice !== undefined) {
      const price = Number(body.sellingPrice);
      if (!Number.isFinite(price) || price <= 0) throw new PharmacyServiceError('Selling price must be greater than zero');
      if (price !== batch.sellingPrice) {
        changes.sellingPrice = { from: batch.sellingPrice, to: price };
        data.sellingPrice = price;
        needsEdit = true;
      }
    }

    let reason: string | undefined;
    if (body.expiryDate !== undefined) {
      const expiry = parseExpiry(body.expiryDate);
      if (!sameDay(expiry, batch.expiryDate)) {
        const text: string = typeof body.reason === 'string' ? body.reason.trim() : '';
        if (text.length < 3) {
          throw new PharmacyServiceError('Give a reason for changing the expiry date (it is recorded in the audit log)');
        }
        reason = text;
        changes.expiryDate = { from: batch.expiryDate.toISOString().slice(0, 10), to: expiry.toISOString().slice(0, 10) };
        data.expiryDate = expiry;
        needsExpiry = true;
      }
    }

    if (Object.keys(changes).length === 0) {
      throw new PharmacyServiceError('Nothing was changed');
    }

    if (needsEdit) {
      const denied = await requireInventoryPermission(db, auth, 'inventory.edit');
      if (denied) return denied;
    }
    if (needsExpiry) {
      const denied = await requireInventoryPermission(db, auth, 'inventory.edit_expiry');
      if (denied) return denied;
    }

    const updated = await db.$transaction(async (tx) => {
      const updated = await tx.productBatch.update({
        where: { id: batch.id },
        data,
        include: { product: true, supplier: true },
      });
      await writeAuditLog(tx, {
        branchId: batch.branchId,
        userId: auth.userId,
        action: needsExpiry ? 'EDIT_BATCH_EXPIRY' : 'EDIT_BATCH',
        entityName: 'ProductBatch',
        entityId: batch.id,
        details: {
          product: batch.product.brandName,
          batchNumber: batch.batchNumber,
          changes,
          ...(reason ? { reason } : {}),
        },
      });
      return updated;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
