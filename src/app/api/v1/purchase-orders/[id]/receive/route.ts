import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit-log';
import type { ReceivePurchaseOrderInput } from '@/types/pharmacy';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { assertPeriodOpenForDate } from '@/lib/accounting-period';
import { generateEntryNumber } from '@/lib/journal-entry-number';

const RECEIVABLE_STATUSES = ['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'];

async function generateGrnNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await db.goodsReceipt.count({
    where: { grnNumber: { startsWith: `GRN-${year}-` } },
  });
  return `GRN-${year}-${String(count + 1).padStart(5, '0')}`;
}

// This is the ONLY place a purchase turns into physical, sellable stock.
// It creates/tops-up ProductBatch rows (which is what everything else in
// the app — POS, FEFO picking, transfers — actually reads from), marks how
// much of each PO line has now arrived, and (best-effort) posts the
// Inventory / Accounts Payable journal entry.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { id } = await params;
    const body: ReceivePurchaseOrderInput = await request.json();

    if (!body.branchId || !body.receivedByUserId || !body.items?.length) {
      throw new PharmacyServiceError('branchId, receivedByUserId, and items are required');
    }
    if (!(await canAccessBranch(db, auth, body.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }
    if (body.receivedByUserId !== auth.userId) {
      throw new PharmacyServiceError('You can only receive goods as yourself');
    }

    const po = await db.purchaseOrder.findUnique({
      where: { id },
      include: { items: true, supplier: { select: { apAccountId: true } } },
    });
    if (!po) {
      throw new PharmacyServiceError('Purchase order not found');
    }
    if (!(await canAccessBranch(db, auth, po.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }
    if (!RECEIVABLE_STATUSES.includes(po.status)) {
      throw new PharmacyServiceError(
        `Purchase order in ${po.status} status cannot receive stock — it must be APPROVED, ORDERED, or PARTIALLY_RECEIVED`
      );
    }

    const poItemsById = new Map(po.items.map((item) => [item.id, item]));

    // Aggregate quantities per PO line first — a request with two lines
    // against the same purchaseOrderItemId (never produced by this app's
    // own UI, but nothing stops a direct API call from trying) must be
    // validated against their combined total, not checked independently
    // line-by-line, or two individually-valid lines could together exceed
    // what's actually still outstanding.
    const requestedByPoItem = new Map<string, number>();
    for (const line of body.items) {
      requestedByPoItem.set(
        line.purchaseOrderItemId,
        (requestedByPoItem.get(line.purchaseOrderItemId) ?? 0) + (line.quantityReceived || 0)
      );
    }

    for (const line of body.items) {
      const poItem = poItemsById.get(line.purchaseOrderItemId);
      if (!poItem) {
        throw new PharmacyServiceError(`Purchase order item ${line.purchaseOrderItemId} does not belong to this purchase order`);
      }
      if (!line.quantityReceived || line.quantityReceived <= 0) {
        throw new PharmacyServiceError('Each received line needs a positive quantityReceived');
      }
      const remaining = poItem.quantityOrdered - poItem.quantityReceived;
      const totalRequestedForLine = requestedByPoItem.get(line.purchaseOrderItemId) ?? 0;
      if (totalRequestedForLine > remaining) {
        throw new PharmacyServiceError(
          `Cannot receive ${totalRequestedForLine} units total for this line — only ${remaining} units remain outstanding`
        );
      }
      if (!line.batchNumber || !line.expiryDate || !line.sellingPrice) {
        throw new PharmacyServiceError('Each received line needs batchNumber, expiryDate, and sellingPrice');
      }
    }

    const grnNumber = await generateGrnNumber();

    const receipt = await db.$transaction(async (tx) => {
      const newReceipt = await tx.goodsReceipt.create({
        data: {
          grnNumber,
          purchaseOrderId: id,
          branchId: body.branchId,
          receivedByUserId: body.receivedByUserId,
          notes: body.notes,
        },
      });

      let totalReceivedValue = 0;

      for (const line of body.items) {
        const poItem = poItemsById.get(line.purchaseOrderItemId)!;
        const unitCost = line.unitCost ?? poItem.unitCost;

        // Top up the batch if this exact branch+product+batchNumber already
        // exists (a partial delivery arriving under the same batch), else
        // create a brand new batch. Either way, this is the moment stock
        // actually appears in Stores.
        const batch = await tx.productBatch.upsert({
          where: {
            unique_branch_product_batch: {
              branchId: body.branchId,
              productId: poItem.productId,
              batchNumber: line.batchNumber,
            },
          },
          update: {
            quantityReceived: { increment: line.quantityReceived },
            quantityInStock: { increment: line.quantityReceived },
          },
          create: {
            branchId: body.branchId,
            productId: poItem.productId,
            supplierId: po.supplierId,
            batchNumber: line.batchNumber,
            expiryDate: new Date(line.expiryDate),
            purchasePrice: unitCost,
            sellingPrice: line.sellingPrice,
            quantityReceived: line.quantityReceived,
            quantityInStock: line.quantityReceived,
          },
        });

        await tx.goodsReceiptItem.create({
          data: {
            goodsReceiptId: newReceipt.id,
            purchaseOrderItemId: poItem.id,
            productId: poItem.productId,
            batchId: batch.id,
            quantityReceived: line.quantityReceived,
            unitCost,
          },
        });

        await tx.purchaseOrderItem.update({
          where: { id: poItem.id },
          data: { quantityReceived: { increment: line.quantityReceived } },
        });

        totalReceivedValue += line.quantityReceived * unitCost;
      }

      // Recompute the PO's overall status from its (now updated) items.
      const refreshedItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: id } });
      const fullyReceived = refreshedItems.every((item) => item.quantityReceived >= item.quantityOrdered);
      const anyReceived = refreshedItems.some((item) => item.quantityReceived > 0);
      const newStatus = fullyReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : po.status;

      await tx.purchaseOrder.update({ where: { id }, data: { status: newStatus } });

      // Best-effort GL posting: Debit Inventory, Credit Accounts Payable for
      // the value physically received. If the chart of accounts hasn't been
      // set up with these mapping keys yet, the receipt still succeeds —
      // stock landing in Stores should never be blocked by bookkeeping setup.
      let journalEntryId: string | undefined;
      try {
        const receiptDate = new Date();
        const [inventoryMapping, apMapping, baseCurrency] = await Promise.all([
          tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'INVENTORY_ASSET' } } }),
          tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'AP' } } }),
          tx.currency.findFirst({ where: { companyId: auth.companyId, isBaseCurrency: true } }),
        ]);
        // Same "don't block the physical receipt" philosophy as the mapping
        // lookups above: if today's period has been closed, skip the GL
        // posting (it'll show as ungenerated on the receipt) rather than
        // fail the whole request — stock is already on the shelf by now.
        await assertPeriodOpenForDate(tx, receiptDate);

        // Prefer this specific supplier's own AP sub-account if one's been
        // linked (Catalog → Suppliers) — falls back to the single global AP
        // mapping otherwise, so receiving still works before every supplier
        // has been individually linked.
        const payableAccountId = po.supplier.apAccountId ?? apMapping?.accountId;

        if (inventoryMapping && payableAccountId && baseCurrency && totalReceivedValue > 0) {
          const entryNumber = await generateEntryNumber();
          const entry = await tx.journalEntry.create({
            data: {
              entryNumber,
              branchId: body.branchId,
              entryDate: receiptDate,
              description: `Goods received against ${po.poNumber} (${grnNumber})`,
              sourceType: 'PURCHASE',
              sourceId: newReceipt.id,
              currencyId: baseCurrency.id,
              postedByUserId: body.receivedByUserId,
              lines: {
                createMany: {
                  data: [
                    { accountId: inventoryMapping.accountId, debit: totalReceivedValue, credit: 0, description: `Inventory received — ${grnNumber}` },
                    { accountId: payableAccountId, debit: 0, credit: totalReceivedValue, description: `Payable to supplier — ${grnNumber}` },
                  ],
                },
              },
            },
          });
          journalEntryId = entry.id;
          await tx.goodsReceipt.update({ where: { id: newReceipt.id }, data: { journalEntryId } });
        }
      } catch (glError) {
        // Don't let a GL posting hiccup block the physical receipt.
        console.error('[Goods receipt] GL posting skipped:', glError);
      }

      await writeAuditLog(tx, {
        branchId: body.branchId,
        userId: body.receivedByUserId,
        action: 'RECEIVE_GOODS',
        entityName: 'GoodsReceipt',
        entityId: newReceipt.id,
        details: {
          grnNumber,
          poNumber: po.poNumber,
          totalReceivedValue,
          newPoStatus: newStatus,
          journalEntryPosted: !!journalEntryId,
        },
      });

      return tx.goodsReceipt.findUnique({
        where: { id: newReceipt.id },
        include: {
          items: { include: { product: true, batch: true } },
          receivedByUser: { select: { id: true, fullName: true, username: true } },
          purchaseOrder: { select: { poNumber: true, status: true } },
        },
      });
    });

    return NextResponse.json(receipt, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
