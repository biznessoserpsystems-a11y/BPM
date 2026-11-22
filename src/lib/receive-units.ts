// What the Receive Goods form needs to know about the unit being used, worked
// out from the product's saved setup plus what the person has chosen/typed.
// Pure (no React, no network) so the behaviour can be tested directly. The
// server re-does all of this authoritatively (src/lib/product-units.ts) —
// this is only what the form shows and sends.

export const DEFAULT_BASE_UNIT = 'piece';
/** Suggestions only — any unit name can be typed. */
export const COMMON_UNITS = [
  'piece', 'tablet', 'capsule', 'strip', 'blister', 'sachet', 'tube', 'bottle', 'vial', 'ampoule',
  'pack', 'box', 'carton', 'bag', 'roll',
];

export interface UnitSetup {
  baseUnit: string;
  packs: { name: string; unitsPer: number }[];
}

export interface UnitFormState {
  /** Chosen existing unit; '' means the base unit. */
  selected: string;
  /** Setting up a brand-new packaging unit right on the form. */
  creating: boolean;
  newName: string;
  newUnitsPer: string;
  /** Only used while the product has no setup yet and is still counted in "piece". */
  newBase: string;
}

export const EMPTY_UNIT_FORM: UnitFormState = { selected: '', creating: false, newName: '', newUnitsPer: '', newBase: '' };

export interface DerivedUnit {
  /** The unit the quantity (and purchase price) are entered in. */
  unitName: string;
  baseUnit: string;
  /** Base units in one of `unitName` (1 for the base unit itself). */
  unitsPer: number;
  /** Present only when a new unit is being set up; sent to the server as `defineUnit`. */
  define: { name: string; unitsPer: number; baseUnit?: string } | null;
  /** True when the quantity needs converting to the base unit. */
  isConverted: boolean;
  /** Why the current choice can't be submitted (new-unit fields), else null. */
  problem: string | null;
  /** Whether the base unit's name can still be chosen (product has no setup yet). */
  baseEditable: boolean;
}

const clean = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function deriveReceiveUnit(setup: UnitSetup | undefined, st: UnitFormState): DerivedUnit {
  const savedBase = setup?.baseUnit ?? DEFAULT_BASE_UNIT;
  const baseEditable = (setup?.packs.length ?? 0) === 0 && savedBase === DEFAULT_BASE_UNIT;

  if (st.creating) {
    const baseUnit = baseEditable ? clean(st.newBase) || DEFAULT_BASE_UNIT : savedBase;
    const name = clean(st.newName);
    const unitsPer = Number(st.newUnitsPer);
    let problem: string | null = null;
    if (!name) problem = 'Enter a name for the new unit, e.g. box';
    else if (name === baseUnit) problem = `"${name}" is already the base unit — pick a different name`;
    else if (setup?.packs.some((p) => p.name === name)) problem = `"${name}" is already set up — choose it from the list`;
    else if (!Number.isInteger(unitsPer) || unitsPer < 2) problem = `How many ${baseUnit} are in 1 ${name}? A whole number, at least 2`;
    return {
      unitName: name || 'new unit',
      baseUnit,
      unitsPer: problem ? 1 : unitsPer,
      define: problem ? null : { name, unitsPer, ...(baseEditable ? { baseUnit } : {}) },
      isConverted: true,
      problem,
      baseEditable,
    };
  }

  const wanted = st.selected || savedBase;
  const pack = wanted === savedBase ? undefined : setup?.packs.find((p) => p.name === wanted);
  if (wanted === savedBase || !pack) {
    return { unitName: savedBase, baseUnit: savedBase, unitsPer: 1, define: null, isConverted: false, problem: null, baseEditable };
  }
  return { unitName: pack.name, baseUnit: savedBase, unitsPer: pack.unitsPer, define: null, isConverted: true, problem: null, baseEditable };
}

export interface ReceivePreview {
  /** Whole base units that will go into stock, or null while the quantity isn't a valid whole number. */
  baseQuantity: number | null;
  /** Cost per base unit derived from the price quoted per receiving unit, or null. */
  costPerBase: number | null;
}

export function previewReceive(unit: DerivedUnit, quantity: string, purchasePrice: string): ReceivePreview {
  const q = Number(quantity);
  const price = Number(purchasePrice);
  return {
    baseQuantity: quantity.trim() !== '' && Number.isInteger(q) && q > 0 ? q * unit.unitsPer : null,
    costPerBase: purchasePrice.trim() !== '' && Number.isFinite(price) && price >= 0 ? price / unit.unitsPer : null,
  };
}

/** Short label for a pack, e.g. "1 box = 10 pieces". */
export function describePack(pack: { name: string; unitsPer: number }, baseUnit: string): string {
  return `1 ${pack.name} = ${pack.unitsPer} ${baseUnit}`;
}
