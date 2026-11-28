import { PharmacyServiceError } from '@/lib/errors';

// Calendar weeks for the Weekly Sales Report: Monday to Sunday, in the
// SERVER'S local time (same convention as the other reports, which use local
// date parts too). Day boundaries are built from local year/month/day rather
// than by adding 24 hours, so a daylight-saving change can't shift a sale
// into the wrong day.

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface WeekDay {
  /** YYYY-MM-DD */
  date: string;
  /** Mon, Tue, … */
  label: string;
}

export interface WeekRange {
  /** Monday, YYYY-MM-DD */
  weekStart: string;
  /** Sunday, YYYY-MM-DD (the last day INCLUDED) */
  weekEnd: string;
  /** Inclusive: Monday 00:00 */
  from: Date;
  /** Exclusive: the following Monday 00:00 */
  to: Date;
  days: WeekDay[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD from a Date's LOCAL year/month/day. */
export function toLocalISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Strict YYYY-MM-DD -> local midnight; null if malformed or not a real date (e.g. 2026-02-30). */
export function parseLocalDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/** The Monday on or before `d`, at local midnight. */
export function mondayOf(d: Date): Date {
  const daysSinceMonday = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysSinceMonday);
}

/**
 * The week containing `date` (any day in it works; it's aligned to Monday).
 * Omitted/blank means the current week. Rejects anything that isn't a real
 * YYYY-MM-DD date, and years outside a sane range.
 */
export function weekRangeFor(date: string | null | undefined, now: Date = new Date()): WeekRange {
  let anchor = now;
  if (date) {
    const parsed = parseLocalDate(date);
    if (!parsed || parsed.getFullYear() < 2000 || parsed.getFullYear() > 2100) {
      throw new PharmacyServiceError('date must be a real date in YYYY-MM-DD format');
    }
    anchor = parsed;
  }
  const monday = mondayOf(anchor);
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    days.push({ date: toLocalISODate(day), label: DAY_LABELS[day.getDay()] });
  }
  return {
    weekStart: days[0].date,
    weekEnd: days[6].date,
    from: monday,
    to: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7),
    days,
  };
}

/** The Monday `weeks` weeks after (or before, if negative) the week that starts on `weekStart`. */
export function shiftWeek(weekStart: string, weeks: number): string {
  const d = parseLocalDate(weekStart) ?? new Date();
  return toLocalISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + weeks * 7));
}

/**
 * A single day, shaped like a one-day "week" so the Daily Sales Report can
 * share the weekly report's code. `date` blank means today.
 */
export function dayRangeFor(date: string | null | undefined, now: Date = new Date()): WeekRange {
  let day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (date) {
    const parsed = parseLocalDate(date);
    if (!parsed || parsed.getFullYear() < 2000 || parsed.getFullYear() > 2100) {
      throw new PharmacyServiceError('date must be a real date in YYYY-MM-DD format');
    }
    day = parsed;
  }
  const iso = toLocalISODate(day);
  return {
    weekStart: iso,
    weekEnd: iso,
    from: day,
    to: new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1),
    days: [{ date: iso, label: DAY_LABELS[day.getDay()] }],
  };
}

/** The date `days` days after (or before, if negative) `date`. */
export function shiftDay(date: string, days: number): string {
  const d = parseLocalDate(date) ?? new Date();
  return toLocalISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}
