import { describe, it, expect } from 'vitest';
import { PAYMENT_METHODS, computeTotals, decideEdit, isSameLocalDay, validateLine } from '../src/lib/sale-edit';
import { buildSaleLines, reverseLines } from '../src/lib/sale-journal';

describe('line and total rules', () => {
  it('accepts whole quantities and non-negative prices only', () => {
    expect(validateLine({ quantity: 3, unitPrice: 2.5 }, 0)).toEqual({ quantity: 3, unitPrice: 2.5 });
    expect(() => validateLine({ quantity: 0, unitPrice: 1 }, 0)).toThrow(/return/);
    expect(() => validateLine({ quantity: 1.5, unitPrice: 1 }, 0)).toThrow();
    expect(() => validateLine({ quantity: 1, unitPrice: -1 }, 0)).toThrow();
    expect(() => validateLine({ quantity: '2', unitPrice: 1 }, 0)).toThrow();
  });
  it('a line cannot drop below what was already returned', () => {
    expect(() => validateLine({ quantity: 2, unitPrice: 1 }, 3)).toThrow(/already been returned/);
    expect(validateLine({ quantity: 3, unitPrice: 1 }, 3).quantity).toBe(3);
  });
  it('total = subtotal - discount + tax, and cannot go negative', () => {
    expect(computeTotals([{ quantity: 2, unitPrice: 10 }, { quantity: 1, unitPrice: 5 }], 3, 1.5)).toEqual({ subtotalAmount: 25, totalAmount: 23.5 });
    expect(() => computeTotals([{ quantity: 1, unitPrice: 5 }], 6, 0)).toThrow(/cannot exceed/);
    expect(() => computeTotals([{ quantity: 1, unitPrice: 5 }], -1, 0)).toThrow();
  });
  it('knows the payment methods the till offers', () => {
    expect([...PAYMENT_METHODS]).toEqual(['CASH', 'CARD', 'MOBILE_MONEY', 'INSURANCE']);
  });
});

describe('who may edit which sale', () => {
  const now = new Date(2026, 10, 28, 14, 0);
  const today = new Date(2026, 10, 28, 9, 0);
  const earlier = new Date(2026, 10, 27, 17, 0);
  const grants = (...keys: string[]) => (k: string) => keys.includes(k);

  it("a cashier can edit their own sale from today, not someone else's", () => {
    const has = grants('sales.edit_today');
    expect(decideEdit({ roleName: 'EMPLOYEE', userId: 5, sale: { userId: 5, saleDate: today }, now, has }).ok).toBe(true);
    const other = decideEdit({ roleName: 'EMPLOYEE', userId: 5, sale: { userId: 6, saleDate: today }, now, has });
    expect(other.ok).toBe(false);
  });
  it('a manager can edit anyone\'s sale from today', () => {
    expect(decideEdit({ roleName: 'MANAGER', userId: 2, sale: { userId: 6, saleDate: today }, now, has: grants('sales.edit_today') }).ok).toBe(true);
  });
  it('an earlier day needs the separate permission, even for the person who made the sale', () => {
    expect(decideEdit({ roleName: 'EMPLOYEE', userId: 5, sale: { userId: 5, saleDate: earlier }, now, has: grants('sales.edit_today') }).ok).toBe(false);
    expect(decideEdit({ roleName: 'EMPLOYEE', userId: 5, sale: { userId: 5, saleDate: earlier }, now, has: grants('sales.edit_past') }).ok).toBe(true);
  });
  it('without the today permission nothing is editable', () => {
    expect(decideEdit({ roleName: 'MANAGER', userId: 2, sale: { userId: 2, saleDate: today }, now, has: grants() }).ok).toBe(false);
  });
  it('same-day uses local calendar days', () => {
    expect(isSameLocalDay(new Date(2026, 10, 28, 0, 1), new Date(2026, 10, 28, 23, 59))).toBe(true);
    expect(isSameLocalDay(new Date(2026, 10, 27, 23, 59), new Date(2026, 10, 28, 0, 1))).toBe(false);
  });
});

describe('journal lines for a sale', () => {
  const accounts = { payment: 1, revenue: 2, tax: 3, cogs: 4, inventory: 5 };
  const sum = (lines: { debit: number; credit: number }[]) => [lines.reduce((n, l) => n + l.debit, 0), lines.reduce((n, l) => n + l.credit, 0)];

  it('balances: cash in, revenue net of discount, tax, and cost out of inventory', () => {
    const lines = buildSaleLines({ invoiceNumber: 'INV-1', accounts, subtotalAmount: 100, discountAmount: 10, taxAmount: 5, totalAmount: 95, costOfGoodsSold: 40 });
    const [debit, credit] = sum(lines);
    expect(debit).toBe(credit);
    expect(lines.find((l) => l.accountId === 2)!.credit).toBe(90);
    expect(lines.find((l) => l.accountId === 3)!.credit).toBe(5);
  });
  it('folds tax into revenue when no tax account is mapped, still balanced', () => {
    const lines = buildSaleLines({ invoiceNumber: 'INV-1', accounts: { ...accounts, tax: undefined }, subtotalAmount: 100, discountAmount: 0, taxAmount: 5, totalAmount: 105, costOfGoodsSold: 0 });
    const [debit, credit] = sum(lines);
    expect(debit).toBe(credit);
  });
  it('a reversal nets the original to zero on every account', () => {
    const original = buildSaleLines({ invoiceNumber: 'INV-1', accounts, subtotalAmount: 100, discountAmount: 0, taxAmount: 0, totalAmount: 100, costOfGoodsSold: 40 });
    const all = [...original, ...reverseLines(original, 'Reversal')];
    for (const id of [1, 2, 4, 5]) {
      const rows = all.filter((l) => l.accountId === id);
      expect(rows.reduce((n, l) => n + l.debit - l.credit, 0)).toBe(0);
    }
  });
});
