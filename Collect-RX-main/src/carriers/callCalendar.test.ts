import { describe, expect, it } from 'vitest';
import { canadianHolidayName, isWithinPracticeStaffHours, localParts } from './callCalendar.js';

describe('canadianHolidayName', () => {
  it.each([
    ['2026-01-01T15:00:00Z', "New Year's Day"],
    ['2026-02-16T15:00:00Z', 'Family Day'],
    ['2026-04-03T15:00:00Z', 'Good Friday'],
    ['2026-05-18T15:00:00Z', 'Victoria Day'],
    ['2026-07-01T15:00:00Z', 'Canada Day'],
    ['2026-09-07T15:00:00Z', 'Labour Day'],
    ['2026-10-12T15:00:00Z', 'Thanksgiving'],
    ['2026-12-25T15:00:00Z', 'Christmas Day'],
  ])('%s is %s', (iso, name) => {
    expect(canadianHolidayName(new Date(iso))).toBe(name);
  });

  it('observes a weekend Christmas and Boxing Day on the next free weekdays', () => {
    expect(canadianHolidayName(new Date('2026-12-28T15:00:00Z'))).toBe('Boxing Day (observed)');
    expect(canadianHolidayName(new Date('2027-12-27T15:00:00Z'))).toBe('Christmas Day (observed)');
    expect(canadianHolidayName(new Date('2027-12-28T15:00:00Z'))).toBe('Boxing Day (observed)');
    expect(canadianHolidayName(new Date('2022-01-03T15:00:00Z'))).toBe("New Year's Day (observed)");
  });

  it('returns null on an ordinary working day and the day after a holiday', () => {
    expect(canadianHolidayName(new Date('2026-11-10T15:00:00Z'))).toBeNull();
    expect(canadianHolidayName(new Date('2026-12-29T15:00:00Z'))).toBeNull();
  });

  it('uses the local calendar date, not the UTC date', () => {
    // 03:00 UTC on Dec 26 is still 22:00 Dec 25 in Toronto.
    expect(canadianHolidayName(new Date('2026-12-26T03:00:00Z'), 'America/Toronto')).toBe('Christmas Day');
    expect(canadianHolidayName(new Date('2026-12-26T03:00:00Z'), 'UTC')).toBe('Boxing Day');
  });
});

describe('localParts', () => {
  it('reads wall-clock parts in the zone and falls back to Eastern for an unknown zone', () => {
    // Phoenix has no daylight saving, so the offset is fixed at UTC-7 whatever the tz data says about other zones.
    expect(localParts(new Date('2026-11-10T13:00:00Z'), 'America/Phoenix')).toMatchObject({ month: 11, day: 10, weekday: 2, hour: 6 });
    expect(localParts(new Date('2026-11-10T13:00:00Z'), 'Not/AZone')).toMatchObject({ hour: 8 });
  });
});

describe('isWithinPracticeStaffHours', () => {
  it('rejects a western office at 06:00 local, when the Eastern window has already opened at 08:00', () => {
    expect(isWithinPracticeStaffHours(new Date('2026-11-10T13:00:00Z'), 'America/Phoenix')).toBe(false);
  });
  it('accepts a western office at 10:00 and Toronto at 09:00 on a working day', () => {
    expect(isWithinPracticeStaffHours(new Date('2026-11-10T17:00:00Z'), 'America/Phoenix')).toBe(true);
    expect(isWithinPracticeStaffHours(new Date('2026-11-10T14:00:00Z'), 'America/Toronto')).toBe(true);
  });
  it('rejects the 17:00 boundary, weekends and public holidays', () => {
    expect(isWithinPracticeStaffHours(new Date('2026-11-10T22:00:00Z'), 'America/Toronto')).toBe(false);
    expect(isWithinPracticeStaffHours(new Date('2026-11-14T15:00:00Z'), 'America/Toronto')).toBe(false);
    expect(isWithinPracticeStaffHours(new Date('2026-12-25T15:00:00Z'), 'America/Toronto')).toBe(false);
  });
});
