import type { Prisma, PrismaClient } from '@prisma/client';
import { PharmacyServiceError } from './errors';

type Tx = PrismaClient | Prisma.TransactionClient;

/**
 * Accounting periods are opt-in controls: a pharmacy that never explicitly
 * closes a month simply has no `AccountingPeriod` row for it, and posting
 * should behave exactly as it always has (unrestricted). The control only
 * bites once a period has actually been closed or locked — which is why
 * this throws only when a matching row exists AND its status isn't OPEN,
 * rather than requiring every month to be pre-created.
 */
export async function assertPeriodOpenForDate(tx: Tx, date: Date): Promise<void> {
  const period = await tx.accountingPeriod.findFirst({
    where: { startDate: { lte: date }, endDate: { gte: date } },
  });

  if (period && period.status !== 'OPEN') {
    throw new PharmacyServiceError(
      `Cannot post to ${formatPeriodName(date)} — that accounting period is ${period.status}. ` +
        `Reopen the period first, or post this entry with today's date instead.`
    );
  }
}

/** "2026-08" for a given date — matches the `periodName` convention used when seeding/creating periods. */
export function formatPeriodName(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthBounds(year: number, month: number): { startDate: Date; endDate: Date } {
  // month is 1-indexed here (matches periodName's "YYYY-MM")
  const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)); // last instant of the month
  return { startDate, endDate };
}

/**
 * Ensures an `AccountingPeriod` row exists for every calendar month from
 * `monthsBack` months ago through the current month, defaulting new rows to
 * OPEN. Called by the periods list endpoint so the close/reopen UI always
 * has something to show without requiring a separate "create period" step.
 */
export async function ensureRecentPeriods(tx: Tx, monthsBack = 12): Promise<void> {
  const now = new Date();
  const existing = await tx.accountingPeriod.findMany({ select: { periodName: true } });
  const existingNames = new Set(existing.map((p) => p.periodName));

  const toCreate: { periodName: string; startDate: Date; endDate: Date }[] = [];
  for (let i = monthsBack; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const periodName = formatPeriodName(d);
    if (existingNames.has(periodName)) continue;
    const { startDate, endDate } = monthBounds(d.getUTCFullYear(), d.getUTCMonth() + 1);
    toCreate.push({ periodName, startDate, endDate });
  }

  if (toCreate.length > 0) {
    await tx.accountingPeriod.createMany({ data: toCreate, skipDuplicates: true });
  }
}
