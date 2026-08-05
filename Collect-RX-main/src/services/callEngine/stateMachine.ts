// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Durable Call State Machine
//
// Canadian carrier IVRs time out, hold queues run long, and mobile/VoIP legs
// drop mid-call. This module gives the AR engine one formal, idempotent state
// machine for a claim's call lifecycle so a dropped call resumes (or fails
// loudly) instead of silently corrupting `CallQueue`/`InsuranceClaim` state.
//
// This is new coordination logic, not a replacement for what already exists:
//   - `../../types/frontDesk.ts` `LiveCallState` still drives the live desk
//     console UI — `toLiveCallState()` below maps into it so the console
//     keeps working unchanged.
//   - `../../outcome/processor.ts` still classifies the *content* of a
//     finished call (RESOLVED/DENIED/...). This module tracks *where the
//     call is* while it's still happening.
//   - `queueEngine.ts`'s 3-hour stale-attempt watchdog still owns cleanup of
//     attempts that never got a webhook at all. `classifyStaleCall()` here is
//     a tighter, mid-call check (default 25 min) for a sequence that started
//     but stalled partway through — see the module docstring on that function.
//
// CARRIER_BLOCK: `transition()` refuses to enter DIALING when the caller's
// `isCarrierBlocked` hook reports the carrier is blocked — every caller must
// supply that hook (see `carrierBlockService.ts`'s block table as the source
// of truth). This is the one non-negotiable guard baked into the transition
// table itself rather than left to callers to remember.
// ─────────────────────────────────────────────────────────────────────────────

import type { CallOutcome, QueueStatus } from '@prisma/client';
import type { LiveCallState } from '../../types/frontDesk';

// ---------------------------------------------------------------------------
// States & events
// ---------------------------------------------------------------------------

export const CALL_ENGINE_STATES = [
  'CLAIM_QUEUED',
  'DIALING',
  'IVR_NAVIGATION',
  'QUEUE_HOLD',
  'AGENT_CONNECTED',
  'ADJUDICATION_EXTRACTING',
  'SYNC_PENDING',
  'SUCCESS',
  'FAILED',
] as const;

export type CallEngineState = (typeof CALL_ENGINE_STATES)[number];

/** States where a call is actively in flight — used by the stale-call watchdog. */
const IN_FLIGHT_STATES: ReadonlySet<CallEngineState> = new Set([
  'DIALING',
  'IVR_NAVIGATION',
  'QUEUE_HOLD',
  'AGENT_CONNECTED',
  'ADJUDICATION_EXTRACTING',
  'SYNC_PENDING',
]);

export const TERMINAL_STATES: ReadonlySet<CallEngineState> = new Set(['SUCCESS', 'FAILED']);

export type CallEngineEvent =
  | { type: 'DISPATCH_REQUESTED' }
  | { type: 'DIAL_CONNECTED' }
  | { type: 'IVR_MENU_REACHED' }
  | { type: 'HOLD_MUSIC_DETECTED' }
  | { type: 'LIVE_REP_DETECTED' }
  | { type: 'TRANSCRIPT_EXTRACTION_STARTED' }
  | { type: 'ADJUDICATION_PARSED' }
  | { type: 'SYNC_CONFIRMED' }
  | { type: 'CALL_DROPPED'; reason: string }
  | { type: 'DIAL_FAILED'; reason: string }
  | { type: 'MAX_ATTEMPTS_EXCEEDED' }
  | { type: 'RETRY_SCHEDULED' };

// ---------------------------------------------------------------------------
// Transition table
//
// Keyed by [fromState][eventType] -> toState. Absent entries are invalid
// transitions and `transition()` throws rather than guessing. FAILED can loop
// back to CLAIM_QUEUED via RETRY_SCHEDULED — the caller decides whether a
// retry is allowed (attempts < 3, per the Call Rules in CLAUDE.md) before
// emitting that event; this table only encodes what's structurally legal.
// ---------------------------------------------------------------------------

type TransitionTable = {
  [S in CallEngineState]?: {
    [E in CallEngineEvent['type']]?: CallEngineState;
  };
};

