import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { computeAging, type AgingCharge } from '@/lib/aging-report';

// Admin/Manager-only reports (financial reports) already restrict by
// branch via canAccessBranch elsewhere in this app; AP aging is
// inherently company-wide (a supplier isn't scoped to one branch), so —
// same as the audit log — this is Admin/Manager only rather than
// per-branch filtered.
const CAN_VIEW_AP_AGING = ['ADMIN', 'MANAGER'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_VIEW_AP_AGING);
    if (roleError) return roleError;

    const asOfDate = request.nextUrl.searchParams.get('asOfDate')
      ? new Date(request.nextUrl.searchParams.get('asOfDate')!)
      : new Date();

    // "Must list all suppliers" — every supplier appears in the report,
    // including ones with nothing outstanding.
    const suppliers = await db.supplier.findMany({
      where: { companyId: auth.companyId, isActive: true },
      orderBy: { name: 'asc' },
    });

    const rows = await Promise.all(
      suppliers.map(async (supplier) => {
        // Goods receipts are the authoritative "what was actually owed
        // and when" record for this supplier, regardless of whether
        // they're on their own dedicated AP account or the shared one —
        // a receipt is always traceable back to its exact supplier via
        // the purchase order, unlike a lump GL account balance.
        const receipts = await db.goodsReceipt.findMany({
          where: { purchaseOrder: { supplierId: supplier.id } },
          include: { items: true, purchaseOrder: { select: { poNumber: true } } },
          orderBy: { receivedDate: 'asc' },
        });

        const charges: AgingCharge[] = receipts
          .map((r) => ({
            date: r.receivedDate,
            amount: r.items.reduce((sum, i) => sum + i.quantityReceived * i.unitCost, 0),
            reference: `${r.grnNumber} (${r.purchaseOrder.poNumber})`,
          }))
          .filter((c) => c.amount > 0);

        const totalCharged = charges.reduce((sum, c) => sum + c.amount, 0);

        // Only accurately attributable if this supplier has their own AP
        // sub-account (Catalog → Suppliers) — payments against the shared
        // global AP account can't be traced back to a specific supplier,
        // so this stays honestly at 0 for those rather than guessing.
        let totalPaid = 0;
        let usesSharedAccount = true;
        if (supplier.apAccountId) {
          usesSharedAccount = false;
          const debitLines = await db.journalLine.findMany({
            where: { accountId: supplier.apAccountId, debit: { gt: 0 } },
          });
          totalPaid = debitLines.reduce((sum, l) => sum + l.debit, 0);
        }

        const aging = computeAging(charges, totalPaid, asOfDate);

        return {
          supplierId: supplier.id,
          supplierName: supplier.name,
          usesSharedAccount,
          totalCharged,
          totalPaid,
          ...aging,
        };
      })
    );

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
