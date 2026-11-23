/**
 * Calendar rules for carrier calls and practice staff hours.
 *
 * Pure functions, no I/O. The holiday set is Ontario's public holidays, which
 * the Eastern call window and most carrier call centres follow. Provincial
 * holidays that differ elsewhere (for example BC Day or the Civic Holiday) are
 * not modelled, so a practice outside Ontario can still be called on those days.
 * That gap is deliberate and stated here rather than guessed at.
 */

const EASTERN = 'America/Toronto';

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  hour: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return timeZone;
  } catch {
    return EASTERN;
  }
}

/** Wall-clock parts of an instant in a zone. An unknown zone falls back to Eastern, the stricter carrier window. */
export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeZone(timeZone),
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(pick('year')),
    month: Number(pick('month')),
    day: Number(pick('day')),
    weekday: WEEKDAYS[pick('weekday')] ?? 0,
    hour: Number(pick('hour')) % 24,
  };
}

const key = (year: number, month: number, day: number): string => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** Day of week for a calendar date, independent of any time zone. */
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The nth (1-based) given weekday of a month, as a day of the month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = weekdayOf(year, month, 1);
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

/** Easter Sunday by the anonymous Gregorian algorithm. */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

const cache = new Map<number, Map<string, string>>();

function holidaysForYear(year: number): Map<string, string> {
  const cached = cache.get(year);
  if (cached) return cached;
  const out = new Map<string, string>();
  const add = (month: number, day: number, name: string): void => {
    out.set(key(year, month, day), name);
  };

  const easter = easterSunday(year);
  const goodFriday = new Date(Date.UTC(year, easter.month - 1, easter.day - 2));
  add(goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate(), 'Good Friday');
  add(2, nthWeekday(year, 2, 1, 3), 'Family Day');
  // Victoria Day is the last Monday before May 25.
  const may24Weekday = weekdayOf(year, 5, 24);
  add(5, 24 - ((may24Weekday + 6) % 7), 'Victoria Day');
  add(9, nthWeekday(year, 9, 1, 1), 'Labour Day');
  add(10, nthWeekday(year, 10, 1, 2), 'Thanksgiving');

  // Fixed-date holidays that land on a weekend are observed on the next free weekday.
  const fixed: Array<[number, number, string]> = [
    [1, 1, "New Year's Day"],
    [7, 1, 'Canada Day'],
    [12, 25, 'Christmas Day'],
    [12, 26, 'Boxing Day'],
  ];
  for (const [month, day, name] of fixed) {
    const w = weekdayOf(year, month, day);
    if (w !== 0 && w !== 6) {
      add(month, day, name);
      continue;
    }
    add(month, day, name);
    for (let step = 1; step <= 3; step += 1) {
      const d = new Date(Date.UTC(year, month - 1, day + step));
      const dw = d.getUTCDay();
      const k = key(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      if (dw !== 0 && dw !== 6 && !out.has(k)) {
        out.set(k, `${name} (observed)`);
        break;
      }
    }
  }
  cache.set(year, out);
  return out;
}

/** Name of the public holiday on this date in the given zone, or null. */
export function canadianHolidayName(date: Date, timeZone: string = EASTERN): string | null {
  const p = localParts(date, timeZone);
  return holidaysForYear(p.year).get(key(p.year, p.month, p.day)) ?? null;
}

export interface StaffHours {
  startHour: number;
  endHour: number;
}

export const DEFAULT_STAFF_HOURS: StaffHours = { startHour: 8, endHour: 17 };

/**
 * Whether practice staff are plausibly at their desks: a weekday, not a public
 * holiday, within the hours, all in the practice's own zone. A transfer to a
 * practice nobody is answering is a failed call the carrier still sees.
 */
export function isWithinPracticeStaffHours(date: Date, timeZone: string, hours: StaffHours = DEFAULT_STAFF_HOURS): boolean {
  const p = localParts(date, timeZone);
  if (p.weekday === 0 || p.weekday === 6) return false;
  if (holidaysForYear(p.year).has(key(p.year, p.month, p.day))) return false;
  return p.hour >= hours.startHour && p.hour < hours.endHour;
}