const TRANSITIONS: TransitionTable = {
  CLAIM_QUEUED: {
    DISPATCH_REQUESTED: 'DIALING',
  },
  DIALING: {
    DIAL_CONNECTED: 'IVR_NAVIGATION',
    DIAL_FAILED: 'FAILED',
    CALL_DROPPED: 'FAILED',
  },
  IVR_NAVIGATION: {
    IVR_MENU_REACHED: 'IVR_NAVIGATION',
    HOLD_MUSIC_DETECTED: 'QUEUE_HOLD',
    LIVE_REP_DETECTED: 'AGENT_CONNECTED',
    CALL_DROPPED: 'FAILED',
  },
  QUEUE_HOLD: {
    LIVE_REP_DETECTED: 'AGENT_CONNECTED',
    CALL_DROPPED: 'FAILED',
  },
  AGENT_CONNECTED: {
    TRANSCRIPT_EXTRACTION_STARTED: 'ADJUDICATION_EXTRACTING',
    CALL_DROPPED: 'FAILED',
  },
  ADJUDICATION_EXTRACTING: {
    ADJUDICATION_PARSED: 'SYNC_PENDING',
    CALL_DROPPED: 'FAILED',
  },
  SYNC_PENDING: {
    SYNC_CONFIRMED: 'SUCCESS',
    CALL_DROPPED: 'FAILED',
  },
  SUCCESS: {},
  FAILED: {
    RETRY_SCHEDULED: 'CLAIM_QUEUED',
    MAX_ATTEMPTS_EXCEEDED: 'FAILED',
  },
};

export class InvalidCallStateTransitionError extends Error {
  constructor(
    public readonly fromState: CallEngineState,
    public readonly event: CallEngineEvent,
  ) {
    super(`[CallStateMachine] cannot apply event "${event.type}" from state "${fromState}"`);
    this.name = 'InvalidCallStateTransitionError';
  }
}

export class CarrierBlockedError extends Error {
  constructor(public readonly carrierId: string) {
    super(`[CallStateMachine] refusing DIALING — carrier "${carrierId}" is CARRIER_BLOCK'd`);
    this.name = 'CarrierBlockedError';
  }
}

/** Pure lookup — throws InvalidCallStateTransitionError instead of returning undefined. */
export function nextState(fromState: CallEngineState, event: CallEngineEvent): CallEngineState {
  const to = TRANSITIONS[fromState]?.[event.type];
  if (!to) throw new InvalidCallStateTransitionError(fromState, event);
  return to;
}

// ---------------------------------------------------------------------------
// Idempotency
//
// Vapi and Twilio both retry webhook delivery on timeout, and the same
// carrier event can legitimately be re-observed (e.g. two "hold music"
// detections in a row). Applying the same (callAttemptId, idempotencyKey)
// pair twice must be a no-op, not a double transition.
// ---------------------------------------------------------------------------

export interface IdempotencyStore {
  hasSeen(key: string): Promise<boolean> | boolean;
  markSeen(key: string): Promise<void> | void;
}

/**
 * In-memory default — fine for a single-process dev/test run. Production
 * should back this with something durable and already shared across
 * replicas; `ProcessedVapiWebhook` (bodyHash-keyed, see vapiWebhook.ts)
 * already exists for the webhook-delivery layer and is the natural store to
 * adapt here rather than inventing a new table.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly seen = new Set<string>();
  constructor(private readonly maxSize = 10_000) {}

  hasSeen(key: string): boolean {
    return this.seen.has(key);
  }

  markSeen(key: string): void {
    if (this.seen.size >= this.maxSize) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.add(key);
  }
}

// ---------------------------------------------------------------------------
// Durable record + persistence adapter
// ---------------------------------------------------------------------------

export interface CallEngineRecord {
  callAttemptId: string;
  claimId: string;
  carrierId: string;
  state: CallEngineState;
  attempt: number;
  /** Wall-clock time the current state was entered — drives the stale-call check. */
  enteredCurrentStateAt: Date;
  lastEvent: CallEngineEvent | null;
}

export interface CallEngineStateStore {
  load(callAttemptId: string): Promise<CallEngineRecord | null>;
  save(record: CallEngineRecord): Promise<void>;
}

export interface TransitionOptions {
  /** Dedupe key for this specific event delivery — e.g. the Vapi webhook body hash. */
  idempotencyKey: string;
  /** Required only when the event would move the record into DIALING. */
  isCarrierBlocked?: (carrierId: string) => Promise<boolean> | boolean;
}

export interface TransitionResult {
  record: CallEngineRecord;
  /** False when the event was a duplicate delivery and no transition occurred. */
  applied: boolean;
}

/**
 * Apply one event to a call's durable state, idempotently.
 *
 * Loads the current record, no-ops if `idempotencyKey` was already seen,
 * otherwise computes `nextState()`, runs the CARRIER_BLOCK guard on any
 * transition into DIALING, persists, and returns the updated record. Throws
 * `InvalidCallStateTransitionError` / `CarrierBlockedError` on rejection —
 * callers should catch, log, and route the claim to human review rather than
 * crash the queue tick.
 */
