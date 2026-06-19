import type { Prospect } from '@prisma/client';

/** Canadian province/territory → IANA timezone (approximate local send window). */
const PROVINCE_TZ: Record<string, string> = {
  ON: 'America/Toronto',
  QC: 'America/Toronto',
  NS: 'America/Halifax',
  NB: 'America/Moncton',
  PE: 'America/Halifax',
  NL: 'America/St_Johns',
  BC: 'America/Vancouver',
  AB: 'America/Edmonton',
  SK: 'America/Regina',
  MB: 'America/Winnipeg',
  NT: 'America/Yellowknife',
  YT: 'America/Whitehorse',
  NU: 'America/Iqaluit',
};

const DEFAULT_TZ = process.env.MARKETING_SEND_TIMEZONE?.trim() || 'America/Toronto';

export function timezoneForProspect(prospect: Pick<Prospect, 'province'>): string {
  const code = prospect.province?.trim().toUpperCase();
  if (code && PROVINCE_TZ[code]) return PROVINCE_TZ[code];
  return DEFAULT_TZ;
}

interface LocalParts {
  weekday: number;
  hour: number;
  minute: number;
}

function localPartsInTz(date: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return { weekday: weekdayMap[weekdayStr] ?? 1, hour, minute };
}

/**
 * Cold outreach send window: Tue–Thu, 9:00–10:00 local (prospect province).
 * Disable with MARKETING_SEND_WINDOW_DISABLED=1 (dev / manual tick testing).
 */
export function isWithinColdSendWindow(
  prospect: Pick<Prospect, 'province'>,
  now: Date = new Date(),
): boolean {
  if (process.env.MARKETING_SEND_WINDOW_DISABLED === '1') return true;

  const tz = timezoneForProspect(prospect);
  const { weekday, hour, minute } = localPartsInTz(now, tz);

  const isTueThu = weekday >= 2 && weekday <= 4;
  if (!isTueThu) return false;

  const startHour = Number(process.env.MARKETING_SEND_HOUR_START ?? 9);
  const endHour = Number(process.env.MARKETING_SEND_HOUR_END ?? 10);
  const localMinutes = hour * 60 + minute;
  const startMinutes = startHour * 60;
  const endMinutes = endHour * 60;
  return localMinutes >= startMinutes && localMinutes < endMinutes;
}
