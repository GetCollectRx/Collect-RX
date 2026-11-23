import type { StaffAvailability } from '../../types/practiceSettings.js';

/** Dial this many minutes before a window opens, so a rep is likely to answer inside it. */
export const DEFAULT_LEAD_MINUTES = 15;
/** Stop dialing this many minutes before a window closes, so late answers do not land after it. */
export const DEFAULT_TAIL_MINUTES = 30;

export interface StaffAvailabilityResult {
  available: boolean;
  reason?: string;
}

function zoneClock(date: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: map[get('weekday')] ?? -1, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Whether a NEW carrier call may start now so that a rep answering after the
 * hold lands while staff can take it. Unconfigured practices are unrestricted
 * (backward compatible). A pause only stops new dials; calls already on hold
 * are not touched here.
 */
export function evaluateStaffAvailability(
  sa: StaffAvailability | undefined,
  now: Date = new Date(),
  timeZone = 'America/Toronto',
): StaffAvailabilityResult {
  if (!sa) return { available: true };

  if (sa.pausedUntil) {
    const until = Date.parse(sa.pausedUntil);
    if (Number.isFinite(until) && until > now.getTime()) {
      return { available: false, reason: `Staff marked busy until ${new Date(until).toISOString()}` };
    }
  }

  if (!sa.windows || sa.windows.length === 0) return { available: true };

  const lead = sa.leadMinutes ?? DEFAULT_LEAD_MINUTES;
  const tail = sa.tailMinutes ?? DEFAULT_TAIL_MINUTES;
  const { weekday, minutes } = zoneClock(now, timeZone);

  for (const w of sa.windows) {
    if (!w.days.includes(weekday)) continue;
    const opens = hhmmToMinutes(w.start) - lead;
    const closes = hhmmToMinutes(w.end) - tail;
    if (minutes >= opens && minutes < closes) return { available: true };
  }
  return { available: false, reason: 'Outside the staff availability windows set for this practice' };
}
