// ─────────────────────────────────────────────────────────────────────────────
// CollectRx AR Engine — Durable Call Lifecycle State Machine
//
// Canadian carrier IVRs drop calls, hang on hold indefinitely, and time out.
// This module tracks a single call attempt's progress through a fixed set of
// states so that a drop mid-sequence is a resumable fact in the record, not a
// silently lost attempt.
//
// Relationship to the existing desk-live vocabulary:
//   `src/types/frontDesk.ts` LiveCallState is the UI-facing projection of a
//   call's current status ('dialing' | 'ivr_navigation' | 'rep_connected' | ...).
//   That type has no state for the hold-queue phase the Hold_Sentinel agent
//   owns (see CLAUDE.md's 2026-07-30 correction — Hold_Sentinel was originally
//   missing from the docs and from `vapiDeskEvents.ts`'s agent→state mapping).
//   `CallLifecycleState.Queue_Hold` below fills that gap. `toLiveCallState()`
//   projects this machine's richer state set onto the existing desk vocabulary
//   for callers that want to reuse today's UI without adopting the full model.
//
// CARRIER_BLOCK PROTOCOL — this is the most critical operational safety rule
// in the whole system (CLAUDE.md). Any transition that would place a real
// phone call (Dialing, IVR_Navigation) MUST be gated on the CARRIER_BLOCK
// flag. `CallLifecycleMachine.transition()` enforces this by requiring an
// `isCarrierBlocked` predicate at construction time — there is no code path
// in this file that can dial without consulting it first.
// ─────────────────────────────────────────────────────────────────────────────

export const CALL_LIFECYCLE_STATES = [
  'Claim_Queued',
  'Dialing',
  'IVR_Navigation',
  'Queue_Hold',
  'Agent_Connected',
  'Adjudication_Extracting',
  'Sync_Pending',
  'Success',
  'Failed',
] as const;

export type CallLifecycleState = (typeof CALL_LIFECYCLE_STATES)[number];

const TERMINAL_STATES: ReadonlySet<CallLifecycleState> = new Set(['Success', 'Failed']);

/** States that place or maintain a live phone connection — CARRIER_BLOCK-gated. */
const DIAL_GATED_STATES: ReadonlySet<CallLifecycleState> = new Set(['Dialing', 'IVR_Navigation']);

/**
 * Valid forward/retry edges. `Failed -> Claim_Queued` is the durable-retry
 * edge: a dropped call re-enters the queue rather than vanishing. Terminal
 * states (`Success`, `Failed`) otherwise have no outgoing edges — closing a
 * claim is closing it; a new attempt is a new record, not a mutation of this
 * one (mirrors `CallAttempt` being append-only per Vapi call id).
 */
const TRANSITIONS: Record<CallLifecycleState, readonly CallLifecycleState[]> = {
  Claim_Queued: ['Dialing', 'Failed'],
  Dialing: ['IVR_Navigation', 'Queue_Hold', 'Failed'],
  IVR_Navigation: ['Queue_Hold', 'Agent_Connected', 'Failed'],
  Queue_Hold: ['Agent_Connected', 'Failed'],
  Agent_Connected: ['Adjudication_Extracting', 'Failed'],
  Adjudication_Extracting: ['Sync_Pending', 'Failed'],
  Sync_Pending: ['Success', 'Failed'],
  Success: [],
  Failed: ['Claim_Queued'],
};

