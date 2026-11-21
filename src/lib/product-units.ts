import type { db } from '@/lib/db';
import { PharmacyServiceError } from '@/lib/errors';

// How a product is counted and packed — see the ProductUnit model in
// prisma/schema.prisma. In short: stock is always held in the product's BASE
// unit; packaging units ("box", "pack") are just conversions into it, applied
// when receiving.

export const DEFAULT_BASE_UNIT = 'piece';
export const MAX_UNIT_NAME_LENGTH = 30;
export const MAX_PACKS_PER_PRODUCT = 10;
// Keeps a typo (an extra zero or two) from producing an absurd conversion.
export const MAX_UNITS_PER = 1_000_000;
// ProductBatch quantities are 32-bit integers.
const MAX_BASE_QUANTITY = 2_000_000_000;

type Client = typeof db | Parameters<Parameters<typeof db.$transaction>[0]>[0];

export interface PackUnit {
  name: string;
  unitsPer: number;
}

export interface UnitSetup {
  baseUnit: string;
  packs: PackUnit[];
}

// ---------------------------------------------------------------------------
// Pure helpers (no database) — the part worth testing exhaustively.
// ---------------------------------------------------------------------------

/** Trim, collapse inner whitespace, lower-case, and check it's a sensible name. */
export function normalizeUnitName(raw: unknown): string {
  if (typeof raw !== 'string') throw new PharmacyServiceError('A unit name is required');
  const name = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!name) throw new PharmacyServiceError('A unit name is required');
  if (name.length > MAX_UNIT_NAME_LENGTH) {
    throw new PharmacyServiceError(`Unit names can be at most ${MAX_UNIT_NAME_LENGTH} characters`);
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .\-/]*$/u.test(name)) {
    throw new PharmacyServiceError(
      `"${name}" isn't a valid unit name — use letters, numbers, spaces, and . - / only (e.g. box, pack, strip)`
    );
  }
  return name;
}

function normalizeUnitsPer(raw: unknown, name: string): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 2) {
    throw new PharmacyServiceError(
      `1 ${name} must contain a whole number of pieces, and at least 2 (otherwise it's the same as the base unit)`
    );
  }
  if (n > MAX_UNITS_PER) {
    throw new PharmacyServiceError(`1 ${name} can't contain more than ${MAX_UNITS_PER.toLocaleString()}`);
  }
  return n;
}

/**
 * Validate a full unit setup submitted from Settings: a base unit name plus
 * zero or more packaging units. Returns it normalised, or throws a
 * PharmacyServiceError whose message is fit to show the person directly.
 */
export function validateUnitSetup(input: { baseUnit?: unknown; packs?: unknown }): UnitSetup {
  const baseUnit =
    input.baseUnit === undefined || input.baseUnit === null || input.baseUnit === ''
      ? DEFAULT_BASE_UNIT
      : normalizeUnitName(input.baseUnit);

  const rawPacks = input.packs ?? [];
  if (!Array.isArray(rawPacks)) throw new PharmacyServiceError('packs must be a list');
  if (rawPacks.length > MAX_PACKS_PER_PRODUCT) {
    throw new PharmacyServiceError(`A product can have at most ${MAX_PACKS_PER_PRODUCT} packaging units`);
  }

  const seen = new Set<string>([baseUnit]);
  const packs: PackUnit[] = [];
  for (const raw of rawPacks) {
    const name = normalizeUnitName(raw?.name);
    if (seen.has(name)) {
      throw new PharmacyServiceError(
        name === baseUnit
          ? `"${name}" is already this product's base unit — a packaging unit needs a different name`
          : `"${name}" is listed more than once`
      );
    }
    seen.add(name);
    packs.push({ name, unitsPer: normalizeUnitsPer(raw?.unitsPer, name) });
  }
  packs.sort((a, b) => a.unitsPer - b.unitsPer || a.name.localeCompare(b.name));
  return { baseUnit, packs };
}

/** Whole base units received: 5 boxes of 10 -> 50. Quantity must be a positive whole number. */
export function toBaseQuantity(quantity: unknown, unitsPer: number): number {
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
    throw new PharmacyServiceError('Quantity must be a whole number greater than zero');
  }
  const base = quantity * unitsPer;
  if (!Number.isSafeInteger(base) || base > MAX_BASE_QUANTITY) {
    throw new PharmacyServiceError('That quantity is too large');
  }
  return base;
}

