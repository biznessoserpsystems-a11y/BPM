import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { assertPeriodOpenForDate } from '@/lib/accounting-period';
import { generateEntryNumber } from '@/lib/journal-entry-number';
import type { CreateInventoryValuationInput } from '@/types/pharmacy';

// Same tier as Chart of Accounts / GL mappings — an NRV write-down (IAS 2)
// directly affects reported inventory value on the balance sheet.
const CAN_MANAGE_INVENTORY_VALUATIONS = ['ADMIN', 'MANAGER'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const valuations = await db.inventoryValuation.findMany({
      orderBy: { valuationDate: 'desc' },
      include: {
        batch: {
          select: {
            batchNumber: true,
            branchId: true,
            expiryDate: true,
            product: { select: { brandName: true, skuCode: true } },
          },
        },
      },
    });

    return NextResponse.json(valuations);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_INVENTORY_VALUATIONS);
    if (roleError) return roleError;

    const body: CreateInventoryValuationInput = await request.json();

    if (!body.batchId || body.costPerUnit == null || body.netRealizableValue == null || body.quantityOnHand == null) {
      throw new PharmacyServiceError('batchId, costPerUnit, netRealizableValue, and quantityOnHand are required');
    }

    const batch = await db.productBatch.findUnique({ where: { id: body.batchId } });
    if (!batch) {
      throw new PharmacyServiceError(`Batch ${body.batchId} not found`);
    }
    // branchId comes from the batch record itself (server-side), not client
    // input — still worth checking, since a Technician at Branch A could
    // otherwise write down valuations for a batch they merely know the ID
    // of at Branch B.
    if (!(await canAccessBranch(db, auth, batch.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }

    // IAS 2: inventory is carried at the lower of cost and net realizable
    // value — the write-down is the shortfall, floored at zero (never a gain).
    const writeDownRequired = body.netRealizableValue < body.costPerUnit;
    const writeDownAmount = writeDownRequired
      ? (body.costPerUnit - body.netRealizableValue) * body.quantityOnHand
      : 0;

    const result = await db.$transaction(async (tx) => {
      const newValuation = await tx.inventoryValuation.create({
        data: {
          batchId: body.batchId,
          costPerUnit: body.costPerUnit,
          netRealizableValue: body.netRealizableValue,
          quantityOnHand: body.quantityOnHand,
          writeDownRequired,
          writeDownAmount,
          reason: body.reason,
        },
      });

      // Best-effort GL posting, same philosophy as sales/goods-receipts/
      // stock-adjustments (never block the valuation record itself) — this
      // is an *assessment*, not the only trigger for correcting inventory
      // value the way depreciation/lease-payment/revenue-recognition are
      // the sole trigger for their respective entries, so it stays
      // best-effort rather than failing loudly on missing mappings.
      let journalEntryId: string | undefined;
      if (writeDownRequired && writeDownAmount > 0) {
        try {
          const valuationDate = new Date();
          const [writeDownMapping, inventoryMapping, baseCurrency] = await Promise.all([
            tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'INVENTORY_WRITE_DOWN' } } }),
            tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'INVENTORY_ASSET' } } }),
            tx.currency.findFirst({ where: { companyId: auth.companyId, isBaseCurrency: true } }),
          ]);

          await assertPeriodOpenForDate(tx, valuationDate);

          if (writeDownMapping && inventoryMapping && baseCurrency) {
            const batch = await tx.productBatch.findUnique({ where: { id: body.batchId } });
            const entryNumber = await generateEntryNumber();
            const entry = await tx.journalEntry.create({
              data: {
                entryNumber,
                branchId: batch?.branchId ?? auth.homeBranchId,
                entryDate: valuationDate,
                description: `Inventory NRV write-down — batch ${batch?.batchNumber ?? body.batchId}`,
                sourceType: 'INVENTORY_VALUATION',
                sourceId: newValuation.id,
                currencyId: baseCurrency.id,
                postedByUserId: auth.userId,
                lines: {
                  createMany: {
                    data: [
                      { accountId: writeDownMapping.accountId, debit: writeDownAmount, credit: 0, description: 'Inventory write-down to NRV' },
                      { accountId: inventoryMapping.accountId, debit: 0, credit: writeDownAmount, description: 'Inventory reduction to NRV' },
                    ],
                  },
                },
              },
            });
            journalEntryId = entry.id;
            await tx.inventoryValuation.update({ where: { id: newValuation.id }, data: { journalEntryId } });
          }
        } catch (glError) {
          console.error('[Inventory Valuation] GL posting skipped:', glError);
        }
      }

      return { ...newValuation, journalEntryId };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
