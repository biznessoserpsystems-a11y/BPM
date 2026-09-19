import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { canAccessBranch, getCompanyBranchIds } from '@/lib/branch-access';
import { writeAuditLog } from '@/lib/audit-log';
import { assertPeriodOpenForDate } from '@/lib/accounting-period';
import type { CreateSaleInput } from '@/types/pharmacy';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { generateEntryNumber } from '@/lib/journal-entry-number';

// Insurance sales are a claim on the insurer, not cash in hand yet — post
// to Accounts Receivable. Everything else (cash, card, mobile money) is
// treated as settled immediately.
function paymentMappingKey(paymentMethod: string): 'AR' | 'CASH' {
  return paymentMethod === 'INSURANCE' ? 'AR' : 'CASH';
}

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const requestedBranchId = request.nextUrl.searchParams.get('branchId') ?? undefined;
    if (requestedBranchId && !(await canAccessBranch(db, auth, requestedBranchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }
    const branchId = requestedBranchId ?? (auth.roleName === 'ADMIN' || auth.roleName === 'MANAGER' ? undefined : auth.homeBranchId);
    const companyBranchIds = branchId ? undefined : await getCompanyBranchIds(db, auth.companyId);

    const sales = await db.sale.findMany({
      where: branchId ? { branchId } : { branchId: { in: companyBranchIds } },
      orderBy: { saleDate: 'desc' },
      take: 100,
      include: {
        saleItems: {
          include: {
            product: { select: { brandName: true, genericName: true, skuCode: true } },
            salesReturnItems: { select: { quantity: true } },
          },
        },
        user: { select: { id: true, fullName: true, username: true } },
      },
    });

    return NextResponse.json(sales);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const body: CreateSaleInput = await request.json();

    if (!body.branchId || !body.userId || !body.paymentMethod || !body.items?.length) {
      throw new PharmacyServiceError(
        'branchId, userId, paymentMethod, and items are required'
      );
    }
    if (body.userId !== auth.userId) {
      throw new PharmacyServiceError('You can only record a sale as yourself');
    }
    if (!(await canAccessBranch(db, auth, body.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }

    // Validate all batches have enough stock, and capture each batch's cost
    // (purchasePrice) up front — needed below to post COGS at cost, not at
    // the selling price the customer was actually charged.
    let costOfGoodsSold = 0;
    for (const item of body.items) {
      const batch = await db.productBatch.findUnique({
        where: { id: item.batchId },
      });
      if (!batch) {
        throw new PharmacyServiceError(`Batch ${item.batchId} not found`);
      }
      if (batch.quantityInStock < item.quantity) {
        throw new PharmacyServiceError(
          `Insufficient stock for batch ${batch.batchNumber}. Available: ${batch.quantityInStock}, Requested: ${item.quantity}`
        );
      }
      costOfGoodsSold += batch.purchasePrice * item.quantity;
    }

    // Compute totals
    const subtotalAmount = body.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0
    );
    const discountAmount = body.discountAmount ?? 0;
    const taxAmount = body.taxAmount ?? 0;
    const totalAmount = subtotalAmount - discountAmount + taxAmount;

    if (discountAmount < 0 || taxAmount < 0) {
      throw new PharmacyServiceError('discountAmount and taxAmount cannot be negative');
    }
    if (totalAmount < 0) {
      throw new PharmacyServiceError(
        `discountAmount (${discountAmount}) cannot exceed the subtotal plus tax (${subtotalAmount + taxAmount})`
      );
    }

    // Generate invoice number
    const invoiceNumber = `INV-${body.branchId}-${Date.now()}`;

    const sale = await db.$transaction(async (tx) => {
      // Create the sale
      const newSale = await tx.sale.create({
        data: {
          branchId: body.branchId,
          invoiceNumber,
          userId: body.userId,
          customerName: body.customerName ?? 'Walk-in Customer',
          customerPhone: body.customerPhone,
          doctorName: body.doctorName,
          subtotalAmount,
          discountAmount,
          taxAmount,
          totalAmount,
          paymentMethod: body.paymentMethod,
        },
      });

      // Create sale items and decrement batch stock
      for (const item of body.items) {
        await tx.saleItem.create({
          data: {
            saleId: newSale.id,
            productId: item.productId,
            batchId: item.batchId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.quantity * item.unitPrice,
          },
        });

        // Decrement batch stock
        await tx.productBatch.update({
          where: { id: item.batchId },
          data: { quantityInStock: { decrement: item.quantity } },
        });
      }

      // Handle prescription refill if rxItemId is provided
      if (body.rxItemId) {
        const rxItem = await tx.prescriptionItem.findUnique({
          where: { id: body.rxItemId },
        });

        if (rxItem) {
          if (rxItem.refillsRemaining <= 0) {
            throw new PharmacyServiceError('No refills remaining for this prescription item');
          }

          // Decrement refills remaining
          await tx.prescriptionItem.update({
            where: { id: body.rxItemId },
            data: {
              refillsRemaining: { decrement: 1 },
              lastDispensedDate: new Date(),
            },
          });

          // Create refill dispensing log
          await tx.refillDispensingLog.create({
            data: {
              rxItemId: body.rxItemId,
              saleId: newSale.id,
              dispensedByUserId: body.userId,
              quantityDispensed: body.items[0]?.quantity ?? 1,
            },
          });
        }
      }

      // Best-effort GL posting — the same philosophy as goods receipts:
      // debit Cash/AR for what the customer paid, credit Sales Revenue
      // (net of discount) and Tax Payable; separately debit COGS and
      // credit Inventory Asset for the cost of what left the shelf. If the
      // chart of accounts isn't fully mapped yet, or the accounting period
      // is closed, the sale still succeeds — ringing up a sale should
      // never be blocked by bookkeeping configuration.
      let journalEntryId: string | undefined;
      try {
        const saleDate = new Date();
        const paymentKey = paymentMappingKey(body.paymentMethod);
        const [paymentMapping, revenueMapping, taxMapping, cogsMapping, inventoryMapping, baseCurrency] =
          await Promise.all([
            tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: paymentKey } } }),
            tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'SALES_REVENUE' } } }),
            tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'TAX_PAYABLE' } } }),
            tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'COGS' } } }),
            tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'INVENTORY_ASSET' } } }),
            tx.currency.findFirst({ where: { companyId: auth.companyId, isBaseCurrency: true } }),
          ]);

        await assertPeriodOpenForDate(tx, saleDate);

        const netRevenue = subtotalAmount - discountAmount;
        const canPostRevenue = paymentMapping && revenueMapping && baseCurrency && totalAmount > 0;
        const canPostCogs = cogsMapping && inventoryMapping && baseCurrency && costOfGoodsSold > 0;

        if (canPostRevenue || canPostCogs) {
          const lines: { accountId: number; debit: number; credit: number; description: string }[] = [];

          if (canPostRevenue) {
            lines.push({ accountId: paymentMapping!.accountId, debit: totalAmount, credit: 0, description: `Payment received — ${invoiceNumber}` });
            lines.push({ accountId: revenueMapping!.accountId, debit: 0, credit: netRevenue, description: `Sales revenue — ${invoiceNumber}` });
            if (taxAmount > 0 && taxMapping) {
              lines.push({ accountId: taxMapping.accountId, debit: 0, credit: taxAmount, description: `Sales tax — ${invoiceNumber}` });
            } else if (taxAmount > 0) {
              // No TAX_PAYABLE mapping configured — fold tax into revenue
              // rather than silently dropping it from the entry (which
              // would leave debits and credits unbalanced).
              lines.push({ accountId: revenueMapping!.accountId, debit: 0, credit: taxAmount, description: `Sales tax (unmapped, folded into revenue) — ${invoiceNumber}` });
            }
          }

          if (canPostCogs) {
            lines.push({ accountId: cogsMapping!.accountId, debit: costOfGoodsSold, credit: 0, description: `Cost of goods sold — ${invoiceNumber}` });
            lines.push({ accountId: inventoryMapping!.accountId, debit: 0, credit: costOfGoodsSold, description: `Inventory reduction — ${invoiceNumber}` });
          }

          if (lines.length > 0 && baseCurrency) {
            const entryNumber = await generateEntryNumber();
            const entry = await tx.journalEntry.create({
              data: {
                entryNumber,
                branchId: body.branchId,
                entryDate: saleDate,
                description: `POS sale ${invoiceNumber}`,
                sourceType: 'SALE',
                sourceId: newSale.id,
                currencyId: baseCurrency.id,
                postedByUserId: body.userId,
                lines: { createMany: { data: lines } },
              },
            });
            journalEntryId = entry.id;
          }
        }
      } catch (glError) {
        // Don't let a GL posting hiccup block the sale itself.
        console.error('[Sale] GL posting skipped:', glError);
      }

      // Write audit log
      await writeAuditLog(tx, {
        branchId: body.branchId,
        userId: body.userId,
        action: 'CREATE_SALE',
        entityName: 'Sale',
        entityId: newSale.id,
        details: {
          invoiceNumber,
          totalAmount,
          paymentMethod: body.paymentMethod,
          itemCount: body.items.length,
          journalEntryPosted: !!journalEntryId,
        },
      });

      // Re-fetch with items: the earlier `include` on sale.create() ran
      // before the SaleItem rows above existed, so newSale.saleItems was
      // always empty. Also expose it as `items` (not `saleItems`) to match
      // what the receipt screen (pos-view.tsx) reads from the response.
      const saleWithItems = await tx.sale.findUniqueOrThrow({
        where: { id: newSale.id },
        include: {
          user: { select: { id: true, fullName: true, username: true } },
          saleItems: { include: { product: true, batch: true } },
        },
      });

      return {
        ...saleWithItems,
        items: saleWithItems.saleItems.map((si) => ({
          batchId: si.batchId,
          productId: si.productId,
          brandName: si.product.brandName,
          genericName: si.product.genericName,
          batchNumber: si.batch.batchNumber,
          expiryDate: si.batch.expiryDate,
          quantity: si.quantity,
          unitPrice: si.unitPrice,
        })),
        journalEntryPosted: !!journalEntryId,
      };
    });

    return NextResponse.json(sale, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
