import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { assertPeriodOpenForDate } from '@/lib/accounting-period';
import { generateEntryNumber } from '@/lib/journal-entry-number';
import type { CreateSalesReturnInput } from '@/types/pharmacy';

// Same tier as recording a stock adjustment or editing a prescription —
// actions with real financial/inventory consequences, not routine
// day-to-day operation.
const CAN_PROCESS_RETURN = ['ADMIN', 'MANAGER', 'EMPLOYEE'];

async function generateReturnNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await db.salesReturn.count({
    where: { returnNumber: { startsWith: `SR-${year}-` } },
  });
  return `SR-${year}-${String(count + 1).padStart(6, '0')}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { id } = await params;
    const returns = await db.salesReturn.findMany({
      where: { saleId: id },
      orderBy: { returnDate: 'desc' },
      include: {
        items: { include: { saleItem: { include: { product: { select: { brandName: true } } } } } },
        processedByUser: { select: { id: true, fullName: true, username: true } },
      },
    });

    return NextResponse.json(returns);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_PROCESS_RETURN);
    if (roleError) return roleError;

    const { id } = await params;
    const body: CreateSalesReturnInput = await request.json();

    if (!body.items?.length) {
      throw new PharmacyServiceError('At least one returned item is required');
    }

    const result = await db.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: { saleItems: { include: { batch: true, salesReturnItems: true } } },
      });
      if (!sale) {
        throw new PharmacyServiceError('Sale not found');
      }
      if (!(await canAccessBranch(tx, auth, sale.branchId))) {
        throw new PharmacyServiceError("You do not have access to this branch's data");
      }

      const returnDate = new Date();
      await assertPeriodOpenForDate(tx, returnDate);

      // Processing a return IS the whole point of this action — same
      // reasoning as depreciation/lease payments/revenue recognition:
      // fails loudly rather than silently skipping if the accounts
      // aren't configured, since there's no separate physical event to
      // protect if the posting can't happen.
      const paymentMappingKey = sale.paymentMethod === 'INSURANCE' ? 'AR' : 'CASH';
      const [returnsMapping, paymentMapping, inventoryMapping, cogsMapping, baseCurrency] = await Promise.all([
        tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'SALES_RETURNS' } } }),
        tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: paymentMappingKey } } }),
        tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'INVENTORY_ASSET' } } }),
        tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'COGS' } } }),
        tx.currency.findFirst({ where: { companyId: auth.companyId, isBaseCurrency: true } }),
      ]);
      if (!returnsMapping) {
        throw new PharmacyServiceError('SALES_RETURNS must be mapped in Settings → GL Mappings before processing a return');
      }
      if (!paymentMapping) {
        throw new PharmacyServiceError(`${paymentMappingKey} must be mapped in Settings → GL Mappings before processing a return`);
      }
      if (!baseCurrency) {
        throw new PharmacyServiceError('No base currency configured — set one in Settings → Currencies first');
      }
      if (body.restocked && (!inventoryMapping || !cogsMapping)) {
        throw new PharmacyServiceError('INVENTORY_ASSET and COGS must both be mapped before restocking a return');
      }

      // Validate each requested line against what's actually still
      // returnable — the original quantity sold minus whatever's already
      // been returned against that same line across any prior return.
      let totalAmount = 0;
      let totalCost = 0;
      const lineData: { saleItemId: string; quantity: number; amount: number; batchId: string; unitCost: number }[] = [];

      for (const requested of body.items) {
        const saleItem = sale.saleItems.find((si) => si.id === requested.saleItemId);
        if (!saleItem) {
          throw new PharmacyServiceError(`Item ${requested.saleItemId} does not belong to this sale`);
        }
        const alreadyReturned = saleItem.salesReturnItems.reduce((sum, r) => sum + r.quantity, 0);
        const maxReturnable = saleItem.quantity - alreadyReturned;
        if (requested.quantity <= 0 || requested.quantity > maxReturnable) {
          throw new PharmacyServiceError(
            `Cannot return ${requested.quantity} of ${saleItem.id} — only ${maxReturnable} remaining returnable`
          );
        }

        const unitPrice = saleItem.subtotal / saleItem.quantity;
        const amount = unitPrice * requested.quantity;
        totalAmount += amount;
        totalCost += saleItem.batch.purchasePrice * requested.quantity;

        lineData.push({
          saleItemId: saleItem.id,
          quantity: requested.quantity,
          amount,
          batchId: saleItem.batchId,
          unitCost: saleItem.batch.purchasePrice,
        });
      }

      const entryNumber = await generateEntryNumber();
      const lines = [
        { accountId: returnsMapping.accountId, debit: totalAmount, credit: 0, description: `Sales return — ${sale.invoiceNumber}` },
        { accountId: paymentMapping.accountId, debit: 0, credit: totalAmount, description: `Refund/credit — ${sale.invoiceNumber}` },
      ];
      if (body.restocked && totalCost > 0 && inventoryMapping && cogsMapping) {
        lines.push(
          { accountId: inventoryMapping.accountId, debit: totalCost, credit: 0, description: `Inventory restocked — ${sale.invoiceNumber}` },
          { accountId: cogsMapping.accountId, debit: 0, credit: totalCost, description: `COGS reversed — ${sale.invoiceNumber}` }
        );
      }

      const entry = await tx.journalEntry.create({
        data: {
          entryNumber,
          branchId: sale.branchId,
          entryDate: returnDate,
          description: `Sales return against ${sale.invoiceNumber}${body.reason ? ` — ${body.reason}` : ''}`,
          sourceType: 'SALES_RETURN',
          sourceId: sale.id,
          currencyId: baseCurrency.id,
          postedByUserId: auth.userId,
          lines: { createMany: { data: lines } },
        },
      });

      const returnNumber = await generateReturnNumber();
      const salesReturn = await tx.salesReturn.create({
        data: {
          saleId: sale.id,
          branchId: sale.branchId,
          returnNumber,
          reason: body.reason,
          restocked: body.restocked,
          totalAmount,
          processedByUserId: auth.userId,
          journalEntryId: entry.id,
          returnDate,
          items: {
            createMany: {
              data: lineData.map((l) => ({ saleItemId: l.saleItemId, quantity: l.quantity, amount: l.amount })),
            },
          },
        },
      });

      if (body.restocked) {
        for (const line of lineData) {
          await tx.productBatch.update({
            where: { id: line.batchId },
            data: { quantityInStock: { increment: line.quantity } },
          });
        }
      }

      return { salesReturn, journalEntryId: entry.id, totalAmount };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
