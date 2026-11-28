import { describe, it, expect } from 'vitest';
import { resolveSaleDate } from '../src/lib/sale-date';
import { firstInventoryLineMissingProduct, inventoryAccountIds, parseEntryDate } from '../src/lib/journal-rules';

const now = new Date(2026, 10, 28, 14, 30);

describe('the date a sale is recorded for', () => {
  it('blank or today means now', () => {
    expect(resolveSaleDate(undefined, now)).toEqual({ date: now, isPast: false });
    expect(resolveSaleDate('', now)).toEqual({ date: now, isPast: false });
    expect(resolveSaleDate('2026-11-28', now)).toEqual({ date: now, isPast: false });
  });
  it('an earlier day is recorded at midday that day, so no timezone can shift it', () => {
    const r = resolveSaleDate('2026-11-23', now);
    expect(r.isPast).toBe(true);
    expect(r.date).toEqual(new Date(2026, 10, 23, 12, 0, 0));
  });
  it('refuses the future, impossible dates and nonsense', () => {
    expect(() => resolveSaleDate('2026-11-29', now)).toThrow(/future/);
    expect(() => resolveSaleDate('2026-02-30', now)).toThrow(/real date/);
    expect(() => resolveSaleDate('yesterday', now)).toThrow();
    expect(() => resolveSaleDate(20261123, now)).toThrow();
    expect(() => resolveSaleDate('1999-01-01', now)).toThrow();
  });
});

describe('inventory lines on a journal entry', () => {
  const ids = inventoryAccountIds([{ mappingKey: 'INVENTORY_ASSET', accountId: 12 }, { mappingKey: 'CASH', accountId: 1 }], [
    { id: 1, accountSubType: 'CURRENT_ASSET' }, { id: 12 }, { id: 40, accountSubType: 'INVENTORY' },
  ]);
  it('recognises the mapped inventory account and any INVENTORY sub-type account, and nothing else', () => {
    expect([...ids].sort((a, b) => a - b)).toEqual([12, 40]);
  });
  it('flags the first inventory line with no product', () => {
    expect(firstInventoryLineMissingProduct([{ accountId: 1 }, { accountId: 12 }], ids)).toBe(1);
    expect(firstInventoryLineMissingProduct([{ accountId: 12, productId: 5 }, { accountId: 40, productId: null }], ids)).toBe(1);
  });
  it('accepts inventory lines that name a product, and other lines without one', () => {
    expect(firstInventoryLineMissingProduct([{ accountId: 12, productId: 5 }, { accountId: 1 }], ids)).toBeNull();
  });
});

describe('journal entry date', () => {
  it('accepts a real past or present date and refuses nonsense', () => {
    expect(parseEntryDate('2026-11-23T12:00:00.000Z', now).getFullYear()).toBe(2026);
    expect(() => parseEntryDate('not a date', now)).toThrow();
    expect(() => parseEntryDate(undefined, now)).toThrow();
    expect(() => parseEntryDate('1990-01-01', now)).toThrow();
    expect(() => parseEntryDate('2030-01-01', now)).toThrow(/future/);
  });
});
