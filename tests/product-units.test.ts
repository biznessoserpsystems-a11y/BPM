import { describe, it, expect } from 'vitest';
import {
  normalizeUnitName,
  validateUnitSetup,
  toBaseQuantity,
  costPerBaseUnit,
  loadUnitSetup,
  saveUnitSetup,
  resolveReceivingUnit,
} from '../src/lib/product-units';

// The rules behind "1 box = 10 pieces". The first half is pure maths; the
// second half runs the database helpers against a small in-memory stand-in
// for prisma.productUnit, so the logic is covered without needing a database
// (the real-database behaviour is covered by units-receiving.test.ts).

describe('unit names', () => {
  it('trims, lowercases and collapses spaces', () => {
    expect(normalizeUnitName('  Blister  Pack ')).toBe('blister pack');
  });
  it('rejects empty, junk and over-long names', () => {
    expect(() => normalizeUnitName('  ')).toThrow(/required/);
    expect(() => normalizeUnitName('b<o>x')).toThrow(/valid unit name/);
    expect(() => normalizeUnitName('x'.repeat(31))).toThrow(/at most 30/);
  });
});

describe('validating a unit setup', () => {
  it('defaults the base unit to piece and sorts packs by size', () => {
    expect(
      validateUnitSetup({ packs: [{ name: 'Carton', unitsPer: 100 }, { name: 'Box', unitsPer: '10' }] })
    ).toEqual({ baseUnit: 'piece', packs: [{ name: 'box', unitsPer: 10 }, { name: 'carton', unitsPer: 100 }] });
  });
  it('accepts "1 pac = 10 strips"', () => {
    expect(validateUnitSetup({ baseUnit: 'strip', packs: [{ name: 'pac', unitsPer: 10 }] })).toEqual({
      baseUnit: 'strip',
      packs: [{ name: 'pac', unitsPer: 10 }],
    });
  });
  it.each([1, 0, -5, 2.5, 'abc', null])('rejects a pack size of %s', (bad) => {
    expect(() => validateUnitSetup({ packs: [{ name: 'box', unitsPer: bad }] })).toThrow(/whole number/);
  });
  it('caps absurd sizes', () => {
    expect(() => validateUnitSetup({ packs: [{ name: 'box', unitsPer: 1_000_001 }] })).toThrow(/more than/);
  });
  it('rejects duplicate names, case-insensitively', () => {
    expect(() =>
      validateUnitSetup({ packs: [{ name: 'Box', unitsPer: 10 }, { name: 'box', unitsPer: 12 }] })
    ).toThrow(/more than once/);
  });
  it('rejects a pack named like the base unit', () => {
    expect(() => validateUnitSetup({ baseUnit: 'strip', packs: [{ name: 'Strip', unitsPer: 10 }] })).toThrow(
      /already this product's base unit/
    );
  });
  it('limits how many packs a product can have', () => {
    const packs = Array.from({ length: 11 }, (_, i) => ({ name: `u${i}`, unitsPer: 2 + i }));
    expect(() => validateUnitSetup({ packs })).toThrow(/at most 10/);
  });
});

describe('converting quantities and prices', () => {
  it('5 boxes of 10 is 50 pieces; the base unit is 1:1', () => {
    expect(toBaseQuantity(5, 10)).toBe(50);
    expect(toBaseQuantity(7, 1)).toBe(7);
  });
  it.each([0, -1, 1.5, '5', NaN, undefined])('rejects a quantity of %s', (bad) => {
    expect(() => toBaseQuantity(bad, 10)).toThrow(/whole number/);
  });
  it('rejects a total that would overflow a 32-bit count', () => {
    expect(() => toBaseQuantity(3_000_000, 1000)).toThrow(/too large/);
  });
  it('a price of 100 per box of 10 costs 10 each; zero is fine, negative is not', () => {
    expect(costPerBaseUnit(100, 10)).toBe(10);
    expect(costPerBaseUnit(0, 10)).toBe(0);
    expect(() => costPerBaseUnit(-1, 10)).toThrow(/zero or more/);
  });
});

// ---- in-memory stand-in for prisma.productUnit -----------------------------
type Row = { id: number; productId: number; name: string; unitsPer: number; isBase: boolean };
function fakeClient() {
  const rows: Row[] = [];
  let id = 1;
  const match = (r: Row, w: Partial<Row>) => Object.entries(w).every(([k, v]) => (r as never)[k] === v);
  const client = {
    rows,
    productUnit: {
      findMany: async ({ where }: { where: Partial<Row> }) =>
        rows.filter((r) => match(r, where)).sort((a, b) => a.unitsPer - b.unitsPer || a.name.localeCompare(b.name)),
      count: async ({ where }: { where: Partial<Row> }) => rows.filter((r) => match(r, where)).length,
      create: async ({ data }: { data: Omit<Row, 'id'> }) => {
        if (rows.some((r) => r.productId === data.productId && r.name === data.name)) throw new Error('unique violation');
        const r = { id: id++, ...data };
        rows.push(r);
        return r;
      },
      deleteMany: async ({ where }: { where: Partial<Row> }) => {
        for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], where)) rows.splice(i, 1);
      },
    },
  };
  return client;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asClient = (c: unknown) => c as any;

