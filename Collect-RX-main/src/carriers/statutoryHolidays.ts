/**
 * Canadian statutory holidays on which carrier claims lines are closed.
 *
 * Dialling a closed carrier still consumes one of the three attempts a claim
 * is allowed, and the agent has nothing to reach but a recorded message — so a
 * holiday spent calling costs an attempt and buys nothing. Worse, a fleet of
 * practices all retrying into a closed line on the same morning is precisely
 * the synchronized pattern carrier fraud monitoring is built to notice.
 *
 * The list is the nationally-observed set rather than any single province's.
 * Erring toward not calling costs a day of delay; erring the other way costs
 * an attempt, so the conservative direction is the cheap one. Carriers are
 * national insurers and generally staff their claims lines to the federal
 * calendar.
 *
 * Dates are compared as Eastern-time calendar days, matching the call window.
 */

/** Weekday-shifted observance for holidays that land on a weekend. */
function observedWeekday(year: number, month: number, day: number, taken: Set<string>): string {
  const d = new Date(Date.UTC(year, month - 1, day, 12));
  // Sat → Mon, Sun → Mon. The window already excludes weekends, so only the
  // weekday the office actually closes needs to appear in the set.
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || taken.has(iso(d))) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return iso(d);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Nth given weekday of a month, e.g. first Monday in September. */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): string {
  const d = new Date(Date.UTC(year, month - 1, 1, 12));
  let count = 0;
  while (true) {
    if (d.getUTCDay() === weekday) {
      count += 1;
      if (count === n) return iso(d);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

/** Monday on or before May 24 — Victoria Day. */
function victoriaDay(year: number): string {
  const d = new Date(Date.UTC(year, 4, 24, 12));
  while (d.getUTCDay() !== 1) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return iso(d);
}

/** Meeus/Jones/Butcher Gregorian Easter. Good Friday is two days earlier. */
function goodFriday(year: number): string {
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

  const easter = new Date(Date.UTC(year, month - 1, day, 12));
  easter.setUTCDate(easter.getUTCDate() - 2);
  return iso(easter);
}

const cache = new Map<number, Set<string>>();

export function carrierHolidaysForYear(year: number): Set<string> {
  const cached = cache.get(year);
  if (cached) return cached;

  const days = new Set<string>();

  // Moveable holidays first: they always fall on a weekday, so they cannot be
  // displaced, but a fixed holiday could otherwise be shifted on top of one.
  days.add(goodFriday(year));
  days.add(victoriaDay(year));
  days.add(nthWeekdayOfMonth(year, 9, 1, 1));   // Labour Day — first Monday, September
  days.add(nthWeekdayOfMonth(year, 10, 1, 2));  // Thanksgiving — second Monday, October

  const fixed: Array<[number, number]> = [
    [1, 1],    // New Year's Day
    [7, 1],    // Canada Day
    [9, 30],   // National Day for Truth and Reconciliation
    [11, 11],  // Remembrance Day
    [12, 25],  // Christmas Day
    [12, 26],  // Boxing Day
  ];
  for (const [month, day] of fixed) {
    days.add(observedWeekday(year, month, day, days));
  }

  cache.set(year, days);
  return days;
}

/** Eastern-time calendar day as YYYY-MM-DD, matching the call-window timezone. */
function easternDateKey(date: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}

/**
 * True when carrier claims lines are closed for a statutory holiday.
 *
 * COLLECTRX_IGNORE_HOLIDAYS=1 is a test/staging escape hatch only; it refuses
 * to take effect in production, where burning an attempt on a closed line is a
 * real cost to the practice.
 */
export function isCarrierHoliday(date = new Date()): boolean {
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.COLLECTRX_IGNORE_HOLIDAYS === '1'
  ) {
    return false;
  }
  const key = easternDateKey(date);
  const year = Number(key.slice(0, 4));
  return carrierHolidaysForYear(year).has(key);
}
