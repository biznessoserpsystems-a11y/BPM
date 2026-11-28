import { describe, it, expect } from 'vitest';
import { weeklySalesToCsv, weeklySalesToPdfSections, weeklySalesFileName, type WeeklySalesReport } from '../src/lib/weekly-sales-export';

// Built from local-time constructors so the formatted dates/times are the same in any timezone.
const iso = (day: number, h: number, min: number) => new Date(2026, 10, day, h, min).toISOString();

const item = (productName: string, quantity: number, unitPrice: number) => ({
  productName, genericName: 'generic', sku: 'SKU-1', quantity, unitPrice, amount: quantity * unitPrice, returnedQuantity: 0,
});

function reportWith(over: Partial<WeeklySalesReport> = {}): WeeklySalesReport {
  return {
    weekStart: '2026-11-16',
    weekEnd: '2026-11-22',
    branchId: null,
    summary: { invoiceCount: 2, itemsSold: 6, grossSales: 37, discounts: 2, tax: 1.1, totalSales: 36.1, returnsTotal: 0, netSales: 36.1 },
    days: [
      { date: '2026-11-16', label: 'Mon', invoiceCount: 0, itemsSold: 0, discounts: 0, tax: 0, total: 0, returns: 0, net: 0 },
      { date: '2026-11-18', label: 'Wed', invoiceCount: 1, itemsSold: 3, discounts: 2, tax: 1.1, total: 21.1, returns: 0, net: 21.1 },
    ],
    invoices: [
      {
        id: 'a', invoiceNumber: 'INV-0001', saleDate: iso(18, 9, 30), branchId: 'b', customerName: null, cashier: 'Ama', paymentMethod: 'CASH',
        subtotalAmount: 22, discountAmount: 2, taxAmount: 1.1, totalAmount: 21.1,
        items: [item('Paracetamol 500mg', 2, 5), item('Amoxicillin 250mg', 1, 12)],
      },
      {
        id: 'b', invoiceNumber: 'INV-0002', saleDate: iso(20, 16, 45), branchId: 'b', customerName: null, cashier: 'Ama', paymentMethod: 'MOBILE_MONEY',
        subtotalAmount: 15, discountAmount: 0, taxAmount: 0, totalAmount: 15,
        items: [item('Paracetamol 500mg', 3, 5)],
      },
    ],
    returns: [],
    ...over,
  };
}

const money = (n: number) => n.toFixed(2);

describe('CSV export', () => {
  const csv = weeklySalesToCsv(reportWith());
  const lines = csv.replace('\uFEFF', '').trimEnd().split('\r\n');

  it('starts with a byte-order mark so Excel reads it correctly, and uses CRLF line ends', () => {
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('has a header and one row per product sold', () => {
    expect(lines[0]).toBe('Invoice ref,Date,Time,Product sold,Generic name,SKU,Quantity,Unit price,Amount,Invoice total,Payment method');
    expect(lines).toHaveLength(1 + 3);
    expect(lines[1]).toBe('INV-0001,2026-11-18,09:30,Paracetamol 500mg,generic,SKU-1,2,5,10,21.1,CASH');
    expect(lines[2]).toBe('INV-0001,2026-11-18,09:30,Amoxicillin 250mg,generic,SKU-1,1,12,12,,');
    expect(lines[3]).toBe('INV-0002,2026-11-20,16:45,Paracetamol 500mg,generic,SKU-1,3,5,15,15,MOBILE_MONEY');
  });

  it('writes the invoice total once per invoice, so a column sum never double counts', () => {
    const cols = lines.slice(1).map((l) => l.split(','));
    const amount = cols.reduce((n, c) => n + Number(c[8]), 0);
    const invoiceTotals = cols.reduce((n, c) => n + (c[9] ? Number(c[9]) : 0), 0);
    expect(amount).toBe(37); // gross, before discount and tax
    expect(invoiceTotals).toBeCloseTo(36.1, 6); // what was actually taken
  });

  it('quotes cells containing commas, quotes or line breaks', () => {
    const r = reportWith();
    r.invoices[0].items[0].productName = 'Cough syrup, 100ml "adult"';
    expect(weeklySalesToCsv(r)).toContain('"Cough syrup, 100ml ""adult"""');
  });

  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '=HYPERLINK("http://x","click")'])(
    'neutralises a name that would run as a spreadsheet formula: %s',
    (name) => {
      const r = reportWith();
      r.invoices[0].items[0].productName = name;
      const row = weeklySalesToCsv(r).split('\r\n')[1];
      // an apostrophe makes it plain text; the cell is then quoted if it contains commas or quotes
      const safe = `'${name}`;
      const cell = /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
      expect(row).toContain(`,${cell},`);
    }
  );

  it('does not touch real numbers, including negatives', () => {
    const r = reportWith();
    r.invoices[0].items[0].unitPrice = -5;
    expect(weeklySalesToCsv(r).split('\r\n')[1]).toContain(',-5,');
  });

  it('an empty week is just the header', () => {
    const empty = weeklySalesToCsv(reportWith({ invoices: [] })).replace('\uFEFF', '').trimEnd().split('\r\n');
    expect(empty).toHaveLength(1);
  });

  it('names the file after the week', () => {
    expect(weeklySalesFileName({ weekStart: '2026-11-16' }, 'csv')).toBe('weekly-sales-2026-11-16.csv');
  });
});

describe('PDF sections', () => {
  it('lists each product with its invoice ref, then an invoice total, then the week total', () => {
    const sales = weeklySalesToPdfSections(reportWith(), money).find((s) => s.heading === 'Sales')!;
    expect(sales.columns).toEqual(['Invoice ref', 'Date', 'Product sold', 'Qty', 'Amount']);
    const asText = sales.rows.map((r) => [r[0], r[2], r[3], r[4]]);
    expect(asText).toEqual([
      ['INV-0001', 'Paracetamol 500mg', '2', '10.00'],
      ['', 'Amoxicillin 250mg', '1', '12.00'],       // ref not repeated on the invoice's later lines
      ['', 'Invoice total', '', '21.10'],
      ['INV-0002', 'Paracetamol 500mg', '3', '15.00'],
      ['', 'Invoice total', '', '15.00'],
      ['', 'WEEK TOTAL', '', '36.10'],
    ]);
  });

  it('shows returns and net sales only when there were returns', () => {
    const without = weeklySalesToPdfSections(reportWith(), money);
    expect(without.map((s) => s.heading)).toEqual(['Summary', 'Daily sales summary', 'Sales']);
    expect(without[0].rows.some((r) => r[0] === 'Net sales')).toBe(false);

    const withReturns = weeklySalesToPdfSections(
      reportWith({
        summary: { ...reportWith().summary, returnsTotal: 10, netSales: 26.1 },
        returns: [{ returnNumber: 'RT-1', returnDate: iso(19, 10, 0), invoiceNumber: 'INV-0001', reason: null, amount: 10 }],
      }),
      money
    );
    expect(withReturns.map((s) => s.heading)).toContain('Returns made this week');
    expect(withReturns[0].rows).toContainEqual(['Net sales', '26.10']);
    expect(withReturns.find((s) => s.heading === 'Returns made this week')!.rows[0][2]).toBe('INV-0001');
  });

  it('says so when nothing was sold, rather than printing an empty table', () => {
    const sales = weeklySalesToPdfSections(reportWith({ invoices: [] }), money).find((s) => s.heading === 'Sales')!;
    expect(sales.rows).toEqual([['', '', 'No sales recorded this week', '', '']]);
  });
});