describe('resolving the unit a quantity is entered in', () => {
  it('an unconfigured product is counted in "piece", 1:1, and nothing is stored', async () => {
    const c = fakeClient();
    expect(await resolveReceivingUnit(asClient(c), 1, {})).toEqual({ unit: 'piece', unitsPer: 1, baseUnit: 'piece' });
    expect(c.rows).toHaveLength(0);
  });

  it('defining 1 box = 10 piece saves it (with an explicit base row)', async () => {
    const c = fakeClient();
    const r = await resolveReceivingUnit(asClient(c), 1, { define: { name: 'Box', unitsPer: 10 } });
    expect(r).toEqual({ unit: 'box', unitsPer: 10, baseUnit: 'piece' });
    expect(c.rows.map((x) => [x.name, x.unitsPer, x.isBase])).toEqual([
      ['piece', 1, true],
      ['box', 10, false],
    ]);
  });

  it('defining with a custom base: 1 pac = 10 strips', async () => {
    const c = fakeClient();
    const r = await resolveReceivingUnit(asClient(c), 1, { define: { name: 'pac', unitsPer: 10, baseUnit: 'strip' } });
    expect(r).toEqual({ unit: 'pac', unitsPer: 10, baseUnit: 'strip' });
  });

  it('a later receive by name uses the saved conversion', async () => {
    const c = fakeClient();
    await resolveReceivingUnit(asClient(c), 1, { define: { name: 'box', unitsPer: 10 } });
    expect(await resolveReceivingUnit(asClient(c), 1, { unit: 'BOX' })).toEqual({
      unit: 'box',
      unitsPer: 10,
      baseUnit: 'piece',
    });
  });

  it('receiving in the base unit by name is 1:1', async () => {
    const c = fakeClient();
    await resolveReceivingUnit(asClient(c), 1, { define: { name: 'box', unitsPer: 10, baseUnit: 'strip' } });
    expect((await resolveReceivingUnit(asClient(c), 1, { unit: 'strip' })).unitsPer).toBe(1);
  });

  it('an unknown unit is refused with guidance', async () => {
    await expect(resolveReceivingUnit(asClient(fakeClient()), 1, { unit: 'carton' })).rejects.toThrow(
      /isn't set up for this product/
    );
  });

  it('re-defining with the same size is fine and adds no duplicate row', async () => {
    const c = fakeClient();
    await resolveReceivingUnit(asClient(c), 1, { define: { name: 'box', unitsPer: 10 } });
    await resolveReceivingUnit(asClient(c), 1, { define: { name: 'box', unitsPer: 10 } });
    expect(c.rows.filter((r) => r.name === 'box')).toHaveLength(1);
  });

  it('re-defining with a different size is refused and nothing changes', async () => {
    const c = fakeClient();
    await resolveReceivingUnit(asClient(c), 1, { define: { name: 'box', unitsPer: 10 } });
    await expect(
      resolveReceivingUnit(asClient(c), 1, { define: { name: 'box', unitsPer: 12 } })
    ).rejects.toThrow(/already set up as 10 piece/);
    expect(c.rows.find((r) => r.name === 'box')!.unitsPer).toBe(10);
  });

  it('defining on the form cannot rename an existing base unit', async () => {
    const c = fakeClient();
    await saveUnitSetup(asClient(c), 1, { baseUnit: 'strip', packs: [] });
    await expect(
      resolveReceivingUnit(asClient(c), 1, { define: { name: 'box', unitsPer: 10, baseUnit: 'tablet' } })
    ).rejects.toThrow(/counted in "strip"/);
  });

  it('a new unit cannot reuse the base unit name', async () => {
    await expect(
      resolveReceivingUnit(asClient(fakeClient()), 1, { define: { name: 'piece', unitsPer: 10 } })
    ).rejects.toThrow(/already this product's base unit/);
  });

  it('products are independent of each other', async () => {
    const c = fakeClient();
    await resolveReceivingUnit(asClient(c), 1, { define: { name: 'box', unitsPer: 10 } });
    await expect(resolveReceivingUnit(asClient(c), 2, { unit: 'box' })).rejects.toThrow(/isn't set up/);
  });
});

describe('saving and loading a setup', () => {
  it('replaces the whole setup; the default with no packs stores nothing', async () => {
    const c = fakeClient();
    await saveUnitSetup(asClient(c), 1, { baseUnit: 'strip', packs: [{ name: 'pack', unitsPer: 10 }] });
    expect(c.rows).toHaveLength(2);
    await saveUnitSetup(asClient(c), 1, { baseUnit: 'piece', packs: [] });
    expect(c.rows).toHaveLength(0);
  });
  it('round-trips', async () => {
    const c = fakeClient();
    const setup = { baseUnit: 'strip', packs: [{ name: 'pack', unitsPer: 10 }, { name: 'carton', unitsPer: 100 }] };
    await saveUnitSetup(asClient(c), 1, setup);
    expect(await loadUnitSetup(asClient(c), 1)).toEqual(setup);
  });
});