/** Cost per BASE unit from a price quoted per receiving unit: 100 per box of 10 -> 10 each. */
export function costPerBaseUnit(pricePerReceivingUnit: number, unitsPer: number): number {
  if (!Number.isFinite(pricePerReceivingUnit) || pricePerReceivingUnit < 0) {
    throw new PharmacyServiceError('Purchase price must be zero or more');
  }
  return pricePerReceivingUnit / unitsPer;
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

/** A product's setup; a product with nothing stored is "piece" with no packaging. */
export async function loadUnitSetup(client: Client, productId: number): Promise<UnitSetup> {
  const rows = await client.productUnit.findMany({
    where: { productId },
    orderBy: [{ unitsPer: 'asc' }, { name: 'asc' }],
  });
  const base = rows.find((r) => r.isBase);
  return {
    baseUnit: base?.name ?? DEFAULT_BASE_UNIT,
    packs: rows.filter((r) => !r.isBase).map((r) => ({ name: r.name, unitsPer: r.unitsPer })),
  };
}

/**
 * Replace a product's whole setup. Rows are only stored when they carry
 * information: a default base unit with no packaging stores nothing, so
 * products nobody has configured stay exactly as they always were.
 */
export async function saveUnitSetup(client: Client, productId: number, setup: UnitSetup): Promise<void> {
  await client.productUnit.deleteMany({ where: { productId } });
  if (setup.baseUnit === DEFAULT_BASE_UNIT && setup.packs.length === 0) return;
  await client.productUnit.create({
    data: { productId, name: setup.baseUnit, unitsPer: 1, isBase: true },
  });
  for (const pack of setup.packs) {
    await client.productUnit.create({
      data: { productId, name: pack.name, unitsPer: pack.unitsPer, isBase: false },
    });
  }
}

export interface ReceivingUnit {
  /** Name of the unit the quantity was entered in. */
  unit: string;
  /** How many base units are in one of it (1 for the base unit itself). */
  unitsPer: number;
  baseUnit: string;
}

/**
 * Work out which unit a quantity is being entered in, and how many base units
 * that is. `unit` empty/absent (or equal to the base unit) means the base unit.
 *
 * `define` lets whoever is receiving stock set up a NEW packaging unit right
 * there on the form (1 box = 10 pieces), saved on the product for next time.
 * When it's present it decides the unit (any `unit` alongside it is ignored).
 * It can only ADD a unit: if the name already exists with a different size,
 * that's refused rather than silently changed — altering an existing
 * conversion is an Admin/Manager job in Settings -> Units of Measure.
 */
export async function resolveReceivingUnit(
  client: Client,
  productId: number,
  input: { unit?: unknown; define?: { name?: unknown; unitsPer?: unknown; baseUnit?: unknown } | null }
): Promise<ReceivingUnit> {
  const setup = await loadUnitSetup(client, productId);
  const wanted = input.unit ? normalizeUnitName(input.unit) : setup.baseUnit;

  if (input.define) {
    const name = normalizeUnitName(input.define.name);
    const existing = setup.packs.find((p) => p.name === name);
    const hasExplicitBase =
      (await client.productUnit.count({ where: { productId, isBase: true } })) > 0;

    if (input.define.baseUnit && hasExplicitBase && normalizeUnitName(input.define.baseUnit) !== setup.baseUnit) {
      throw new PharmacyServiceError(
        `This product is counted in "${setup.baseUnit}". To change that, use Settings → Units of Measure.`
      );
    }
    const baseUnit = hasExplicitBase
      ? setup.baseUnit
      : input.define.baseUnit
        ? normalizeUnitName(input.define.baseUnit)
        : setup.baseUnit;
    const unitsPer = normalizeUnitsPer(input.define.unitsPer, name);

    if (name === baseUnit) {
      throw new PharmacyServiceError(`"${name}" is already this product's base unit — pick a different name`);
    }
    if (existing) {
      if (existing.unitsPer !== unitsPer) {
        throw new PharmacyServiceError(
          `1 ${name} is already set up as ${existing.unitsPer} ${setup.baseUnit}. ` +
            `An Admin or Manager can change it in Settings → Units of Measure.`
        );
      }
    } else {
      if (setup.packs.length >= MAX_PACKS_PER_PRODUCT) {
        throw new PharmacyServiceError(`A product can have at most ${MAX_PACKS_PER_PRODUCT} packaging units`);
      }
      if (!hasExplicitBase) {
        await client.productUnit.create({ data: { productId, name: baseUnit, unitsPer: 1, isBase: true } });
      }
      await client.productUnit.create({ data: { productId, name, unitsPer, isBase: false } });
    }
    return { unit: name, unitsPer, baseUnit };
  }

  if (wanted === setup.baseUnit) return { unit: setup.baseUnit, unitsPer: 1, baseUnit: setup.baseUnit };
  const pack = setup.packs.find((p) => p.name === wanted);
  if (!pack) {
    throw new PharmacyServiceError(
      `"${wanted}" isn't set up for this product. Set it up on the form (1 ${wanted} = how many ${setup.baseUnit}?) ` +
        `or in Settings → Units of Measure.`
    );
  }
  return { unit: pack.name, unitsPer: pack.unitsPer, baseUnit: setup.baseUnit };
}
