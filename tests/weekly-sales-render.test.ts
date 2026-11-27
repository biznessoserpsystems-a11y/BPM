import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WeeklySalesSection } from '../src/components/views/weekly-sales-section';
import type { WeeklySalesReport } from '../src/lib/weekly-sales-export';

// Renders the real Weekly Sales screen with realistic data and checks the
// text a person would actually read. (Server-side render: no browser, no
// network — queries are pre-filled, and the clock is pinned so "this week"
// is Monday 16 – Sunday 22 November 2026.)

vi.mock('../src/lib/pdf-export', () => ({ exportReportToPdf: vi.fn() }));

// The real store is a client-side (zustand) store; during a server render it
// only ever reports its initial state, so it can't be primed from a test.
// Standing in a plain object lets each test choose who is signed in.
const signedIn = vi.hoisted(() => ({ user: null as { id: number; roleName: string; homeBranchId: string } | null }));
vi.mock('../src/lib/store', () => ({ usePharmacyStore: () => ({ user: signedIn.user }) }));

const iso = (day: number, h: number, min: number) => new Date(2026, 10, day, h, min).toISOString();
const item = (productName: string, quantity: number, unitPrice: number, returnedQuantity = 0) => ({
  productName, genericName: 'generic name', sku: 'SKU', quantity, unitPrice, amount: quantity * unitPrice, returnedQuantity,
});

function baseReport(over: Partial<WeeklySalesReport> = {}): WeeklySalesReport {
  return {
    weekStart: '2026-11-16',
    weekEnd: '2026-11-22',
    branchId: null,
    summary: { invoiceCount: 2, itemsSold: 6, grossSales: 37, discounts: 2, tax: 1.1, totalSales: 36.1, returnsTotal: 0, netSales: 36.1 },
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, i) => ({
      date: `2026-11-${16 + i}`, label, invoiceCount: label === 'Wed' || label === 'Fri' ? 1 : 0,
      total: label === 'Wed' ? 21.1 : label === 'Fri' ? 15 : 0,
    })),
    invoices: [
      {
        id: 'a', invoiceNumber: 'INV-0001', saleDate: iso(18, 9, 30), branchId: 'BR-1', customerName: null, cashier: 'Ama Mensah', paymentMethod: 'MOBILE_MONEY',
        subtotalAmount: 22, discountAmount: 2, taxAmount: 1.1, totalAmount: 21.1,
        items: [item('Paracetamol 500mg', 2, 5), item('Amoxicillin 250mg', 1, 12, 1)],
      },
      {
        id: 'b', invoiceNumber: 'INV-0002', saleDate: iso(20, 16, 45), branchId: 'BR-1', customerName: null, cashier: 'Ama Mensah', paymentMethod: 'CASH',
        subtotalAmount: 15, discountAmount: 0, taxAmount: 0, totalAmount: 15,
        items: [item('Ibuprofen 400mg', 3, 5)],
      },
    ],
    returns: [],
    ...over,
  };
}

function screen(role: 'ADMIN' | 'EMPLOYEE', report: WeeklySalesReport): string {
  signedIn.user = { id: 1, roleName: role, homeBranchId: 'BR-1' };
  const client = new QueryClient();
  client.setQueryData(['weekly-sales', '2026-11-16', role === 'ADMIN' ? '__all__' : 'own'], report);
  client.setQueryData(['currencies'], [{ id: 1, code: 'GHS', name: 'Cedi', symbol: 'GH₵', decimalPlaces: 2, isBaseCurrency: true }]);
  client.setQueryData(['my-company'], { id: 'c', name: 'CharlieBliss Pharmacy', code: 'cb' });
  client.setQueryData(['branches', 'all'], [{ id: 'BR-1', name: 'Main Branch', isActive: true }]);
  const html = renderToString(createElement(QueryClientProvider, { client }, createElement(WeeklySalesSection)));
  // what a reader sees: markup and React's text-joining comments removed, spaces collapsed
  return html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}

