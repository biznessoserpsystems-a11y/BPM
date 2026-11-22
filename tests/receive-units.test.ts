import { describe, it, expect } from 'vitest';
import { deriveReceiveUnit, previewReceive, EMPTY_UNIT_FORM, describePack, type UnitSetup } from '../src/lib/receive-units';

const none: UnitSetup = { baseUnit: 'piece', packs: [] };
const boxes: UnitSetup = { baseUnit: 'piece', packs: [{ name: 'box', unitsPer: 10 }, { name: 'carton', unitsPer: 100 }] };
const strips: UnitSetup = { baseUnit: 'strip', packs: [{ name: 'pack', unitsPer: 10 }] };
const form = (over: Partial<typeof EMPTY_UNIT_FORM>) => ({ ...EMPTY_UNIT_FORM, ...over });

describe('which unit is the form using', () => {
  it('defaults to the base unit, with or without a loaded setup', () => {
    expect(deriveReceiveUnit(undefined, EMPTY_UNIT_FORM)).toMatchObject({ unitName: 'piece', unitsPer: 1, isConverted: false, define: null });
    expect(deriveReceiveUnit(strips, EMPTY_UNIT_FORM)).toMatchObject({ unitName: 'strip', baseUnit: 'strip', unitsPer: 1, isConverted: false });
  });
  it('picks an existing packaging unit', () => {
    expect(deriveReceiveUnit(boxes, form({ selected: 'carton' }))).toMatchObject({ unitName: 'carton', unitsPer: 100, isConverted: true, define: null });
  });
  it('falls back to the base unit if the chosen unit no longer exists (e.g. product changed)', () => {
    expect(deriveReceiveUnit(none, form({ selected: 'box' }))).toMatchObject({ unitName: 'piece', unitsPer: 1, isConverted: false });
  });
});

describe('setting up a new unit on the form', () => {
  it('1 box = 10 piece sends a define that lets the product pick its base name', () => {
    const d = deriveReceiveUnit(none, form({ creating: true, newName: ' Box ', newUnitsPer: '10' }));
    expect(d).toMatchObject({ unitName: 'box', unitsPer: 10, baseUnit: 'piece', problem: null, baseEditable: true });
    expect(d.define).toEqual({ name: 'box', unitsPer: 10, baseUnit: 'piece' });
  });
  it('"1 pac = 10 strips": a custom base name for a product with no setup', () => {
    const d = deriveReceiveUnit(none, form({ creating: true, newName: 'pac', newUnitsPer: '10', newBase: 'Strip' }));
    expect(d.define).toEqual({ name: 'pac', unitsPer: 10, baseUnit: 'strip' });
    expect(d.baseUnit).toBe('strip');
  });
  it('the base name is fixed once the product has packaging or a custom base', () => {
    for (const setup of [boxes, strips]) {
      const d = deriveReceiveUnit(setup, form({ creating: true, newName: 'bag', newUnitsPer: '5', newBase: 'ignored' }));
      expect(d.baseEditable).toBe(false);
      expect(d.baseUnit).toBe(setup.baseUnit);
      expect(d.define).toEqual({ name: 'bag', unitsPer: 5 });
    }
  });
  it.each([
    [{ newName: '', newUnitsPer: '10' }, /name for the new unit/],
    [{ newName: 'piece', newUnitsPer: '10' }, /already the base unit/],
    [{ newName: 'box', newUnitsPer: '' }, /whole number, at least 2/],
    [{ newName: 'box', newUnitsPer: '1' }, /at least 2/],
    [{ newName: 'box', newUnitsPer: '2.5' }, /whole number/],
  ])('explains what is missing: %j', (fields, message) => {
    const d = deriveReceiveUnit(none, form({ creating: true, ...fields }));
    expect(d.problem).toMatch(message);
    expect(d.define).toBeNull();
  });
  it('points to the list when the unit already exists', () => {
    expect(deriveReceiveUnit(boxes, form({ creating: true, newName: 'Box', newUnitsPer: '12' })).problem).toMatch(/already set up/);
  });
});

describe('the preview line', () => {
  const box = deriveReceiveUnit(boxes, form({ selected: 'box' }));
  it('5 boxes of 10 is 50 pieces, and a price of 100 per box is 10 each', () => {
    expect(previewReceive(box, '5', '100')).toEqual({ baseQuantity: 50, costPerBase: 10 });
  });
  it('shows nothing for a quantity that is not a positive whole number', () => {
    for (const q of ['', '0', '-2', '1.5', 'abc']) expect(previewReceive(box, q, '').baseQuantity).toBeNull();
  });
  it('shows nothing for a blank or negative price', () => {
    expect(previewReceive(box, '5', '').costPerBase).toBeNull();
    expect(previewReceive(box, '5', '-1').costPerBase).toBeNull();
    expect(previewReceive(box, '5', '0').costPerBase).toBe(0);
  });
  it('is 1:1 in the base unit', () => {
    expect(previewReceive(deriveReceiveUnit(none, EMPTY_UNIT_FORM), '7', '3')).toEqual({ baseQuantity: 7, costPerBase: 3 });
  });
});

it('describes a pack the way people say it', () => {
  expect(describePack({ name: 'pac', unitsPer: 10 }, 'strips')).toBe('1 pac = 10 strips');
});
