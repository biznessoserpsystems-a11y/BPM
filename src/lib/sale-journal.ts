// The journal lines for a sale, and for reversing one. Same accounts and
// amounts as recording a sale (src/app/api/v1/sales/route.ts): debit Cash/AR
// for what was paid, credit Sales Revenue (net of discount) and Tax Payable;
// debit COGS and credit Inventory for the cost of what left the shelf.

export interface JournalLineData {
  accountId: number;
  debit: number;
  credit: number;
  description: string;
}

export interface SaleAccounts {
  payment?: number;
  revenue?: number;
  tax?: number;
  cogs?: number;
  inventory?: number;
}

export function buildSaleLines(args: {
  invoiceNumber: string;
  accounts: SaleAccounts;
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  costOfGoodsSold: number;
}): JournalLineData[] {
  const { invoiceNumber: inv, accounts: a, subtotalAmount, discountAmount, taxAmount, totalAmount, costOfGoodsSold } = args;
  const lines: JournalLineData[] = [];
  if (a.payment && a.revenue && totalAmount > 0) {
    lines.push({ accountId: a.payment, debit: totalAmount, credit: 0, description: `Payment received — ${inv}` });
    lines.push({ accountId: a.revenue, debit: 0, credit: subtotalAmount - discountAmount, description: `Sales revenue — ${inv}` });
    if (taxAmount > 0) {
      lines.push(
        a.tax
          ? { accountId: a.tax, debit: 0, credit: taxAmount, description: `Sales tax — ${inv}` }
          : { accountId: a.revenue, debit: 0, credit: taxAmount, description: `Sales tax (unmapped, folded into revenue) — ${inv}` }
      );
    }
  }
  if (a.cogs && a.inventory && costOfGoodsSold > 0) {
    lines.push({ accountId: a.cogs, debit: costOfGoodsSold, credit: 0, description: `Cost of goods sold — ${inv}` });
    lines.push({ accountId: a.inventory, debit: 0, credit: costOfGoodsSold, description: `Inventory reduction — ${inv}` });
  }
  return lines;
}

/** The mirror image of an entry: debits and credits swapped, so together they net to zero. */
export function reverseLines(lines: { accountId: number; debit: number; credit: number; description: string | null }[], note: string): JournalLineData[] {
  return lines.map((l) => ({
    accountId: l.accountId,
    debit: l.credit,
    credit: l.debit,
    description: `${note}${l.description ? ` — ${l.description}` : ''}`,
  }));
}
