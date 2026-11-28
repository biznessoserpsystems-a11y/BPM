// Ranking products by what they sold. Pure: the API feeds it the sold lines,
// it returns the ranked rows. Returns are taken off, so a product that came
// back isn't credited for sales the customer reversed.

export interface SoldLine {
  saleId: string;
  productId: number;
  productName: string;
  genericName: string;
  sku: string;
  quantity: number;
  amount: number; // line subtotal, before invoice-level discount and tax
  returnedQuantity: number;
  returnedAmount: number;
}

export type RankBy = 'quantity' | 'revenue';

export interface RankedProduct {
  rank: number;
  productId: number;
  productName: string;
  genericName: string;
  sku: string;
  quantitySold: number; // after returns
  revenue: number; // after returns
  invoiceCount: number;
  /** share of ALL product sales in the period (not just the rows shown), 0–100 */
  sharePercent: number;
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

export function rankProducts(lines: SoldLine[], rankBy: RankBy, limit: number): { rows: RankedProduct[]; totalProducts: number; totalQuantity: number; totalRevenue: number } {
  const byProduct = new Map<number, { line: SoldLine; qty: number; revenue: number; sales: Set<string> }>();
  for (const l of lines) {
    const entry = byProduct.get(l.productId) ?? { line: l, qty: 0, revenue: 0, sales: new Set<string>() };
    entry.qty += l.quantity - l.returnedQuantity;
    entry.revenue += l.amount - l.returnedAmount;
    entry.sales.add(l.saleId);
    byProduct.set(l.productId, entry);
  }

  // A product fully returned has nothing left to rank.
  const all = [...byProduct.values()].filter((e) => e.qty > 0 || e.revenue > 0);
  const totalQuantity = all.reduce((n, e) => n + e.qty, 0);
  const totalRevenue = all.reduce((n, e) => n + e.revenue, 0);

  const primary = (e: { qty: number; revenue: number }) => (rankBy === 'quantity' ? e.qty : e.revenue);
  const secondary = (e: { qty: number; revenue: number }) => (rankBy === 'quantity' ? e.revenue : e.qty);
  all.sort((a, b) => primary(b) - primary(a) || secondary(b) - secondary(a) || a.line.productName.localeCompare(b.line.productName));

  const rows = all.slice(0, limit).map((e, i) => ({
    rank: i + 1,
    productId: e.line.productId,
    productName: e.line.productName,
    genericName: e.line.genericName,
    sku: e.line.sku,
    quantitySold: e.qty,
    revenue: round(e.revenue),
    invoiceCount: e.sales.size,
    sharePercent: (rankBy === 'quantity' ? totalQuantity : totalRevenue) > 0
      ? Math.round((primary(e) / (rankBy === 'quantity' ? totalQuantity : totalRevenue)) * 1000) / 10
      : 0,
  }));
  return { rows, totalProducts: all.length, totalQuantity, totalRevenue: round(totalRevenue) };
}

/** Inclusive YYYY-MM-DD range -> [from, to) at local midnight, or an error message. */
export function parseRange(from: string | null, to: string | null, parse: (s: string) => Date | null): { from: Date; to: Date } | { error: string } {
  const f = from ? parse(from) : null;
  const t = to ? parse(to) : null;
  if (!f || !t) return { error: 'from and to must be real dates in YYYY-MM-DD format' };
  if (f > t) return { error: 'from must not be after to' };
  const end = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
  if (end.getTime() - f.getTime() > 400 * 24 * 3600 * 1000) return { error: 'Pick a range of 13 months or less' };
  return { from: f, to: end };
}
