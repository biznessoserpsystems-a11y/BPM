import { isSameLocalDay } from '@/lib/sale-edit';
import { parseLocalDate } from '@/lib/week-range';

export interface ResolvedSaleDate {
  /** When the sale is recorded as having happened. */
  date: Date;
  /** True when it is an earlier day than today (an omitted sale being added back). */
  isPast: boolean;
}

/**
 * The date a sale is recorded for. Blank (or today's date) means "now". An
 * earlier day is allowed — to add back a sale that was left out — and is
 * recorded at 12:00 local time that day, so no timezone or daylight-saving
 * shift can move it onto a different calendar day. The future is never allowed.
 */
export function resolveSaleDate(input: unknown, now: Date = new Date()): ResolvedSaleDate {
  if (input === undefined || input === null || input === '') return { date: now, isPast: false };
  const parsed = typeof input === 'string' ? parseLocalDate(input.slice(0, 10)) : null;
  if (!parsed || parsed.getFullYear() < 2000) throw new Error('saleDate must be a real date in YYYY-MM-DD format');
  if (isSameLocalDay(parsed, now)) return { date: now, isPast: false };
  if (parsed.getTime() > now.getTime()) throw new Error('A sale cannot be dated in the future');
  return { date: new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0), isPast: true };
}
