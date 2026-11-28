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

export interface WeeklySalesReport {
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
  days: { date: string; label: string; invoiceCount: number; total: number }[];
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
function csvCell(value: string | number | null): string {
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

export function weeklySalesFileName(report: Pick<WeeklySalesReport, 'weekStart'>, ext: 'csv' | 'pdf'): string {
  return `weekly-sales-${report.weekStart}.${ext}`;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export function weeklySalesToPdfSections(report: WeeklySalesReport, money: FormatAmount): PdfSection[] {
  const s = report.summary;

  const summaryRows: (string | number)[][] = [
    ['Invoices', s.invoiceCount],
    ['Items sold', s.itemsSold],
    ['Sales before discount and tax', money(s.grossSales)],
    ['Discounts', `(${money(s.discounts)})`],
    ['Tax', money(s.tax)],
    ['Total sales', money(s.totalSales)],
  ];
  if (s.returnsTotal > 0) {
    summaryRows.push(['Returns this week', `(${money(s.returnsTotal)})`], ['Net sales', money(s.netSales)]);
  }

  const lineRows: (string | number)[][] = [];
  for (const inv of report.invoices) {
    inv.items.forEach((item, i) => {
      lineRows.push([
        i === 0 ? inv.invoiceNumber : '',
        i === 0 ? whenOf(inv.saleDate) : '',
        item.productName,
        item.quantity,
        money(item.amount),
      ]);
    });
    lineRows.push(['', '', 'Invoice total', '', money(inv.totalAmount)]);
  }
  if (report.invoices.length > 0) lineRows.push(['', '', 'WEEK TOTAL', '', money(s.totalSales)]);

  const sections: PdfSection[] = [
    { heading: 'Summary', columns: ['Measure', 'Value'], rows: summaryRows, columnStyles: { 1: { halign: 'right' } } },
    {
      heading: 'By day',
      columns: ['Day', 'Date', 'Invoices', 'Total'],
      rows: report.days.map((d) => [d.label, d.date, d.invoiceCount, money(d.total)]),
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
    },
    {
      heading: 'Sales',
      columns: ['Invoice ref', 'Date', 'Product sold', 'Qty', 'Amount'],
      rows: lineRows.length > 0 ? lineRows : [['', '', 'No sales recorded this week', '', '']],
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
    },
  ];

  if (report.returns.length > 0) {
    sections.push({
      heading: 'Returns made this week',
      columns: ['Return', 'Date', 'Invoice ref', 'Amount'],
      rows: report.returns.map((r) => [r.returnNumber, whenOf(r.returnDate), r.invoiceNumber, `(${money(r.amount)})`]),
      columnStyles: { 3: { halign: 'right' } },
    });
  }
  return sections;
}
