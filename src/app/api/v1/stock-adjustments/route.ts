import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { writeAuditLog } from '@/lib/audit-log';
import { assertPeriodOpenForDate } from '@/lib/accounting-period';
import type { CreateStockAdjustmentInput } from '@/types/pharmacy';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { generateEntryNumber } from '@/lib/journal-entry-number';

// Stock adjustments mutate inventory immediately with no separate
// request/approve step (unlike POs and Transfers), so unlike those flows
// the gate has to live here rather than in an approval tier.
const CAN_ADJUST_STOCK = ['ADMIN', 'MANAGER', 'EMPLOYEE'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const branchId = request.nextUrl.searchParams.get('branchId');

    if (!branchId) {
      throw new PharmacyServiceError('branchId query parameter is required');
    }
    if (!(await canAccessBranch(db, auth, branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }

    const adjustments = await db.stockAdjustment.findMany({
      where: { branchId },
      include: {
        batch: { include: { product: true } },
        product: true,
        user: { select: { id: true, fullName: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(adjustments);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    if (!CAN_ADJUST_STOCK.includes(auth.roleName)) {
      throw new PharmacyServiceError(
        `Only ${CAN_ADJUST_STOCK.join(' or ')} may record stock adjustments (your role: ${auth.roleName})`
      );
    }

    const body: CreateStockAdjustmentInput = await request.json();

    if (!body.branchId || !body.batchId || !body.productId || !body.userId || body.quantityChanged === undefined || !body.reason) {
      throw new PharmacyServiceError(
        'branchId, batchId, productId, userId, quantityChanged, and reason are required'
      );
    }
    if (!(await canAccessBranch(db, auth, body.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }
    if (body.userId !== auth.userId) {
      throw new PharmacyServiceError('You can only record a stock adjustment as yourself');
    }

    const adjustment = await db.$transaction(async (tx) => {
      // quantityChanged is signed: positive = stock found/increase (e.g.
      // recount correction), negative = stock lost/decrease (e.g. damage,
      // expiry write-off). Previously this always decremented by the
      // absolute value, so a positive adjustment silently reduced stock
      // instead of increasing it.
      const batch = await tx.productBatch.update({
        where: { id: body.batchId },
        data: {
          quantityInStock: {
            increment: body.quantityChanged,
          },
        },
      });

      // Ensure stock doesn't go below 0
      if (batch.quantityInStock < 0) {
        await tx.productBatch.update({
          where: { id: body.batchId },
          data: { quantityInStock: 0 },
        });
      }

      // Best-effort GL posting for write-downs: a negative adjustment
      // (damage, theft, expiry) is a real loss and gets debited to
      // Inventory Write-Down / credited from Inventory Asset, at cost.
      // Positive adjustments (e.g. a recount finding more stock than
      // expected) deliberately don't post — there's no natural "other
      // side" account defined for inventory overages in this system yet,
      // so posting one would mean guessing at an account that doesn't
      // reflect anything the chart of accounts actually models.
      let journalEntryId: string | undefined;
      if (body.quantityChanged < 0) {
        try {
          const adjustmentDate = new Date();
          const [writeDownMapping, inventoryMapping, baseCurrency] = await Promise.all([
            tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'INVENTORY_WRITE_DOWN' } } }),
            tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'INVENTORY_ASSET' } } }),
            tx.currency.findFirst({ where: { companyId: auth.companyId, isBaseCurrency: true } }),
          ]);

          await assertPeriodOpenForDate(tx, adjustmentDate);

          const writeDownValue = Math.abs(body.quantityChanged) * batch.purchasePrice;

          if (writeDownMapping && inventoryMapping && baseCurrency && writeDownValue > 0) {
            const entryNumber = await generateEntryNumber();
            const entry = await tx.journalEntry.create({
              data: {
                entryNumber,
                branchId: body.branchId,
                entryDate: adjustmentDate,
                description: `Stock write-down (${body.reason}) — batch ${batch.batchNumber}`,
                sourceType: 'ADJUSTMENT',
                sourceId: body.batchId,
                currencyId: baseCurrency.id,
                postedByUserId: body.userId,
                lines: {
                  createMany: {
                    data: [
                      { accountId: writeDownMapping.accountId, debit: writeDownValue, credit: 0, description: `Stock write-down — ${body.reason}` },
                      { accountId: inventoryMapping.accountId, debit: 0, credit: writeDownValue, description: `Inventory reduction — ${body.reason}` },
                    ],
                  },
                },
              },
            });
            journalEntryId = entry.id;
          }
        } catch (glError) {
          // Don't let a GL posting hiccup block the physical stock correction.
          console.error('[Stock adjustment] GL posting skipped:', glError);
        }
      }

      // Create adjustment record
      const newAdjustment = await tx.stockAdjustment.create({
        data: {
          branchId: body.branchId,
          batchId: body.batchId,
          productId: body.productId,
          userId: body.userId,
          quantityChanged: body.quantityChanged,
          reason: body.reason,
          notes: body.notes,
        },
        include: {
          batch: { include: { product: true } },
          product: true,
          user: { select: { id: true, fullName: true, username: true } },
        },
      });

      // Write audit log
      await writeAuditLog(tx, {
        branchId: body.branchId,
        userId: body.userId,
        action: 'STOCK_ADJUSTMENT',
        entityName: 'StockAdjustment',
        entityId: newAdjustment.id,
        details: {
          batchId: body.batchId,
          productId: body.productId,
          quantityChanged: body.quantityChanged,
          reason: body.reason,
          journalEntryPosted: !!journalEntryId,
        },
      });

      return newAdjustment;
    });

    return NextResponse.json(adjustment, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
