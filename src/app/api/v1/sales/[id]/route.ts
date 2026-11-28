import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { writeAuditLog } from '@/lib/audit-log';
import { assertPeriodOpenForDate } from '@/lib/accounting-period';
import { loadOverrides, resolvePermission } from '@/lib/inventory-permissions';
import { PAYMENT_METHODS, computeTotals, decideEdit, validateLine } from '@/lib/sale-edit';
import { buildSaleLines, reverseLines } from '@/lib/sale-journal';

// Edit a recorded sale — today's or an earlier day's.
//
//   PATCH /api/v1/sales/:id
//   { reason, customerName?, customerPhone?, doctorName?, paymentMethod?,
//     discountAmount?, taxAmount?, items?: [{ id, quantity?, unitPrice? }] }
//
// Who may: see decideEdit() in src/lib/sale-edit.ts (today vs earlier days,
// permissions an Admin can grant). A reason is always required.
//
// What changes along with the sale, all in ONE transaction (so it is all
// applied or none of it):
//   - stock: a quantity change moves the difference in or out of the batch the
//     line was sold from (and can't take more than the batch has);
//   - the books: the sale's journal entry is REVERSED by a new mirror entry and
//     a corrected one is posted — nothing already posted is altered or
//     deleted, so the ledger keeps the full history;
//   - the audit log: the before and after, and the reason.
// Lines can be corrected but not added or removed here (use a return to take a
// product off a sale), and a line can't go below what was already returned.

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const { id } = await params;
    const body = await request.json();

    const reason = clean(body.reason) ?? '';
    if (reason.length < 3) throw new PharmacyServiceError('Give a reason for the change (at least 3 characters)');

    const result = await db.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: { saleItems: { include: { batch: true, salesReturnItems: true } } },
      });
      if (!sale || !(await canAccessBranch(tx, auth, sale.branchId))) throw new PharmacyServiceError('Sale not found');

      const now = new Date();
      const overrides = await loadOverrides(tx, auth.userId);
      const decision = decideEdit({
        roleName: auth.roleName,
        userId: auth.userId,
        sale,
        now,
        has: (key) => resolvePermission(key, auth.roleName, overrides.get(key)),
      });
      if (!decision.ok) throw new PharmacyServiceError(decision.reason);

      // ---- what the sale will look like after the change
      let paymentMethod = sale.paymentMethod;
      if (body.paymentMethod !== undefined) {
        if (!(PAYMENT_METHODS as readonly string[]).includes(body.paymentMethod)) {
          throw new PharmacyServiceError(`paymentMethod must be one of ${PAYMENT_METHODS.join(', ')}`);
        }
        paymentMethod = body.paymentMethod;
      }

      const requested = new Map<string, { quantity?: unknown; unitPrice?: unknown }>();
      for (const row of Array.isArray(body.items) ? body.items : []) {
        if (!row || typeof row.id !== 'string' || !sale.saleItems.some((i) => i.id === row.id)) {
          throw new PharmacyServiceError('One of the items is not on this sale');
        }
        requested.set(row.id, row);
      }

      const newLines = sale.saleItems.map((item) => {
        const row = requested.get(item.id);
        const returned = item.salesReturnItems.reduce((n, r) => n + r.quantity, 0);
        try {
          const line = validateLine(
            { quantity: row?.quantity ?? item.quantity, unitPrice: row?.unitPrice ?? item.unitPrice },
            returned
          );
          return { item, ...line };
        } catch (e) {
          throw new PharmacyServiceError(`${(e as Error).message}`);
        }
      });

      const discountAmount = body.discountAmount !== undefined ? Number(body.discountAmount) : sale.discountAmount;
      const taxAmount = body.taxAmount !== undefined ? Number(body.taxAmount) : sale.taxAmount;
      let totals;
      try {
        totals = computeTotals(newLines, discountAmount, taxAmount);
      } catch (e) {
        throw new PharmacyServiceError((e as Error).message);
      }

      const oldCost = sale.saleItems.reduce((n, i) => n + i.batch.purchasePrice * i.quantity, 0);
      const newCost = newLines.reduce((n, l) => n + l.item.batch.purchasePrice * l.quantity, 0);

      // ---- stock: move only the difference, and never below zero
      for (const l of newLines) {
        const delta = l.quantity - l.item.quantity;
        if (delta === 0) continue;
        if (delta > 0 && l.item.batch.quantityInStock < delta) {
          throw new PharmacyServiceError(
            `Not enough stock in batch ${l.item.batch.batchNumber} to sell ${delta} more (available: ${l.item.batch.quantityInStock})`
          );
        }
        await tx.productBatch.update({ where: { id: l.item.batchId }, data: { quantityInStock: { decrement: delta } } });
      }
      for (const l of newLines) {
        if (l.quantity !== l.item.quantity || l.unitPrice !== l.item.unitPrice) {
          await tx.saleItem.update({ where: { id: l.item.id }, data: { quantity: l.quantity, unitPrice: l.unitPrice, subtotal: l.quantity * l.unitPrice } });
        }
      }

      const before = {
        customerName: sale.customerName, customerPhone: sale.customerPhone, doctorName: sale.doctorName, paymentMethod: sale.paymentMethod,
        discountAmount: sale.discountAmount, taxAmount: sale.taxAmount, subtotalAmount: sale.subtotalAmount, totalAmount: sale.totalAmount,
        items: sale.saleItems.map((i) => ({ id: i.id, quantity: i.quantity, unitPrice: i.unitPrice })),
      };
      const data = {
        customerName: body.customerName !== undefined ? clean(body.customerName) || 'Walk-in Customer' : sale.customerName,
        customerPhone: body.customerPhone !== undefined ? clean(body.customerPhone) || null : sale.customerPhone,
        doctorName: body.doctorName !== undefined ? clean(body.doctorName) || null : sale.doctorName,
        paymentMethod,
        discountAmount,
        taxAmount,
        subtotalAmount: totals.subtotalAmount,
        totalAmount: totals.totalAmount,
      };
      await tx.sale.update({ where: { id }, data });

      // ---- the books: reverse the posted entry, post the corrected one
      const moneyChanged =
        paymentMethod !== sale.paymentMethod ||
        totals.subtotalAmount !== sale.subtotalAmount ||
        totals.totalAmount !== sale.totalAmount ||
        discountAmount !== sale.discountAmount ||
        taxAmount !== sale.taxAmount ||
        newCost !== oldCost;

      let corrected: 'reposted' | 'no-change' | 'sale-had-no-entry' = 'no-change';
      if (moneyChanged) {
        const original = await tx.journalEntry.findFirst({
          where: { sourceId: id, sourceType: { in: ['SALE', 'SALE_EDIT'] }, reversedByEntryId: null, status: 'POSTED' },
          orderBy: { createdAt: 'desc' },
          include: { lines: true },
        });
        if (!original) {
          // The sale was never posted to the books (accounts weren't mapped at the time) — nothing to correct.
          corrected = 'sale-had-no-entry';
        } else {
          await assertPeriodOpenForDate(tx, now);
          const key = paymentMethod === 'INSURANCE' ? 'AR' : 'CASH';
          const keys = [key, 'SALES_REVENUE', 'TAX_PAYABLE', 'COGS', 'INVENTORY_ASSET'] as const;
          const maps = await tx.gLAccountMapping.findMany({ where: { companyId: auth.companyId, mappingKey: { in: [...keys] } } });
          const acct = (k: string) => maps.find((m) => m.mappingKey === k)?.accountId;
          const newLinesJe = buildSaleLines({
            invoiceNumber: sale.invoiceNumber,
            accounts: { payment: acct(key), revenue: acct('SALES_REVENUE'), tax: acct('TAX_PAYABLE'), cogs: acct('COGS'), inventory: acct('INVENTORY_ASSET') },
            subtotalAmount: totals.subtotalAmount,
            discountAmount,
            taxAmount,
            totalAmount: totals.totalAmount,
            costOfGoodsSold: newCost,
          });

          // Two entries in one transaction: number them together so they can't collide.
          const year = now.getFullYear();
          const count = await tx.journalEntry.count({ where: { entryNumber: { startsWith: `JE-${year}-` } } });
          const number = (n: number) => `JE-${year}-${String(count + n).padStart(6, '0')}`;

          const reversal = await tx.journalEntry.create({
            data: {
              entryNumber: number(1),
              branchId: sale.branchId,
              entryDate: now,
              description: `Reversal of ${original.entryNumber} — edit of sale ${sale.invoiceNumber}: ${reason}`,
              sourceType: 'SALE_EDIT_REVERSAL',
              sourceId: id,
              currencyId: original.currencyId,
              exchangeRate: original.exchangeRate,
              postedByUserId: auth.userId,
              lines: { createMany: { data: reverseLines(original.lines, 'Reversal') } },
            },
          });
          await tx.journalEntry.update({ where: { id: original.id }, data: { status: 'REVERSED', reversedByEntryId: reversal.id } });
          if (newLinesJe.length > 0) {
            await tx.journalEntry.create({
              data: {
                entryNumber: number(2),
                branchId: sale.branchId,
                entryDate: now,
                description: `Corrected sale ${sale.invoiceNumber}: ${reason}`,
                sourceType: 'SALE_EDIT',
                sourceId: id,
                currencyId: original.currencyId,
                exchangeRate: original.exchangeRate,
                postedByUserId: auth.userId,
                lines: { createMany: { data: newLinesJe } },
              },
            });
          }
          corrected = 'reposted';
        }
      }

      await writeAuditLog(tx, {
        branchId: sale.branchId,
        userId: auth.userId,
        action: 'EDIT_SALE',
        entityName: 'Sale',
        entityId: id,
        details: {
          invoiceNumber: sale.invoiceNumber,
          reason,
          saleDate: sale.saleDate,
          before,
          after: { ...data, items: newLines.map((l) => ({ id: l.item.id, quantity: l.quantity, unitPrice: l.unitPrice })) },
          books: corrected,
        },
      });

      return tx.sale.findUniqueOrThrow({
        where: { id },
        include: {
          user: { select: { id: true, fullName: true, username: true } },
          saleItems: {
            include: {
              product: { select: { brandName: true, genericName: true, skuCode: true } },
              salesReturnItems: { select: { quantity: true } },
            },
          },
        },
      });
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
