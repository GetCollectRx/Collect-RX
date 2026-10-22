/**
 * request_staff_handoff, restricted and made idempotent.
 *
 * Authorization comes only from the server-side CallAttempt row for the Vapi
 * call (isHumanAssisted, written by the dispatcher when it created the call).
 * Nothing the model sends in tool arguments can grant a transfer.
 *
 * Transfer state and notification state are separate. Once Vapi has accepted
 * the transfer, a notification failure is logged and never reported to the
 * model as a failed handoff. An HTTP acceptance is not evidence that staff
 * answered, so no result string claims staff are connected.
 *
 * Duplicate and concurrent invocations are serialised by the store's atomic
 * claim (a unique row per Vapi call). An ambiguous provider response (timeout
 * or network failure) settles as OUTCOME_UNKNOWN and is never retried
 * automatically. A definitive provider rejection settles as FAILED and may be
 * retried by a later invocation.
 */

import type { PrismaClient } from '@prisma/client';

export type StaffHandoffState = 'REQUESTED' | 'PROVIDER_ACCEPTED' | 'FAILED' | 'OUTCOME_UNKNOWN';

export type ClaimResult =
  | { kind: 'claimed' }
  | { kind: 'existing'; state: StaffHandoffState };

export interface StaffHandoffStore {
  /**
   * Atomically take ownership of a transfer attempt for this call.
   * Succeeds only for an authorized call whose state is unset or FAILED. Any other
   * state is returned unchanged and must not be retried.
   */
  claim(vapiCallId: string, practiceId: string): Promise<ClaimResult>;
  /** Move a REQUESTED row to a terminal state. */
  settle(
    vapiCallId: string,
    state: Exclude<StaffHandoffState, 'REQUESTED'>,
    reasonCode: string,
  ): Promise<void>;
}

export interface CallAuthorization {
  isHumanAssisted: boolean;
  practiceId: string;
}

export interface StaffHandoffDeps {
  store: StaffHandoffStore;
  /** Server-side CallAttempt lookup by Vapi call id. Null when no row exists yet. */
  findCallAuthorization(vapiCallId: string): Promise<CallAuthorization | null>;
  getEscalationPhone(practiceId: string): Promise<string | null>;
  transfer(vapiCallId: string, toPhoneNumber: string): Promise<void>;
  isAmbiguousTransferError(err: unknown): boolean;
  /** Dashboard and staff notification. Failures are contained by the caller. */
  notifyStaff(
    practiceId: string,
    vapiCallId: string,
    outcome: 'accepted' | 'unconfirmed',
  ): Promise<void>;
  /** Script returned to the agent when the transfer cannot proceed. */
  missedHandoffScript(practiceId: string): Promise<string>;
  logError(message: string, err?: unknown): void;
  /** Retries for a missing CallAttempt row (the row is written just after dispatch). */
  lookupAttempts?: number;
  lookupDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export const HANDOFF_RESULT = {
  REFUSED:
    'HANDOFF REFUSED - this call is not a staff-assisted call. Do not transfer. Stay silent and keep listening.',
  INITIATED:
    'HANDOFF INITIATED - the telephony provider accepted the transfer. Stop talking; do not engage further.',
  ALREADY_INITIATED:
    'HANDOFF ALREADY INITIATED - the transfer for this call was already accepted. Stop talking; do not engage further.',
  UNKNOWN_DO_NOT_RETRY:
    'HANDOFF STATUS UNKNOWN - a transfer attempt on this call has not been confirmed. Do not retry. Stay silent and keep listening.',
  CONTEXT_MISSING:
    'HANDOFF FAILED - missing call or practice context. Stay silent and keep listening.',
} as const;

async function lookupAuthorization(
  deps: StaffHandoffDeps,
  vapiCallId: string,
): Promise<CallAuthorization | null> {
  const attempts = Math.max(1, deps.lookupAttempts ?? 3);
  const delay = deps.lookupDelayMs ?? 250;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < attempts; i++) {
    const found = await deps.findCallAuthorization(vapiCallId);
    if (found) return found;
    if (i < attempts - 1) await sleep(delay);
  }
  return null;
}

async function settleSafely(
  deps: StaffHandoffDeps,
  vapiCallId: string,
  state: Exclude<StaffHandoffState, 'REQUESTED'>,
  reasonCode: string,
): Promise<void> {
  try {
    await deps.store.settle(vapiCallId, state, reasonCode);
  } catch (err) {
    // The row stays REQUESTED, which later invocations treat as unknown and
    // never retry. That is the safe direction.
    deps.logError(`staff handoff state write failed (${state})`, err);
  }
}

