/**
 * Hybrid call flow: one phase sequence for every call, two possible endings.
 *
 * Every call runs the same base (dial, phone menu, hold, rep answers). Only the
 * ending differs: practice staff take the rep conversation (Hold Sentinel) or
 * the agent does (autonomous, per graduated carrier, ADR 0005). This module is
 * pure: no I/O, so the rules are testable without a database.
 *
 * Feature flag HYBRID_CALL_FLOW (off by default) gates all recording. With it
 * off nothing here changes call behaviour.
 */
import type { BillingTier } from '@prisma/client';
import { FEATURES, effectiveHumanAssisted, tierAllows } from '../../billing/entitlements.js';

export const CALL_PHASES = [
  'dialing',
  'phone_menu',
  'hold',
  'rep_answered',
  'staff_or_agent',
  'wrap_up',
] as const;
export type CallPhase = (typeof CALL_PHASES)[number];

export function isCallPhase(value: unknown): value is CallPhase {
  return typeof value === 'string' && (CALL_PHASES as readonly string[]).includes(value);
}

export type PhaseEntry = {
  phase: CallPhase;
  /** ISO timestamp of when the call entered the phase. */
  at: string;
};

/**
 * Legal moves. The phone menu and hold can alternate (a carrier re-prompts
 * after a wait), and a rep can send the call back to hold. Staff or agent can
 * only be entered from rep_answered so handoff latency is always measurable.
 */
const NEXT: Record<CallPhase, readonly CallPhase[]> = {
  dialing: ['phone_menu', 'hold', 'rep_answered', 'wrap_up'],
  phone_menu: ['hold', 'rep_answered', 'wrap_up'],
  hold: ['phone_menu', 'rep_answered', 'wrap_up'],
  rep_answered: ['hold', 'staff_or_agent', 'wrap_up'],
  staff_or_agent: ['wrap_up'],
  wrap_up: [],
};

export function canTransition(from: CallPhase, to: CallPhase): boolean {
  return NEXT[from].includes(to);
}

export type TransitionResult =
  | { applied: true; history: PhaseEntry[] }
  | { applied: false; history: PhaseEntry[]; reason: 'same_phase' | 'not_allowed' | 'no_history' };

/**
 * Appends a transition when it is legal. The timestamp never moves backwards:
 * a late or out-of-order event is clamped to the previous entry so segment
 * durations can never be negative.
 */
export function applyTransition(history: readonly PhaseEntry[], to: CallPhase, at: Date): TransitionResult {
  const last = history[history.length - 1];
  if (!last) return { applied: false, history: [...history], reason: 'no_history' };
  if (last.phase === to) return { applied: false, history: [...history], reason: 'same_phase' };
  if (!canTransition(last.phase, to)) return { applied: false, history: [...history], reason: 'not_allowed' };
  const lastMs = Date.parse(last.at);
  const atMs = Number.isNaN(at.getTime()) ? lastMs : Math.max(at.getTime(), lastMs);
  return { applied: true, history: [...history, { phase: to, at: new Date(atMs).toISOString() }] };
}

/** Reads persisted JSON defensively; anything malformed is treated as no history. */
export function parsePhaseHistory(value: unknown): PhaseEntry[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: PhaseEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const { phase, at } = item as Record<string, unknown>;
    if (!isCallPhase(phase) || typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
    out.push({ phase, at });
  }
  return out;
}

export interface SegmentSeconds {
  menuSeconds: number | null;
  holdSeconds: number | null;
  repSeconds: number | null;
  staffAgentSeconds: number | null;
  wrapUpSeconds: number | null;
}

/**
 * Time spent per phase, summed over repeat visits, once the call is closed.
 * A phase the call never entered is null, not zero: with partial signals a
 * zero would look like a measurement. Dialing is derivable and not stored.
 */
