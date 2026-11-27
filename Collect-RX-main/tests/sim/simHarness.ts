// Seeded simulation harness. Everything here is SIMULATED: parameters are
// labelled assumptions from docs/design/product-journey-and-assumptions.md,
// not measurements. The suite tests our logic, not the market.

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}

export const CARRIERS = [
  'sun_life', 'canada_life', 'manulife', 'green_shield', 'rbc', 'telus_adjudicare',
] as const;

export const SCENARIOS = [
  'CLAIM_NOT_RECEIVED', 'NOT_COVERED', 'MAX_BENEFITS_REACHED', 'NEED_INFORMATION',
  'PROCESSING', 'CLAIM_PAID', 'PARTIAL_PAYMENT', 'CLAIM_DENIED', 'TRANSFER', 'UNCLEAR',
] as const;

/** SIMULATED ASSUMPTIONS (register IDs in the design doc). */
export interface SimParams {
  humanDetected: number; // A13
  staffAnswers: number; // A4, A16
  repStays: number; // A17
  listenerLogs: number; // A24 (conference listener success)
  blindTransferListenerLogs: number; // today: scribe likely hears nothing
  carrierBlockRate: number; // A12
  holdMinutesMean: Record<string, number>; // seeded from CARRIER_TIMEOUTS style figures, UNVERIFIED
}

export const DEFAULT_PARAMS: SimParams = {
  humanDetected: 0.95,
  staffAnswers: 0.85,
  repStays: 0.9,
  listenerLogs: 0.8,
  blindTransferListenerLogs: 0,
  carrierBlockRate: 0.01,
  holdMinutesMean: {
    sun_life: 18, canada_life: 20, manulife: 22, green_shield: 15, rbc: 38, telus_adjudicare: 25,
  },
};

export function easternParts(d: Date): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto', weekday: 'short', hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(d);
  const wk = parts.find((p) => p.type === 'weekday')!.value;
  const hr = Number(parts.find((p) => p.type === 'hour')!.value);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: map[wk], hour: hr };
}
