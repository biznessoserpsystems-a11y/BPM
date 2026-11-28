import { describe, it, expect } from 'vitest';
import { weekRangeFor, mondayOf, parseLocalDate, shiftWeek, toLocalISODate } from '../src/lib/week-range';

// Local-time dates throughout (the server's convention), built with the
// y/m/d constructor so these tests pass in any timezone.
const d = (y: number, m: number, day: number, h = 0, min = 0, s = 0, ms = 0) => new Date(y, m - 1, day, h, min, s, ms);

describe('which Monday a date belongs to', () => {
  it.each([
    [d(2026, 11, 16), '2026-11-16'], // Monday itself
    [d(2026, 11, 18), '2026-11-16'], // midweek
    [d(2026, 11, 22), '2026-11-16'], // Sunday belongs to the week that STARTED the Monday before
    [d(2026, 11, 23), '2026-11-23'], // next Monday starts a new week
    [d(2026, 1, 1), '2025-12-29'],   // crosses a year boundary
    [d(2024, 3, 3), '2024-02-26'],   // crosses a month boundary in a leap year
  ])('%s -> week of %s', (date, monday) => {
    expect(toLocalISODate(mondayOf(date))).toBe(monday);
  });
});

describe('the weekly range', () => {
  it('runs Monday to Sunday, seven labelled days', () => {
    const r = weekRangeFor('2026-11-19');
    expect(r.weekStart).toBe('2026-11-16');
    expect(r.weekEnd).toBe('2026-11-22');
    expect(r.days.map((x) => x.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(r.days.map((x) => x.date)).toEqual([
      '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22',
    ]);
  });

  it('includes the whole of Sunday and excludes the next Monday\'s first instant', () => {
    const r = weekRangeFor('2026-11-16');
    const inRange = (t: Date) => t >= r.from && t < r.to;
    expect(inRange(d(2026, 11, 16, 0, 0, 0, 0))).toBe(true);        // Monday 00:00:00.000
    expect(inRange(d(2026, 11, 22, 23, 59, 59, 999))).toBe(true);   // Sunday 23:59:59.999
    expect(inRange(d(2026, 11, 23, 0, 0, 0, 0))).toBe(false);       // next Monday 00:00
    expect(inRange(d(2026, 11, 15, 23, 59, 59, 999))).toBe(false);  // previous Sunday night
  });

  it('defaults to the current week', () => {
    const r = weekRangeFor(undefined, d(2026, 11, 20, 14, 30));
    expect(r.weekStart).toBe('2026-11-16');
    expect(weekRangeFor('', d(2026, 11, 22, 23, 59)).weekStart).toBe('2026-11-16');
  });

  it('handles a week that spans a month and a year', () => {
    const r = weekRangeFor('2026-12-31');
    expect(r.weekStart).toBe('2026-12-28');
    expect(r.weekEnd).toBe('2027-01-03');
    expect(r.days[4].date).toBe('2027-01-01');
  });

  it.each(['2026-13-01', '2026-02-30', 'yesterday', '16/11/2026', '2026-11-16T00:00:00', '1999-01-01', '2101-01-01'])(
    'rejects %s',
    (bad) => {
      expect(() => weekRangeFor(bad)).toThrow(/real date in YYYY-MM-DD/);
    }
  );
});

describe('stepping between weeks', () => {
  it('moves by whole weeks in either direction', () => {
    expect(shiftWeek('2026-11-16', 1)).toBe('2026-11-23');
    expect(shiftWeek('2026-11-16', -1)).toBe('2026-11-09');
    expect(shiftWeek('2026-12-28', 1)).toBe('2027-01-04');
  });
  it('parses only real dates', () => {
    expect(parseLocalDate('2026-02-29')).toBeNull();
    expect(parseLocalDate('2028-02-29')).not.toBeNull();
  });
});

describe('dayRangeFor (Daily Sales Report)', () => {
  it('covers exactly one local day', async () => {
    const { dayRangeFor, shiftDay } = await import('../src/lib/week-range');
    const r = dayRangeFor('2026-11-18');
    expect(r.weekStart).toBe('2026-11-18');
    expect(r.weekEnd).toBe('2026-11-18');
    expect(r.days).toEqual([{ date: '2026-11-18', label: 'Wed' }]);
    expect(r.to.getTime() - r.from.getTime()).toBe(24 * 3600 * 1000);
    expect(shiftDay('2026-11-30', 1)).toBe('2026-12-01');
    expect(() => dayRangeFor('2026-02-30')).toThrow();
  });
});