export function segmentSeconds(history: readonly PhaseEntry[], closedAt: Date): SegmentSeconds {
  const totals = new Map<CallPhase, number>();
  history.forEach((entry, i) => {
    const start = Date.parse(entry.at);
    const next = history[i + 1];
    const end = next ? Date.parse(next.at) : Math.max(closedAt.getTime(), start);
    totals.set(entry.phase, (totals.get(entry.phase) ?? 0) + Math.max(0, end - start));
  });
  const secs = (phase: CallPhase): number | null => {
    const ms = totals.get(phase);
    return ms === undefined ? null : Math.round(ms / 1000);
  };
  return {
    menuSeconds: secs('phone_menu'),
    holdSeconds: secs('hold'),
    repSeconds: secs('rep_answered'),
    staffAgentSeconds: secs('staff_or_agent'),
    wrapUpSeconds: secs('wrap_up'),
  };
}

/**
 * Phases a squad member implies once it is active. Sequences are applied step
 * by step, skipping steps that are not legal, so a late signal cannot rewind a
 * call. Claims_Scribe is the human-assisted squad's member that starts when a
 * rep answers.
 */
export function phasesForAgent(agent: string): CallPhase[] {
  switch (agent) {
    case 'IVR_Navigator':
      return ['phone_menu'];
    case 'Hold_Sentinel':
      return ['hold'];
    case 'Claims_Scribe':
      return ['rep_answered'];
    case 'Claims_Agent':
      return ['rep_answered', 'staff_or_agent'];
    case 'Escalation_Closer':
    case 'Resolution_Closer':
      return ['rep_answered', 'staff_or_agent', 'wrap_up'];
    default:
      return [];
  }
}

export type CallEnding = 'staff' | 'agent';

export type EndingReason =
  | 'plan_excludes_autonomous'
  | 'carrier_not_graduated'
  | 'practice_keeps_hold_sentinel'
  | 'autonomous_allowed';

export interface EndingDecision {
  ending: CallEnding;
  /** The value dispatch uses to pick the squad (true means the human-assisted squad). */
  humanAssisted: boolean;
  reason: EndingReason;
}

/**
 * Chooses who talks to the rep. The verdict comes from effectiveHumanAssisted()
 * (ADR 0004 and 0005), so there is one rule; the reason is derived in the same
 * order only to explain it, and a test pins the two together.
 */
export function selectCallEnding(input: {
  tier: BillingTier | null | undefined;
  humanAssistedMode: boolean | undefined;
  carrierGraduated: boolean;
}): EndingDecision {
  const humanAssisted = effectiveHumanAssisted(input.tier, input.humanAssistedMode, {
    carrierGraduated: input.carrierGraduated,
  });
  let reason: EndingReason;
  if (!tierAllows(input.tier, FEATURES.AUTONOMOUS_CALLS)) reason = 'plan_excludes_autonomous';
  else if (!input.carrierGraduated) reason = 'carrier_not_graduated';
  else if (input.humanAssistedMode !== false) reason = 'practice_keeps_hold_sentinel';
  else reason = 'autonomous_allowed';
  return { ending: humanAssisted ? 'staff' : 'agent', humanAssisted, reason };
}

export function hybridCallFlowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HYBRID_CALL_FLOW === 'true';
}

/**
 * Call attempt columns written at dispatch. Empty when the flow is off, which
 * keeps the insert identical to today's.
 */
export function hybridAttemptFields(
  decision: EndingDecision,
  initiatedAt: Date,
  env: NodeJS.ProcessEnv = process.env,
):
  | Record<string, never>
  | { callPhase: 'dialing'; phaseHistory: PhaseEntry[]; callEnding: CallEnding; callEndingReason: EndingReason } {
  if (!hybridCallFlowEnabled(env)) return {};
  return {
    callPhase: 'dialing',
    phaseHistory: [{ phase: 'dialing', at: initiatedAt.toISOString() }],
    callEnding: decision.ending,
    callEndingReason: decision.reason,
  };
}
