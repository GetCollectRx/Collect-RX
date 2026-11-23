import type { CheckStatus } from '../../sim-harness/runLog.js';

/**
 * Evidence ladder. A scenario is only ever reported at the level it actually ran at.
 * D document, U unit (real production function), S Stage 1 simulation (full pipeline,
 * fake carrier), M mock Vapi, B browser walk, O owned-number run, C real carrier.
 */
export type Level = 'D' | 'U' | 'S' | 'M' | 'B' | 'O' | 'C';

export interface BindingResult {
  status: CheckStatus;
  level: Level;
  /** Closed vocabulary only: codes, enum values, booleans, counts. Never transcript text or identifiers. */
  observed: string;
  /** What this run proves, and what it leaves unproven. */
  proves: string;
}

export type Binding = () => Promise<BindingResult>;

export function pass(level: Level, observed: string, proves: string): BindingResult {
  return { status: 'PASS', level, observed, proves };
}

export function fail(level: Level, observed: string, proves: string): BindingResult {
  return { status: 'FAIL', level, observed, proves };
}

export function finding(level: Level, observed: string, proves: string): BindingResult {
  return { status: 'FINDING', level, observed, proves };
}

export function verdict(ok: boolean, level: Level, observed: string, proves: string): BindingResult {
  return ok ? pass(level, observed, proves) : fail(level, observed, proves);
}
