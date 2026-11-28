import { describe, it, expect } from 'vitest';
import { rankProducts, parseRange, type SoldLine } from '../src/lib/product-ranking';
import { parseLocalDate } from '../src/lib/week-range';
import { topProductsToCsv, topProductsToPdfSections } from '../src/lib/top-products-export';

const line = (saleId: string, productId: number, name: string, quantity: number, amount: number, returnedQuantity = 0, returnedAmount = 0): SoldLine => ({
  saleId, productId, productName: name, genericName: 'gen', sku: `SKU-${productId}`, quantity, amount, returnedQuantity, returnedAmount,
});

const lines = [
  line('s1', 1, 'Paracetamol', 10, 50),
  line('s2', 1, 'Paracetamol', 5, 25),
  line('s1', 2, 'Amoxicillin', 3, 90),
  line('s3', 3, 'Vitamin C', 8, 40),
];

describe('ranking products', () => {
  it('ranks by quantity sold, adding a product up across invoices', () => {
    const r = rankProducts(lines, 'quantity', 10);
    expect(r.rows.map((x) => [x.rank, x.productName, x.quantitySold])).toEqual([[1, 'Paracetamol', 15], [2, 'Vitamin C', 8], [3, 'Amoxicillin', 3]]);
    expect(r.rows[0]).toMatchObject({ revenue: 75, invoiceCount: 2 });
  });
  it('ranks by revenue when asked, which can reorder the list', () => {
    const r = rankProducts(lines, 'revenue', 10);
    expect(r.rows.map((x) => x.productName)).toEqual(['Amoxicillin', 'Paracetamol', 'Vitamin C']);
  });
  it('takes returns off, and a fully returned product drops out', () => {
    const r = rankProducts([line('s1', 1, 'A', 10, 100, 4, 40), line('s2', 2, 'B', 5, 50, 5, 50), line('s3', 3, 'C', 7, 70)], 'quantity', 10);
    expect(r.rows.map((x) => [x.productName, x.quantitySold, x.revenue])).toEqual([['C', 7, 70], ['A', 6, 60]]);
    expect(r.totalProducts).toBe(2);
  });
  it('limits the rows but shares are of the whole period, not just the rows shown', () => {
    const r = rankProducts(lines, 'quantity', 1);
    expect(r.rows).toHaveLength(1);
    expect(r.totalProducts).toBe(3);
    expect(r.totalQuantity).toBe(26);
    expect(r.rows[0].sharePercent).toBeCloseTo(57.7, 1); // 15 of 26
  });
  it('breaks ties by the other measure, then by name, so the order is stable', () => {
    const r = rankProducts([line('a', 1, 'Zinc', 5, 10), line('b', 2, 'Aspirin', 5, 10), line('c', 3, 'Bandage', 5, 30)], 'quantity', 10);
    expect(r.rows.map((x) => x.productName)).toEqual(['Bandage', 'Aspirin', 'Zinc']);
  });
  it('an empty period ranks nothing', () => {
    expect(rankProducts([], 'quantity', 10)).toMatchObject({ rows: [], totalProducts: 0, totalQuantity: 0, totalRevenue: 0 });
  });
});

describe('date range', () => {
  it('includes the whole last day', () => {
    const r = parseRange('2026-11-01', '2026-11-28', parseLocalDate);
    if ('error' in r) throw new Error(r.error);
    expect(r.from).toEqual(new Date(2026, 10, 1));
    expect(r.to).toEqual(new Date(2026, 10, 29));
  });
  it('rejects missing, backwards, impossible and over-long ranges', () => {
    expect('error' in parseRange(null, '2026-11-28', parseLocalDate)).toBe(true);
    expect('error' in parseRange('2026-11-28', '2026-11-01', parseLocalDate)).toBe(true);
    expect('error' in parseRange('2026-02-30', '2026-03-05', parseLocalDate)).toBe(true);
    expect('error' in parseRange('2024-01-01', '2026-11-28', parseLocalDate)).toBe(true);
  });
});

describe('exports', () => {
  const report = { from: '2026-11-01', to: '2026-11-28', rankBy: 'quantity' as const, ...rankProducts(lines, 'quantity', 10) };
  it('CSV has a row per product and guards spreadsheet formulas', () => {
    const csv = topProductsToCsv({ ...report, rows: [{ ...report.rows[0], productName: '=HYPERLINK("x")' }] });
    expect(csv.split('\r\n')[0]).toContain('Rank,Product');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
  it('PDF section shows rank, quantity, revenue, invoices and share as text', () => {
    const sec = topProductsToPdfSections(report, (n) => `GHS ${n.toFixed(2)}`)[0];
    expect(sec.columns).toEqual(['#', 'Product', 'Qty sold', 'Revenue', 'Invoices', 'Share']);
    expect(sec.rows[0]).toEqual(['1', 'Paracetamol', '15', 'GHS 75.00', '2', '57.7%']);
  });
});
