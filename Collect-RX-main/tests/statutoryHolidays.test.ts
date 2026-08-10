/**
 * Carrier claims lines are closed on statutory holidays, and a call placed
 * into a closed line still consumes one of the claim's three attempts.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { carrierHolidaysForYear, isCarrierHoliday } from '../src/carriers/statutoryHolidays.js';
import { isWithinCallWindow } from '../src/carriers/adapter.js';

/** 10am Eastern on the given calendar day — inside the call window. */
function easternMorning(year: number, month: number, day: number): Date {
  // 15:00Z is 10am EST and 11am EDT; both sit inside 08:00–17:00 Eastern.
  return new Date(Date.UTC(year, month - 1, day, 15));
}

beforeEach(() => {
  delete process.env.COLLECTRX_FORCE_CALL_WINDOW;
  delete process.env.COLLECTRX_IGNORE_HOLIDAYS;
});

afterEach(() => {
  delete process.env.COLLECTRX_FORCE_CALL_WINDOW;
  delete process.env.COLLECTRX_IGNORE_HOLIDAYS;
});

describe('statutory holiday calendar', () => {
  it('computes the 2026 moveable holidays', () => {
    const days = carrierHolidaysForYear(2026);
    expect(days.has('2026-04-03')).toBe(true); // Good Friday
    expect(days.has('2026-05-18')).toBe(true); // Victoria Day
    expect(days.has('2026-09-07')).toBe(true); // Labour Day
    expect(days.has('2026-10-12')).toBe(true); // Thanksgiving
  });

  it('computes Good Friday across years', () => {
    expect(carrierHolidaysForYear(2027).has('2027-03-26')).toBe(true);
    expect(carrierHolidaysForYear(2028).has('2028-04-14')).toBe(true);
  });

  it('shifts a weekend holiday to the weekday actually observed', () => {
    // Canada Day 2029 falls on a Sunday; offices close Monday July 2.
    const days = carrierHolidaysForYear(2029);
    expect(days.has('2029-07-02')).toBe(true);
  });

  it('does not collapse Christmas and Boxing Day onto the same observed day', () => {
    // 2027: Dec 25 is a Saturday, Dec 26 a Sunday — two distinct weekdays close.
    const days = carrierHolidaysForYear(2027);
    expect(days.has('2027-12-27')).toBe(true);
    expect(days.has('2027-12-28')).toBe(true);
  });

  it('treats an ordinary weekday as a working day', () => {
    expect(isCarrierHoliday(easternMorning(2026, 3, 17))).toBe(false);
  });
});

describe('call window excludes holidays', () => {
  it('refuses to call on Canada Day even at midday on a weekday', () => {
    // 2026-07-01 is a Wednesday inside business hours.
    const canadaDay = easternMorning(2026, 7, 1);
    expect(canadaDay.getUTCDay()).toBe(3);
    expect(isWithinCallWindow(canadaDay)).toBe(false);
  });

  it('allows calls the following working day', () => {
    expect(isWithinCallWindow(easternMorning(2026, 7, 2))).toBe(true);
  });

  it('still refuses outside business hours on a working day', () => {
    // 03:00Z on a Thursday is 22:00 the previous Eastern evening.
    expect(isWithinCallWindow(new Date(Date.UTC(2026, 6, 2, 3)))).toBe(false);
  });

  it('honours the forced-window escape hatch outside production', () => {
    process.env.COLLECTRX_FORCE_CALL_WINDOW = '1';
    expect(isWithinCallWindow(easternMorning(2026, 12, 25))).toBe(true);
  });
});
