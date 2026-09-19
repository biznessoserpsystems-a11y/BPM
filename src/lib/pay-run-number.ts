import { db } from '@/lib/db';

/** Generates the next sequential pay run number for the current calendar year, e.g. "PR-2026-000003". */
export async function generatePayRunNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await db.payRun.count({
    where: { runNumber: { startsWith: `PR-${year}-` } },
  });
  return `PR-${year}-${String(count + 1).padStart(6, '0')}`;
}