export async function handleStaffHandoff(
  deps: StaffHandoffDeps,
  input: { vapiCallId: string | undefined; practiceId: string | undefined },
): Promise<string> {
  const { vapiCallId, practiceId } = input;
  if (!vapiCallId || !practiceId) {
    deps.logError('request_staff_handoff missing vapiCallId or practiceId');
    return HANDOFF_RESULT.CONTEXT_MISSING;
  }

  // 1. Authorization: server-side call record only.
  const auth = await lookupAuthorization(deps, vapiCallId);
  if (!auth || !auth.isHumanAssisted || auth.practiceId !== practiceId) {
    deps.logError('request_staff_handoff refused: call is not authorized for staff transfer');
    return HANDOFF_RESULT.REFUSED;
  }

  // 2. A transfer target is required before any state is claimed.
  const phone = (await deps.getEscalationPhone(practiceId))?.trim();
  if (!phone) {
    deps.logError(`request_staff_handoff: no escalationPhoneNumber for practice ${practiceId}`);
    return deps.missedHandoffScript(practiceId);
  }

  // 3. Atomic claim: duplicate and concurrent invocations stop here.
  const claim = await deps.store.claim(vapiCallId, practiceId);
  if (claim.kind === 'existing') {
    if (claim.state === 'PROVIDER_ACCEPTED') return HANDOFF_RESULT.ALREADY_INITIATED;
    return HANDOFF_RESULT.UNKNOWN_DO_NOT_RETRY;
  }

  // 4. Transfer. Only the claiming invocation reaches this point.
  try {
    await deps.transfer(vapiCallId, phone);
  } catch (err) {
    if (deps.isAmbiguousTransferError(err)) {
      deps.logError('request_staff_handoff: provider outcome unknown; not retrying', err);
      await settleSafely(deps, vapiCallId, 'OUTCOME_UNKNOWN', 'PROVIDER_OUTCOME_UNKNOWN');
      await notifySafely(deps, practiceId, vapiCallId, 'unconfirmed');
      return HANDOFF_RESULT.UNKNOWN_DO_NOT_RETRY;
    }
    deps.logError('request_staff_handoff: provider rejected transfer', err);
    await settleSafely(deps, vapiCallId, 'FAILED', 'PROVIDER_REJECTED');
    return deps.missedHandoffScript(practiceId);
  }

  // 5. Accepted. Recording and notification failures do not change the result.
  await settleSafely(deps, vapiCallId, 'PROVIDER_ACCEPTED', 'PROVIDER_ACCEPTED');
  await notifySafely(deps, practiceId, vapiCallId, 'accepted');
  return HANDOFF_RESULT.INITIATED;
}

async function notifySafely(
  deps: StaffHandoffDeps,
  practiceId: string,
  vapiCallId: string,
  outcome: 'accepted' | 'unconfirmed',
): Promise<void> {
  try {
    await deps.notifyStaff(practiceId, vapiCallId, outcome);
  } catch (err) {
    deps.logError(`staff notification failed (${outcome}); transfer result unchanged`, err);
  }
}

/**
 * Persists handoff state on call_attempts. The conditional updateMany is the
 * concurrency guard: under READ COMMITTED, two invocations cannot both match
 * the WHERE clause and both see count 1 for the same row.
 */
export function createPrismaStaffHandoffStore(prisma: PrismaClient): StaffHandoffStore {
  return {
    async claim(vapiCallId) {
      const won = await prisma.callAttempt.updateMany({
        where: {
          vapiCallId,
          isHumanAssisted: true,
          OR: [{ staffHandoffState: null }, { staffHandoffState: 'FAILED' }],
        },
        data: { staffHandoffState: 'REQUESTED', staffHandoffReason: null, staffHandoffAt: new Date() },
      });
      if (won.count === 1) return { kind: 'claimed' };
      const row = await prisma.callAttempt.findUnique({
        where: { vapiCallId },
        select: { staffHandoffState: true },
      });
      return { kind: 'existing', state: row?.staffHandoffState ?? 'OUTCOME_UNKNOWN' };
    },
    async settle(vapiCallId, state, reasonCode) {
      // Only the invocation that claimed the row may leave REQUESTED.
      await prisma.callAttempt.updateMany({
        where: { vapiCallId, staffHandoffState: 'REQUESTED' },
        data: { staffHandoffState: state, staffHandoffReason: reasonCode },
      });
    },
  };
}

/**
 * Moves transfers stuck in REQUESTED past the window to OUTCOME_UNKNOWN. This
 * only records the state. It never re-dials or re-transfers, so an operator
 * must decide what happened on the live call.
 */
/** Longer than any Vapi transfer request timeout, so a live request is never swept. */
export const STALE_HANDOFF_AFTER_MS = 10 * 60 * 1000;

export async function markStaleStaffHandoffsUnknown(
  prisma: PrismaClient,
  now: Date,
  staleAfterMs: number,
): Promise<number> {
  const cutoff = new Date(now.getTime() - staleAfterMs);
  const result = await prisma.callAttempt.updateMany({
    where: { staffHandoffState: 'REQUESTED', staffHandoffAt: { lt: cutoff } },
    data: { staffHandoffState: 'OUTCOME_UNKNOWN', staffHandoffReason: 'STALE_REQUESTED_NO_SETTLEMENT' },
  });
  return result.count;
}