export async function applyEvent(
  store: CallEngineStateStore,
  idempotency: IdempotencyStore,
  callAttemptId: string,
  event: CallEngineEvent,
  options: TransitionOptions,
): Promise<TransitionResult> {
  const dedupeKey = `${callAttemptId}:${options.idempotencyKey}`;
  if (await idempotency.hasSeen(dedupeKey)) {
    const existing = await store.load(callAttemptId);
    if (!existing) {
      throw new Error(`[CallStateMachine] idempotency key seen but no record for ${callAttemptId}`);
    }
    return { record: existing, applied: false };
  }

  const current = await store.load(callAttemptId);
  if (!current) {
    throw new Error(`[CallStateMachine] no record found for callAttemptId=${callAttemptId}`);
  }

  const to = nextState(current.state, event);

  if (to === 'DIALING') {
    const blocked = await options.isCarrierBlocked?.(current.carrierId);
    if (blocked) throw new CarrierBlockedError(current.carrierId);
  }

  const updated: CallEngineRecord = {
    ...current,
    state: to,
    attempt: to === 'DIALING' && current.state !== 'DIALING' ? current.attempt + 1 : current.attempt,
    enteredCurrentStateAt: new Date(),
    lastEvent: event,
  };

  await store.save(updated);
  await idempotency.markSeen(dedupeKey);
  return { record: updated, applied: true };
}

// ---------------------------------------------------------------------------
// Stale / dropped-call detection
//
// "If a call drops 25 minutes into a sequence, the state is saved locally so
// the engine can retry, alert a team member, or resume without corrupting
// the local practice management software ledger database." This function is
// the check side of that: it never mutates state itself — callers decide
// whether to emit CALL_DROPPED, alert staff, or both.
// ---------------------------------------------------------------------------

export interface StaleCallCheck {
  isStale: boolean;
  ageMs: number;
}

const DEFAULT_STALE_THRESHOLD_MS = 25 * 60 * 1000;

export function classifyStaleCall(
  record: CallEngineRecord,
  now: Date = new Date(),
  staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
): StaleCallCheck {
  const ageMs = now.getTime() - record.enteredCurrentStateAt.getTime();
  const isStale = IN_FLIGHT_STATES.has(record.state) && ageMs >= staleThresholdMs;
  return { isStale, ageMs };
}

// ---------------------------------------------------------------------------
// Mapping into existing enums/types — no schema changes required to adopt
// this module against current `CallAttempt`/`CallQueue` columns.
// ---------------------------------------------------------------------------

const TO_LIVE_CALL_STATE: Record<CallEngineState, LiveCallState> = {
  CLAIM_QUEUED: 'queued',
  DIALING: 'dialing',
  IVR_NAVIGATION: 'ivr_navigation',
  QUEUE_HOLD: 'ivr_navigation',
  AGENT_CONNECTED: 'rep_connected',
  ADJUDICATION_EXTRACTING: 'resolving',
  SYNC_PENDING: 'resolving',
  SUCCESS: 'completed',
  FAILED: 'failed',
};

/** Project onto the desk console's existing `CallAttempt.liveState` values. */
export function toLiveCallState(state: CallEngineState): LiveCallState {
  return TO_LIVE_CALL_STATE[state];
}

const TO_QUEUE_STATUS: Record<CallEngineState, QueueStatus> = {
  CLAIM_QUEUED: 'PENDING',
  DIALING: 'IN_PROGRESS',
  IVR_NAVIGATION: 'IN_PROGRESS',
  QUEUE_HOLD: 'IN_PROGRESS',
  AGENT_CONNECTED: 'IN_PROGRESS',
  ADJUDICATION_EXTRACTING: 'IN_PROGRESS',
  SYNC_PENDING: 'IN_PROGRESS',
  SUCCESS: 'COMPLETED',
  FAILED: 'PENDING',
};

/** Project onto `CallQueue.status` — FAILED maps back to PENDING so a retry re-enters the tick loop. */
export function toQueueStatus(state: CallEngineState): QueueStatus {
  return TO_QUEUE_STATUS[state];
}

/** Only meaningful once the machine has reached a terminal state. */
export function toCallOutcome(state: 'SUCCESS' | 'FAILED'): CallOutcome {
  return state === 'SUCCESS' ? 'RESOLVED' : 'FAILED';
}
