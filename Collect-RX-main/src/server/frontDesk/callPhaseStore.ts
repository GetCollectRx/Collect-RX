/**
 * Persists the hybrid call flow phase history on the call attempt.
 *
 * Every entry point is a no-op unless HYBRID_CALL_FLOW is on, and none of them
 * throw: phase tracking is observability and must never fail a webhook or a
 * dispatch. Writes are compare-and-set on the current phase, so two webhooks
 * racing on one call cannot interleave a stale history over a newer one.
 *
 * PHI: only phase names, timestamps and counts are stored or logged.
 */
import type { PrismaClient } from '@prisma/client';
import { logger } from '../observability/logger.js';
import {
  applyTransition,
  hybridCallFlowEnabled,
  parsePhaseHistory,
  segmentSeconds,
  type CallPhase,
  type PhaseEntry,
} from './callPhase.js';

const MAX_WRITE_ATTEMPTS = 3;

export interface RecordPhaseOptions {
  /** When the event happened, if the source says so. Defaults to now. */
  at?: Date;
  /** Closes the call: segment seconds are computed and stored. */
  closedAt?: Date;
}

/**
 * Applies one or more phases in order. Steps that are not legal from the
 * current phase are skipped, so a late signal cannot rewind a call.
 */
export async function recordCallPhase(
  prisma: PrismaClient,
  callAttemptId: string,
  phases: CallPhase | readonly CallPhase[],
  options: RecordPhaseOptions = {},
): Promise<void> {
  if (!hybridCallFlowEnabled()) return;
  const steps = typeof phases === 'string' ? [phases] : [...phases];
  const at = options.at ?? new Date();

  try {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const row = await prisma.callAttempt.findUnique({
        where: { id: callAttemptId },
        select: { callPhase: true, phaseHistory: true, initiatedAt: true },
      });
      if (!row) return;

      let history: PhaseEntry[] =
        parsePhaseHistory(row.phaseHistory) ?? [{ phase: 'dialing', at: row.initiatedAt.toISOString() }];
      let changed = false;
      for (const step of steps) {
        const result = applyTransition(history, step, at);
        if (result.applied) {
          history = result.history;
          changed = true;
        }
      }
      if (!changed && !options.closedAt) return;

      const last = history[history.length - 1];
      if (!last) return;
      const seconds = options.closedAt ? segmentSeconds(history, options.closedAt) : {};
      const written = await prisma.callAttempt.updateMany({
        where: { id: callAttemptId, callPhase: row.callPhase },
        data: {
          callPhase: last.phase,
          phaseHistory: history,
          ...seconds,
        },
      });
      if (written.count === 1) return;
    }
    logger.warn('[call-phase] gave up after concurrent updates', { callAttemptId });
  } catch (error) {
    logger.warn('[call-phase] could not record phase (non-fatal)', { callAttemptId, error });
  }
}

/** Closes a call: enters wrap_up at the end time and stores segment seconds. */
export function closeCallPhases(prisma: PrismaClient, callAttemptId: string, endedAt: Date): Promise<void> {
  return recordCallPhase(prisma, callAttemptId, 'wrap_up', { at: endedAt, closedAt: endedAt });
}

/** Same as recordCallPhase for callers that only hold the Vapi call id (webhook tool calls). */
export async function recordCallPhaseByVapiId(
  prisma: PrismaClient,
  vapiCallId: string,
  phases: CallPhase | readonly CallPhase[],
  options: RecordPhaseOptions = {},
): Promise<void> {
  if (!hybridCallFlowEnabled()) return;
  try {
    const attempt = await prisma.callAttempt.findUnique({ where: { vapiCallId }, select: { id: true } });
    if (attempt) await recordCallPhase(prisma, attempt.id, phases, options);
  } catch (error) {
    logger.warn('[call-phase] could not look up call (non-fatal)', { vapiCallId, error });
  }
}
