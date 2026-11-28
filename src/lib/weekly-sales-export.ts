import { format } from 'date-fns';
import type { PdfSection } from '@/lib/pdf-export';

// Shape of GET /api/v1/reports/weekly-sales, plus the two ways the report
// leaves the screen: a CSV for spreadsheets and the sections for the shared
// PDF exporter. Plain functions (no React, no network) so the exact output is
// testable.

export interface WeeklySalesItem {
  productName: string;
  genericName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  returnedQuantity: number;
}

export interface WeeklySalesInvoice {
  id: string;
  invoiceNumber: string;
  saleDate: string;
  branchId: string;
  customerName: string | null;
  cashier: string | null;
  paymentMethod: string;
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  items: WeeklySalesItem[];
}

export interface WeeklySalesDay {
  date: string;
  label: string;
  invoiceCount: number;
  itemsSold: number;
  discounts: number;
  tax: number;
  total: number;
  returns: number;
  net: number;
}

export interface WeeklySalesReport {
  /** 'day' for the Daily Sales Report; absent or 'week' for the weekly one. */
  period?: 'week' | 'day';
  weekStart: string;
  weekEnd: string;
  branchId: string | null;
  summary: {
    invoiceCount: number;
    itemsSold: number;
    grossSales: number;
    discounts: number;
    tax: number;
    totalSales: number;
    returnsTotal: number;
    netSales: number;
  };
  days: WeeklySalesDay[];
  invoices: WeeklySalesInvoice[];
  returns: { returnNumber: string; returnDate: string; invoiceNumber: string; reason: string | null; amount: number }[];
}

type FormatAmount = (n: number) => string;

const dateOf = (iso: string) => format(new Date(iso), 'yyyy-MM-dd');
const timeOf = (iso: string) => format(new Date(iso), 'HH:mm');
const whenOf = (iso: string) => format(new Date(iso), 'EEE d MMM, HH:mm');

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * A spreadsheet treats a cell starting with = + - @ (or a tab/CR) as a
 * formula. Product names and the like are typed by staff, so a name such as
 * `=HYPERLINK(...)` would run when the file is opened. Prefixing an
 * apostrophe makes it plain text. Numbers are written as numbers, untouched.
 */
export function csvCell(value: string | number | null): string {
  if (value === null || value === '') return '';
  if (typeof value === 'number') return String(value);
  let s = value;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * One row per product sold. The invoice total is written on an invoice's
 * FIRST row only, so adding up the Amount column gives gross sales and adding
 * up the Invoice total column gives the amount taken, with nothing counted
 * twice. A leading byte-order mark makes Excel read accents correctly.
 */
export function weeklySalesToCsv(report: WeeklySalesReport): string {
  const header = [
    'Invoice ref', 'Date', 'Time', 'Product sold', 'Generic name', 'SKU', 'Quantity', 'Unit price', 'Amount', 'Invoice total', 'Payment method',
  ];
  const rows: (string | number | null)[][] = [];
  for (const inv of report.invoices) {
    inv.items.forEach((item, i) => {
      rows.push([
        inv.invoiceNumber,
        dateOf(inv.saleDate),
        timeOf(inv.saleDate),
        item.productName,
        item.genericName,
        item.sku,
        item.quantity,
        item.unitPrice,
        item.amount,
        i === 0 ? inv.totalAmount : null,
        i === 0 ? inv.paymentMethod : null,
      ]);
    });
  }
  return '\uFEFF' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function weeklySalesFileName(report: Pick<WeeklySalesReport, 'weekStart' | 'period'>, ext: 'csv' | 'pdf'): string {
  return `${report.period === 'day' ? 'daily' : 'weekly'}-sales-${report.weekStart}.${ext}`;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export function weeklySalesToPdfSections(report: WeeklySalesReport, money: FormatAmount): PdfSection[] {
  const s = report.summary;

  const summaryRows: (string | number)[][] = [
    ['Invoices', String(s.invoiceCount)],
    ['Items sold', String(s.itemsSold)],
    ['Sales before discount and tax', money(s.grossSales)],
    ['Discounts', `(${money(s.discounts)})`],
    ['Tax', money(s.tax)],
    ['Total sales', money(s.totalSales)],
  ];
  if (s.returnsTotal > 0) {
    summaryRows.push([report.period === 'day' ? 'Returns today' : 'Returns this week', `(${money(s.returnsTotal)})`], ['Net sales', money(s.netSales)]);
  }

  const lineRows: (string | number)[][] = [];
  for (const inv of report.invoices) {
    inv.items.forEach((item, i) => {
      lineRows.push([
        i === 0 ? inv.invoiceNumber : '',
        i === 0 ? whenOf(inv.saleDate) : '',
        item.productName,
        String(item.quantity), // a count, not money: the PDF exporter would print a number as 2.00
        money(item.amount),
      ]);
    });
    lineRows.push(['', '', 'Invoice total', '', money(inv.totalAmount)]);
  }
  if (report.invoices.length > 0) lineRows.push(['', '', report.period === 'day' ? 'DAY TOTAL' : 'WEEK TOTAL', '', money(s.totalSales)]);

  const sections: PdfSection[] = [
    { heading: 'Summary', columns: ['Measure', 'Value'], rows: summaryRows, columnStyles: { 1: { halign: 'right' } } },
    ...(report.period === 'day'
      ? []
      : [
          {
            heading: 'Daily sales summary',
            columns: ['Day', 'Date', 'Invoices', 'Items', 'Total sales', 'Returns', 'Net sales'],
            rows: [
              ...report.days.map((d) => [
                d.label,
                d.date,
                String(d.invoiceCount),
                String(d.itemsSold),
                money(d.total),
                d.returns > 0 ? `(${money(d.returns)})` : '-',
                money(d.net),
              ]),
              [
                'Week',
                '',
                String(s.invoiceCount),
                String(s.itemsSold),
                money(s.totalSales),
                s.returnsTotal > 0 ? `(${money(s.returnsTotal)})` : '-',
                money(s.netSales),
              ],
            ],
            columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
          } as PdfSection,
        ]),
    {
      heading: 'Sales',
      columns: ['Invoice ref', 'Date', 'Product sold', 'Qty', 'Amount'],
      rows: lineRows.length > 0 ? lineRows : [['', '', 'No sales recorded this week', '', '']],
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
    },
  ];

  if (report.returns.length > 0) {
    sections.push({
      heading: report.period === 'day' ? 'Returns made today' : 'Returns made this week',
      columns: ['Return', 'Date', 'Invoice ref', 'Amount'],
      rows: report.returns.map((r) => [r.returnNumber, whenOf(r.returnDate), r.invoiceNumber, `(${money(r.amount)})`]),
      columnStyles: { 3: { halign: 'right' } },
    });
  }
  return sections;
}
