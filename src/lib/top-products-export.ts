import type { PdfSection } from '@/lib/pdf-export';
import { csvCell } from '@/lib/weekly-sales-export';
import type { RankedProduct } from '@/lib/product-ranking';

export interface TopProductsReport {
  from: string;
  to: string;
  rankBy: 'quantity' | 'revenue';
  rows: RankedProduct[];
  totalProducts: number;
  totalQuantity: number;
  totalRevenue: number;
}

type FormatAmount = (n: number) => string;

export function topProductsToCsv(report: TopProductsReport): string {
  const header = ['Rank', 'Product', 'Generic name', 'SKU', 'Quantity sold', 'Revenue', 'Invoices', 'Share %'];
  const rows = report.rows.map((r) => [r.rank, r.productName, r.genericName, r.sku, r.quantitySold, r.revenue, r.invoiceCount, r.sharePercent]);
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function topProductsFileName(report: Pick<TopProductsReport, 'from' | 'to'>, ext: 'csv' | 'pdf') {
  return `top-products-${report.from}-to-${report.to}.${ext}`;
}

export function topProductsToPdfSections(report: TopProductsReport, money: FormatAmount): PdfSection[] {
  return [
    {
      heading: `Ranked by ${report.rankBy === 'quantity' ? 'quantity sold' : 'revenue'}`,
      columns: ['#', 'Product', 'Qty sold', 'Revenue', 'Invoices', 'Share'],
      rows: report.rows.length
        ? report.rows.map((r) => [String(r.rank), r.productName, String(r.quantitySold), money(r.revenue), String(r.invoiceCount), `${r.sharePercent}%`])
        : [['', 'No sales in this period', '', '', '', '']],
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    },
  ];
}
