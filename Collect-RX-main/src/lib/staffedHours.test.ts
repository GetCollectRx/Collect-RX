import { describe, expect, it } from 'vitest'
import {
  defaultStaffedHours,
  isStaffedHours,
  isWithinStaffedHours,
  resolveTimeZone,
  validateStaffedHours,
  type StaffedHours,
} from './staffedHours'

// 2026-11-23 is a Monday. Eastern is UTC-5 in November, Pacific UTC-8.
const mondayAtEastern = (hhmm: string) => new Date(`2026-11-23T${hhmm}:00-05:00`)

describe('validateStaffedHours', () => {
  it('accepts the default schedule', () => {
    expect(validateStaffedHours(defaultStaffedHours())).toBeNull()
  })

  it('rejects a schedule that does not list every day', () => {
    const { sun: _sun, ...rest } = defaultStaffedHours()
    expect(validateStaffedHours(rest)).toMatch(/missing sun/)
    expect(validateStaffedHours(null)).toMatch(/every day/)
  })

  it('rejects malformed times and an end that is not after the start on an open day', () => {
    const bad = defaultStaffedHours()
    bad.tue.start = '9:00'
    expect(validateStaffedHours(bad)).toMatch(/tue start and end must be HH:MM/)

    const backwards = defaultStaffedHours()
    backwards.wed.start = '17:00'
    backwards.wed.end = '09:00'
    expect(validateStaffedHours(backwards)).toMatch(/wed start must be before end/)
  })

  it('does not hold a closed day to the start-before-end rule', () => {
    const hours = defaultStaffedHours()
    hours.sat = { open: false, start: '17:00', end: '09:00' }
    expect(validateStaffedHours(hours)).toBeNull()
  })

  it('type guard agrees with the validator', () => {
    expect(isStaffedHours(defaultStaffedHours())).toBe(true)
    expect(isStaffedHours({ mon: {} })).toBe(false)
  })
})

describe('isWithinStaffedHours', () => {
  const hours = defaultStaffedHours()

  it('is open between start and end, with the end exclusive', () => {
    expect(isWithinStaffedHours(hours, 'America/New_York', mondayAtEastern('09:00'))).toBe(true)
    expect(isWithinStaffedHours(hours, 'America/New_York', mondayAtEastern('16:59'))).toBe(true)
    expect(isWithinStaffedHours(hours, 'America/New_York', mondayAtEastern('17:00'))).toBe(false)
    expect(isWithinStaffedHours(hours, 'America/New_York', mondayAtEastern('08:59'))).toBe(false)
  })

  it('is closed on a day marked closed', () => {
    const saturday = new Date('2026-11-28T12:00:00-05:00')
    expect(isWithinStaffedHours(hours, 'America/New_York', saturday)).toBe(false)
  })

  it('uses the practice timezone, not the server timezone', () => {
    // 09:30 Eastern is 06:30 Pacific: open for an Eastern practice, closed for a Pacific one.
    const instant = mondayAtEastern('09:30')
    expect(isWithinStaffedHours(hours, 'America/New_York', instant)).toBe(true)
    expect(isWithinStaffedHours(hours, 'America/Vancouver', instant)).toBe(false)
  })

  it('supports hours wider than the engine call window', () => {
    const wide: StaffedHours = { ...defaultStaffedHours(), mon: { open: true, start: '07:00', end: '19:00' } }
    expect(isWithinStaffedHours(wide, 'America/New_York', mondayAtEastern('07:30'))).toBe(true)
    expect(isWithinStaffedHours(wide, 'America/New_York', mondayAtEastern('18:30'))).toBe(true)
  })

  it('falls back to Eastern when the stored timezone is not a real zone', () => {
    expect(resolveTimeZone('Mars/Olympus')).toBe('America/New_York')
    expect(resolveTimeZone(null)).toBe('America/New_York')
    expect(isWithinStaffedHours(hours, 'Mars/Olympus', mondayAtEastern('10:00'))).toBe(true)
  })
})
