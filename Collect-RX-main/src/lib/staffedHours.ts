/**
 * The hours a practice has someone at the desk to take a transferred call.
 *
 * This is the practice's own schedule and is separate from the engine's call
 * window (Mon-Fri 08:00-17:00 Eastern, a compliance limit). A practice can be
 * staffed 07:00-19:00 or only Tuesday mornings; the engine still never dials
 * outside its own window, and with staffed hours set it also does not start a
 * call when nobody would be there to take it.
 *
 * Times are wall-clock HH:MM in the practice's own timezone. `end` is exclusive.
 */

export const STAFFED_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type StaffedDay = (typeof STAFFED_DAYS)[number]

export const STAFFED_DAY_LABELS: Record<StaffedDay, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

export interface StaffedDayHours {
  open: boolean
  start: string
  end: string
}

export type StaffedHours = Record<StaffedDay, StaffedDayHours>

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const FALLBACK_TIME_ZONE = 'America/New_York'

/** Mon-Fri 09:00-17:00, weekends closed. A starting point the practice edits, not a hidden rule. */
export function defaultStaffedHours(): StaffedHours {
  const weekday: StaffedDayHours = { open: true, start: '09:00', end: '17:00' }
  const weekend: StaffedDayHours = { open: false, start: '09:00', end: '17:00' }
  return {
    mon: { ...weekday },
    tue: { ...weekday },
    wed: { ...weekday },
    thu: { ...weekday },
    fri: { ...weekday },
    sat: { ...weekend },
    sun: { ...weekend },
  }
}

/** Returns a human-readable problem, or null when the value is a complete, well-formed schedule. */
export function validateStaffedHours(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'staffedHours must list every day of the week'
  const days = value as Record<string, unknown>
  for (const day of STAFFED_DAYS) {
    const entry = days[day]
    if (!entry || typeof entry !== 'object') return `staffedHours is missing ${day}`
    const { open, start, end } = entry as Record<string, unknown>
    if (typeof open !== 'boolean') return `staffedHours ${day} open must be true or false`
    if (typeof start !== 'string' || !HHMM.test(start) || typeof end !== 'string' || !HHMM.test(end)) {
      return `staffedHours ${day} start and end must be HH:MM`
    }
    // String comparison is chronological only because HH:MM is zero-padded and validated above.
    if (open && start >= end) return `staffedHours ${day} start must be before end`
  }
  return null
}

export function isStaffedHours(value: unknown): value is StaffedHours {
  return validateStaffedHours(value) === null
}

/** A stored timezone that is not a real IANA zone must not break dispatch, so it falls back to Eastern. */
export function resolveTimeZone(timeZone: string | null | undefined): string {
  if (timeZone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone })
      return timeZone
    } catch {
      return FALLBACK_TIME_ZONE
    }
  }
  return FALLBACK_TIME_ZONE
}

const WEEKDAY_TO_DAY: Record<string, StaffedDay> = {
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
  Sun: 'sun',
}

function localDayAndMinutes(now: Date, timeZone: string): { day: StaffedDay; minutes: number } | null {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveTimeZone(timeZone),
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const valueOf = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const day = WEEKDAY_TO_DAY[valueOf('weekday')]
  const hour = Number(valueOf('hour'))
  const minute = Number(valueOf('minute'))
  if (!day || !Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return { day, minutes: hour * 60 + minute }
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':')
  return Number(h) * 60 + Number(m)
}

/**
 * True when someone is at the desk at `now`. If the local time cannot be
 * worked out it answers false: not dialing is the safe side when nobody may be
 * there to take the transfer.
 */
export function isWithinStaffedHours(hours: StaffedHours, timeZone: string, now: Date = new Date()): boolean {
  const local = localDayAndMinutes(now, timeZone)
  if (!local) return false
  const today = hours[local.day]
  if (!today.open) return false
  return local.minutes >= toMinutes(today.start) && local.minutes < toMinutes(today.end)
}
