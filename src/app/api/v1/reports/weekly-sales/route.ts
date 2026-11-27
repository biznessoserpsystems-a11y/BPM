import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch, getCompanyBranchIds } from '@/lib/branch-access';
import { toLocalISODate, weekRangeFor } from '@/lib/week-range';

// Weekly Sales Report: every invoice in one Monday–Sunday week, with the
// products sold on it and the amounts.
//
//   GET /api/v1/reports/weekly-sales?date=2026-11-18&branchId=BR-1
//
//   date      any day in the week wanted (aligned to its Monday); omit for
//             the current week
//   branchId  one branch; omit for "everything I'm allowed to see"
//
// Who sees what is the same as Sales History: an Admin or Manager can look at
// any branch of their company (or all of them combined); anyone else sees
// their own branch only. Everything is limited to the caller's own company —
// Sale has no company column of its own, so that always means "branches that
// belong to my company", never an unscoped query.

// Totals are sums of floats; trim the noise (0.1 + 0.2) without rounding
// away real fractions of a currency unit.
const tidy = (n: number) => Math.round(n * 10_000) / 10_000;

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const range = weekRangeFor(request.nextUrl.searchParams.get('date'));

    const requestedBranchId = request.nextUrl.searchParams.get('branchId') || undefined;
    if (requestedBranchId && !(await canAccessBranch(db, auth, requestedBranchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }
    const seesWholeCompany = auth.roleName === 'ADMIN' || auth.roleName === 'MANAGER';
    const branchIds = requestedBranchId
      ? [requestedBranchId]
      : seesWholeCompany
        ? await getCompanyBranchIds(db, auth.companyId)
        : [auth.homeBranchId];

    const [sales, returns] = await Promise.all([
      db.sale.findMany({
        where: { branchId: { in: branchIds }, saleDate: { gte: range.from, lt: range.to } },
        orderBy: [{ saleDate: 'asc' }, { invoiceNumber: 'asc' }],
        include: {
          user: { select: { fullName: true } },
          saleItems: {
            orderBy: { id: 'asc' },
            include: {
              product: { select: { brandName: true, genericName: true, skuCode: true } },
              salesReturnItems: { select: { quantity: true } },
            },
          },
        },
      }),
      // Returns made THIS week (by return date), whichever week the original
      // sale was in — that's when the money actually went back.
      db.salesReturn.findMany({
        where: { branchId: { in: branchIds }, returnDate: { gte: range.from, lt: range.to } },
        orderBy: { returnDate: 'asc' },
        include: { sale: { select: { invoiceNumber: true } } },
      }),
    ]);

    const dayTotals = new Map(range.days.map((d) => [d.date, { invoiceCount: 0, total: 0 }]));
    let itemsSold = 0;
    let grossSales = 0;
    let discounts = 0;
    let tax = 0;
    let totalSales = 0;

    const invoices = sales.map((sale) => {
      const items = sale.saleItems.map((item) => {
        itemsSold += item.quantity;
        grossSales += item.subtotal;
        return {
          productName: item.product.brandName,
          genericName: item.product.genericName,
          sku: item.product.skuCode,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.subtotal,
          // Informational only — shown as "(2 returned)" next to the line.
          returnedQuantity: item.salesReturnItems.reduce((n, r) => n + r.quantity, 0),
        };
      });
      discounts += sale.discountAmount;
      tax += sale.taxAmount;
      totalSales += sale.totalAmount;
      const day = dayTotals.get(toLocalISODate(sale.saleDate));
      if (day) {
        day.invoiceCount += 1;
        day.total += sale.totalAmount;
      }
      return {
        id: sale.id,
        invoiceNumber: sale.invoiceNumber,
        saleDate: sale.saleDate,
        branchId: sale.branchId,
        customerName: sale.customerName,
        cashier: sale.user?.fullName ?? null,
        paymentMethod: sale.paymentMethod,
        subtotalAmount: sale.subtotalAmount,
        discountAmount: sale.discountAmount,
        taxAmount: sale.taxAmount,
        totalAmount: sale.totalAmount,
        items,
      };
    });

    const returnsTotal = returns.reduce((n, r) => n + r.totalAmount, 0);

    return NextResponse.json({
      weekStart: range.weekStart,
      weekEnd: range.weekEnd,
      branchId: requestedBranchId ?? null,
      generatedAt: new Date(),
      summary: {
        invoiceCount: invoices.length,
        itemsSold,
        grossSales: tidy(grossSales),
        discounts: tidy(discounts),
        tax: tidy(tax),
        totalSales: tidy(totalSales),
        returnsTotal: tidy(returnsTotal),
        netSales: tidy(totalSales - returnsTotal),
      },
      days: range.days.map((d) => ({
        date: d.date,
        label: d.label,
        invoiceCount: dayTotals.get(d.date)!.invoiceCount,
        total: tidy(dayTotals.get(d.date)!.total),
      })),
      invoices,
      returns: returns.map((r) => ({
        returnNumber: r.returnNumber,
        returnDate: r.returnDate,
        invoiceNumber: r.sale.invoiceNumber,
        reason: r.reason,
        amount: r.totalAmount,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