/** Published transition table — mirrors `CLAIM_ROUTER_DECISION_TABLE`'s pattern for docs/UI. */
export const CALL_LIFECYCLE_TRANSITION_TABLE: ReadonlyArray<{
  from: CallLifecycleState;
  to: readonly CallLifecycleState[];
}> = CALL_LIFECYCLE_STATES.map((from) => ({ from, to: TRANSITIONS[from] }));

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: CallLifecycleState,
    public readonly to: CallLifecycleState,
  ) {
    super(`[stateMachine] Invalid transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export class CarrierBlockedError extends Error {
  constructor(public readonly carrierId: string) {
    super(`[stateMachine] Refusing to dial — CARRIER_BLOCK is active for carrier "${carrierId}"`);
    this.name = 'CarrierBlockedError';
  }
}

/**
 * Compute the next state for a requested transition. Idempotent: requesting
 * the state the attempt is already in is a no-op (not an error) so that a
 * retried webhook or a replayed status-update never fails the caller — the
 * same idempotency guarantee `CallAttempt.vapiCallId` gives at the DB layer.
 */
export function computeNextState(
  current: CallLifecycleState,
  requested: CallLifecycleState,
): CallLifecycleState {
  if (current === requested) return current;
  const allowed = TRANSITIONS[current];
  if (!allowed.includes(requested)) {
    throw new InvalidTransitionError(current, requested);
  }
  return requested;
}

export function isTerminalState(state: CallLifecycleState): boolean {
  return TERMINAL_STATES.has(state);
}

// ---------------------------------------------------------------------------
// Durable record + pluggable store
// ---------------------------------------------------------------------------

export interface CallLifecycleTransitionRecord {
  attemptId: string;
  fromState: CallLifecycleState;
  toState: CallLifecycleState;
  occurredAt: Date;
  /** Caller-supplied dedup key (e.g. Vapi webhook delivery id) for exactly-once bookkeeping. */
  idempotencyKey: string | null;
}

export interface CallLifecycleAttemptRecord {
  attemptId: string;
  claimId: string;
  carrierId: string;
  currentState: CallLifecycleState;
  updatedAt: Date;
  history: CallLifecycleTransitionRecord[];
}

/**
 * Storage seam. The in-memory implementation below is the default and is
 * sufficient for a single-process worker; a Prisma-backed implementation can
 * satisfy this same interface by mapping `currentState` onto
 * `CallAttempt.liveState` (via `toLiveCallState`) without this module taking
 * a Prisma dependency.
 */
export interface CallLifecycleStore {
  load(attemptId: string): Promise<CallLifecycleAttemptRecord | null>;
  save(record: CallLifecycleAttemptRecord): Promise<void>;
  listAll(): Promise<CallLifecycleAttemptRecord[]>;
}

export class InMemoryCallLifecycleStore implements CallLifecycleStore {
  private readonly records = new Map<string, CallLifecycleAttemptRecord>();

  async load(attemptId: string): Promise<CallLifecycleAttemptRecord | null> {
    const record = this.records.get(attemptId);
    return record ? { ...record, history: [...record.history] } : null;
  }

  async save(record: CallLifecycleAttemptRecord): Promise<void> {
    this.records.set(record.attemptId, { ...record, history: [...record.history] });
  }

  async listAll(): Promise<CallLifecycleAttemptRecord[]> {
    return [...this.records.values()].map((r) => ({ ...r, history: [...r.history] }));
  }
}

export type CarrierBlockGuard = (carrierId: string) => Promise<boolean> | boolean;

export interface TransitionOptions {
  idempotencyKey?: string;
  now?: Date;
}

/**
 * Orchestrates transitions for a single attempt against a store, enforcing
 * the CARRIER_BLOCK gate before any dial-capable state.
 */
export class CallLifecycleMachine {
  constructor(
    private readonly store: CallLifecycleStore,
    private readonly isCarrierBlocked: CarrierBlockGuard,
  ) {}

  async start(attemptId: string, claimId: string, carrierId: string, now = new Date()): Promise<CallLifecycleAttemptRecord> {
    const existing = await this.store.load(attemptId);
    if (existing) return existing;
    const record: CallLifecycleAttemptRecord = {
      attemptId,
      claimId,
      carrierId,
      currentState: 'Claim_Queued',
      updatedAt: now,
      history: [],
    };
    await this.store.save(record);
    return record;
  }

  async transition(
    attemptId: string,
    toState: CallLifecycleState,
    opts: TransitionOptions = {},
  ): Promise<CallLifecycleAttemptRecord> {
    const record = await this.store.load(attemptId);
    if (!record) {
      throw new Error(`[stateMachine] transition() called before start() for attempt "${attemptId}"`);
    }

    // Idempotent replay guard: an already-applied idempotency key is a no-op.
    if (
      opts.idempotencyKey &&
      record.history.some((h) => h.idempotencyKey === opts.idempotencyKey)
    ) {
      return record;
    }

    if (DIAL_GATED_STATES.has(toState) && (await this.isCarrierBlocked(record.carrierId))) {
      throw new CarrierBlockedError(record.carrierId);
    }

    const now = opts.now ?? new Date();
    const nextState = computeNextState(record.currentState, toState);

    if (nextState === record.currentState && toState === record.currentState) {
      // True no-op replay — still record it for audit continuity.
      const noop: CallLifecycleTransitionRecord = {
        attemptId,
        fromState: record.currentState,
        toState,
        occurredAt: now,
        idempotencyKey: opts.idempotencyKey ?? null,
      };
      const updated: CallLifecycleAttemptRecord = {
        ...record,
        updatedAt: now,
        history: [...record.history, noop],
      };
      await this.store.save(updated);
      return updated;
    }

    const transitionRecord: CallLifecycleTransitionRecord = {
      attemptId,
      fromState: record.currentState,
      toState: nextState,
      occurredAt: now,
      idempotencyKey: opts.idempotencyKey ?? null,
    };
    const updated: CallLifecycleAttemptRecord = {
      attemptId: record.attemptId,
      claimId: record.claimId,
      carrierId: record.carrierId,
      currentState: nextState,
      updatedAt: now,
      history: [...record.history, transitionRecord],
    };
    await this.store.save(updated);
    return updated;
  }
}

// ---------------------------------------------------------------------------
// Stall detection — "if a call drops 25 minutes in" recovery
// ---------------------------------------------------------------------------

export const DEFAULT_STALL_THRESHOLD_MS = 25 * 60_000;
/** Mirrors CLAUDE.md "Maximum 3 call attempts per claim". */
export const DEFAULT_MAX_ATTEMPTS = 3;

export type StallRecoveryAction = 'RETRY' | 'HUMAN_ESCALATION';

export interface StalledAttempt {
  attemptId: string;
  claimId: string;
  carrierId: string;
  state: CallLifecycleState;
  stalledForMs: number;
  recommendedAction: StallRecoveryAction;
}

/**
 * Pure scan for attempts stuck in a non-terminal state past the stall
 * threshold — the durability contract the AR engine's dropped-call recovery
 * loop polls on. Kept pure (no store/IO) so it is trivially unit-testable
 * and reusable from a scheduled job or an ad-hoc ops query alike.
 */
export function detectStalledAttempts(
  records: readonly CallLifecycleAttemptRecord[],
  attemptCounts: ReadonlyMap<string, number>,
  now: Date = new Date(),
  staleAfterMs: number = DEFAULT_STALL_THRESHOLD_MS,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): StalledAttempt[] {
  const stalled: StalledAttempt[] = [];
  for (const record of records) {
    if (isTerminalState(record.currentState)) continue;
    const stalledForMs = now.getTime() - record.updatedAt.getTime();
    if (stalledForMs < staleAfterMs) continue;
    const attemptsSoFar = attemptCounts.get(record.claimId) ?? 0;
    stalled.push({
      attemptId: record.attemptId,
      claimId: record.claimId,
      carrierId: record.carrierId,
      state: record.currentState,
      stalledForMs,
      recommendedAction: attemptsSoFar >= maxAttempts ? 'HUMAN_ESCALATION' : 'RETRY',
    });
  }
  return stalled;
}

// ---------------------------------------------------------------------------
// Metrics helper — feeds `reconciler.ts`'s "Average Hold Time"
// ---------------------------------------------------------------------------

/**
 * Sum of wall-clock time spent in `Queue_Hold` across an attempt's history.
 * Returns null when the attempt never entered a hold — distinct from a hold
 * of zero duration, so callers averaging this can exclude true non-holds.
 */
export function computeHoldSecondsFromHistory(
  history: readonly CallLifecycleTransitionRecord[],
): number | null {
  let holdEnteredAt: Date | null = null;
  let totalMs = 0;
  let everHeld = false;

  for (const entry of history) {
    if (entry.toState === 'Queue_Hold') {
      holdEnteredAt = entry.occurredAt;
      everHeld = true;
      continue;
    }
    if (holdEnteredAt && entry.fromState === 'Queue_Hold') {
      totalMs += entry.occurredAt.getTime() - holdEnteredAt.getTime();
      holdEnteredAt = null;
    }
  }

  if (!everHeld) return null;
  return Math.round(totalMs / 1000);
}

// ---------------------------------------------------------------------------
// Projection onto the existing desk-live vocabulary
// ---------------------------------------------------------------------------

/**
 * Return type intentionally matches `src/types/frontDesk.ts` LiveCallState's
 * string literals without importing that module, to keep this engine
 * decoupled from the front-desk UI layer. Keep in lockstep by hand if either
 * vocabulary changes.
 */
export type LiveDeskStateProjection =
  | 'queued'
  | 'dialing'
  | 'ivr_navigation'
  | 'rep_connected'
  | 'resolving'
  | 'completed'
  | 'failed';

export function toLiveCallState(state: CallLifecycleState): LiveDeskStateProjection {
  switch (state) {
    case 'Claim_Queued':
      return 'queued';
    case 'Dialing':
      return 'dialing';
    case 'IVR_Navigation':
      return 'ivr_navigation';
    case 'Queue_Hold':
      // No 1:1 desk state today (see file header) — closest live signal is
      // "still connected, still on the line" while Hold_Sentinel waits.
      return 'ivr_navigation';
    case 'Agent_Connected':
      return 'rep_connected';
    case 'Adjudication_Extracting':
    case 'Sync_Pending':
      return 'resolving';
    case 'Success':
      return 'completed';
    case 'Failed':
      return 'failed';
  }
}
