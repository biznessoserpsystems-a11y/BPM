// Rules for manual journal entries that don't need the database.

/**
 * Which accounts are INVENTORY accounts: the one the system posts stock to
 * (the INVENTORY_ASSET mapping) plus any account whose sub-type is INVENTORY.
 * A line on one of these must say WHICH product it is for, so the inventory
 * ledger can be broken down product by product.
 */
export function inventoryAccountIds(
  mappings: { mappingKey: string; accountId: number }[],
  accounts: { id: number; accountSubType?: string | null }[]
): Set<number> {
  const ids = new Set<number>();
  for (const m of mappings) if (m.mappingKey === 'INVENTORY_ASSET') ids.add(m.accountId);
  for (const a of accounts) if (a.accountSubType === 'INVENTORY') ids.add(a.id);
  return ids;
}

/** Entry date from the request: a real date, no earlier than 2000, not absurdly far ahead. */
export function parseEntryDate(value: unknown, now: Date = new Date()): Date {
  const d = typeof value === 'string' || value instanceof Date ? new Date(value as string) : new Date(NaN);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000) throw new Error('Enter a valid entry date');
  if (d.getTime() - now.getTime() > 366 * 24 * 3600 * 1000) throw new Error('The entry date is too far in the future');
  return d;
}

export interface LineCheckInput {
  accountId: number;
  productId?: number | null;
}

/** The first line that is on an inventory account but has no product chosen, or null. */
export function firstInventoryLineMissingProduct(lines: LineCheckInput[], inventoryIds: Set<number>): number | null {
  const idx = lines.findIndex((l) => inventoryIds.has(l.accountId) && !l.productId);
  return idx === -1 ? null : idx;
}
