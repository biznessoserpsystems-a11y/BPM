import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface DocWithAutoTable extends jsPDF {
  lastAutoTable?: { finalY: number };
}

export interface PdfSection {
  heading?: string;
  columns: string[];
  rows: (string | number)[][];
  columnStyles?: Record<number, { halign?: 'left' | 'right' | 'center' }>;
}

export interface PdfExportOptions {
  title: string;
  subtitle?: string;
  companyName?: string;
  sections: PdfSection[];
}

const PAGE_BOTTOM_MARGIN = 275; // A4 is 297mm tall; leaves room before a new page is needed

/**
 * Renders one or more tables into a downloadable PDF — real, selectable
 * vector tables via jspdf-autotable, not a screenshot of the page. Used
 * by every report in Reports → (Income Statement, Balance Sheet, Cash
 * Flow, Trial Balance, AP Aging, AR Aging) so each report only needs to
 * map its own data into simple {columns, rows} sections, not repeat any
 * PDF layout code.
 */
export function exportReportToPdf({ title, subtitle, companyName, sections }: PdfExportOptions): void {
  const doc = new jsPDF() as DocWithAutoTable;
  let y = 15;

  if (companyName) {
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text(companyName, 14, y);
    y += 7;
  }

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, y);
  y += 7;

  if (subtitle) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(subtitle, 14, y);
    doc.setTextColor(0);
    y += 6;
  }

  doc.setFontSize(8);
  doc.setTextColor(140);
  doc.text(`Generated ${new Date().toLocaleString()}`, 14, y);
  doc.setTextColor(0);
  y += 8;

  for (const section of sections) {
    if (y > PAGE_BOTTOM_MARGIN) {
      doc.addPage();
      y = 15;
    }
    if (section.heading) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(section.heading, 14, y + 4);
      y += 8;
    }

    autoTable(doc, {
      startY: y,
      head: [section.columns],
      body: section.rows.map((row) => row.map((cell) => (typeof cell === 'number' ? cell.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : cell))),
      styles: { fontSize: 9, cellPadding: 2.5 },
      headStyles: { fillColor: [22, 74, 58], textColor: 255 }, // matches the app's brand-700 green
      columnStyles: section.columnStyles,
      margin: { left: 14, right: 14 },
    });

    y = (doc.lastAutoTable?.finalY ?? y) + 10;
  }

  const filename = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
