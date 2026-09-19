import { db } from '@/lib/db';

/**
 * Generates the next sequential journal entry number for the current
 * calendar year, e.g. "JE-2026-000042". Was duplicated identically across
 * sales, journal-entries, purchase-order receipts, and stock-adjustments —
 * centralized here so every module that posts to the GL (now including
 * fixed assets, leases, revenue contracts, and inventory valuations) uses
 * the exact same numbering scheme.
 */
export async function generateEntryNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await db.journalEntry.count({
    where: { entryNumber: { startsWith: `JE-${year}-` } },
  });
  return `JE-${year}-${String(count + 1).padStart(6, '0')}`;
}