describe('Weekly Sales screen', () => {
  beforeAll(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 18, 10, 0) }));
  afterAll(() => vi.useRealTimers());

  it('names the week being shown', () => {
    expect(screen('ADMIN', baseReport())).toContain('Mon 16 Nov – Sun 22 Nov 2026');
  });

  it('shows the invoice ref, the products sold, quantities and amounts', () => {
    const text = screen('ADMIN', baseReport());
    for (const expected of ['Invoice ref', 'Product sold', 'Amount', 'INV-0001', 'INV-0002', 'Paracetamol 500mg', 'Amoxicillin 250mg', 'Ibuprofen 400mg']) {
      expect(text).toContain(expected);
    }
    expect(text).toContain('GH₵10.00'); // 2 x 5
    expect(text).toContain('GH₵12.00');
    expect(text).toContain('GH₵15.00');
  });

  it('puts each invoice ref on the screen once, not once per product line', () => {
    const text = screen('ADMIN', baseReport());
    expect(text.split('INV-0001').length - 1).toBe(1);
    expect(text.split('INV-0002').length - 1).toBe(1);
  });

  it('shows each invoice total with its discount and tax, and the week total', () => {
    const text = screen('ADMIN', baseReport());
    expect(text).toContain('Discount −GH₵2.00');
    expect(text).toContain('Tax +GH₵1.10');
    expect(text).toContain('GH₵21.10'); // INV-0001 total
    expect(text).toContain('Week total');
    expect(text).toContain('GH₵36.10');
  });

  it('shows the headline numbers and the day-by-day strip', () => {
    const text = screen('ADMIN', baseReport());
    expect(text).toMatch(/Invoices 2/);
    expect(text).toMatch(/Items sold 6/);
    for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) expect(text).toContain(d);
    expect(text).toContain('1 invoice ');
    expect(text).toContain('0 invoices');
  });

  it('flags a line that was partly returned', () => {
    expect(screen('ADMIN', baseReport())).toContain('1 returned');
  });

  it('shows returns and net sales when there were returns', () => {
    const text = screen(
      'ADMIN',
      baseReport({
        summary: { ...baseReport().summary, returnsTotal: 12, netSales: 24.1 },
        returns: [{ returnNumber: 'RT-0001', returnDate: iso(19, 11, 0), invoiceNumber: 'INV-0001', reason: 'Wrong item', amount: 12 }],
      })
    );
    expect(text).toContain('Net of returns');
    expect(text).toContain('GH₵24.10');
    expect(text).toContain('Returns made this week');
    expect(text).toContain('RT-0001');
    expect(text).toContain('Wrong item');
  });

  it('says plainly when nothing was sold, instead of showing an empty table', () => {
    const text = screen('ADMIN', baseReport({ invoices: [], summary: { ...baseReport().summary, invoiceCount: 0, itemsSold: 0, totalSales: 0, netSales: 0, grossSales: 0, discounts: 0, tax: 0 } }));
    expect(text).toContain('No sales were recorded this week');
    expect(text).not.toContain('Week total');
  });

  it('lets an Admin choose a branch, but not an Employee (who only ever sees their own)', () => {
    expect(screen('ADMIN', baseReport())).toContain('Branch');
    expect(screen('EMPLOYEE', baseReport())).not.toContain('Branch');
  });

  it('offers CSV and PDF downloads', () => {
    const text = screen('ADMIN', baseReport());
    expect(text).toContain('CSV');
    expect(text).toContain('PDF');
  });

  it("can't step into a future week from the current one", () => {
    const html = (() => {
      signedIn.user = { id: 1, roleName: 'ADMIN', homeBranchId: 'BR-1' };
      const client = new QueryClient();
      client.setQueryData(['weekly-sales', '2026-11-16', '__all__'], baseReport());
      client.setQueryData(['currencies'], []);
      return renderToString(createElement(QueryClientProvider, { client }, createElement(WeeklySalesSection)));
    })();
    // the "Next week" button is rendered disabled while viewing the current week
    expect(html).toMatch(/aria-label="Next week"[^>]*disabled|disabled=""[^>]*aria-label="Next week"/);
    expect(html).not.toMatch(/aria-label="Previous week"[^>]*disabled/);
  });
});
