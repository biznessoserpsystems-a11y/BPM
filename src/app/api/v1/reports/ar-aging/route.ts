import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { computeAging, type AgingCharge } from '@/lib/aging-report';

const CAN_VIEW_AR_AGING = ['ADMIN', 'MANAGER'];

/**
 * Unlike AP (where a supplier can be linked to its own AP sub-account —
 * see Catalog → Suppliers), there's no equivalent per-customer entity or
 * ledger link in this schema: customers are just a free-text name on
 * Sale, and there's currently no "record an AR collection" feature (the
 * inverse of Payments, which only handles cash going *out*). So this
 * report shows exactly what it can support honestly: every insurance
 * sale (a receivable — the claim is on the insurer, not cash in hand),
 * grouped by customer name, bucketed by how long it's been outstanding
 * since the sale. It does not net out collections, because nothing in
 * this app currently records one against a specific customer's balance.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_VIEW_AR_AGING);
    if (roleError) return roleError;

    const asOfDate = request.nextUrl.searchParams.get('asOfDate')
      ? new Date(request.nextUrl.searchParams.get('asOfDate')!)
      : new Date();

    const insuranceSales = await db.sale.findMany({
      where: { paymentMethod: 'INSURANCE' },
      orderBy: { saleDate: 'asc' },
      select: { customerName: true, totalAmount: true, saleDate: true, invoiceNumber: true },
    });

    const byCustomer = new Map<string, AgingCharge[]>();
    for (const sale of insuranceSales) {
      const key = sale.customerName || 'Unknown';
      const charges = byCustomer.get(key) ?? [];
      charges.push({ date: sale.saleDate, amount: sale.totalAmount, reference: sale.invoiceNumber });
      byCustomer.set(key, charges);
    }

    const rows = Array.from(byCustomer.entries())
      .map(([customerName, charges]) => {
        const totalCharged = charges.reduce((sum, c) => sum + c.amount, 0);
        const aging = computeAging(charges, 0, asOfDate);
        return { customerName, totalCharged, claimCount: charges.length, ...aging };
      })
      .sort((a, b) => b.totalOutstanding - a.totalOutstanding);

    const totals = rows.reduce(
      (acc, r) => ({
        current: acc.current + r.current,
        days31to60: acc.days31to60 + r.days31to60,
        days61to90: acc.days61to90 + r.days61to90,
        over90: acc.over90 + r.over90,
        totalOutstanding: acc.totalOutstanding + r.totalOutstanding,
      }),
      { current: 0, days31to60: 0, days61to90: 0, over90: 0, totalOutstanding: 0 }
    );

    return NextResponse.json({ asOfDate, rows, totals });
  } catch (error) {
    return handleApiError(error);
  }
}
