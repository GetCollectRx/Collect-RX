/**
 * Hold and Agent Transition Processor
 *
 * Processes Vapi webhook events to track:
 * 1. Call.started event — when hold ends and engagement with rep begins
 * 2. Agent transitions — IVR_Navigator → Hold_Sentinel → Claims_Agent etc.
 * 3. Calculates hold duration and agent dwell time from timestamps
 *
 * This feeds the holdLedger and enables real-time hold monitoring on the front desk.
 */

import { prisma as db } from '../lib/prisma';
import type { VapiWebhookPayload } from '../vapi/client';
import { logger } from '../server/observability/logger';

interface HoldTransitionContext {
  callAttemptId: string;
  vapiCallId: string;
  initiatedAt: Date;
}

/**
 * Process call.started webhook — indicates hold has ended and rep has picked up.
 * Records the actual ring-to-rep time, which becomes the hold duration.
 *
 * For Hold_Sentinel, this is when the agent hears a human voice and knows
 * engagement is real (not just hold music or system prompts).
 */
export async function processCallStarted(
  payload: VapiWebhookPayload,
  context: HoldTransitionContext,
): Promise<void> {
  if (payload.type !== 'call.started' || !payload.call.startedAt) {
    return;
  }

  try {
    const callAttempt = await db.callAttempt.findUnique({
      where: { id: context.callAttemptId },
      select: { id: true, initiatedAt: true },
    });

    if (!callAttempt) {
      logger.warn('[hold-processor] CallAttempt not found for call.started event', {
        callAttemptId: context.callAttemptId,
        vapiCallId: context.vapiCallId,
      });
      return;
    }

    // Calculate hold duration: from when call was initiated (dispatched) to when
    // the call.started webhook arrived (rep answered). This is the customer's
    // hold time waiting for a representative.
    const startedAtTime = new Date(payload.call.startedAt);
    const holdDurationSeconds = Math.round(
      (startedAtTime.getTime() - callAttempt.initiatedAt.getTime()) / 1000
    );

    // Update CallAttempt with hold duration and started timestamp
    await db.callAttempt.update({
      where: { id: context.callAttemptId },
      data: {
        startedAt: startedAtTime,
        holdDurationSeconds: Math.max(0, holdDurationSeconds),
      },
    });

    logger.info('[hold-processor] Recorded hold end and hold duration', {
      callAttemptId: context.callAttemptId,
      holdDurationSeconds,
      startedAt: payload.call.startedAt,
    });

    // Create an initial agent transition record for Hold_Sentinel → Claims_Agent
    // (assuming Vapi moved from Hold_Sentinel to Claims_Agent when rep answered).
    // This provides the baseline for tracking which agent currently has the call.
    await db.callTransition.create({
      data: {
        callAttemptId: context.callAttemptId,
        fromAgent: 'Hold_Sentinel',
        toAgent: 'Claims_Agent',
        transitionedAt: startedAtTime,
        durationSeconds: holdDurationSeconds,
      },
    });
  } catch (error) {
    logger.error('[hold-processor] Failed to process call.started event', {
      error,
      callAttemptId: context.callAttemptId,
      vapiCallId: context.vapiCallId,
    });
    throw error;
  }
}

/**
 * Process agent transition from Vapi analysis payload.
 *
 * Vapi's analysis plan can detect when the active agent changes (e.g., IVR_Navigator
 * completed, Hold_Sentinel took over, or Claims_Agent now has the call). This
 * function extracts those signals and records them as CallTransition entries.
 *
 * Format expected from Vapi analysis.collectrx:
 * {
 *   agentTransition?: {
 *     fromAgent: string;
 *     toAgent: string;
 *     transitionedAt: ISO timestamp;
 *     durationSeconds?: number;
 *   }
 * }
 */
export async function processAgentTransition(
  payload: VapiWebhookPayload,
  context: HoldTransitionContext,
): Promise<void> {
  const transition = (payload.analysis?.collectrx as any)?.agentTransition;
  if (!transition || typeof transition.toAgent !== 'string') {
    return;
  }

  try {
    const transitionTime = new Date(transition.transitionedAt || new Date().toISOString());

    const record = await db.callTransition.create({
      data: {
        callAttemptId: context.callAttemptId,
        fromAgent: transition.fromAgent || undefined,
        toAgent: transition.toAgent,
        transitionedAt: transitionTime,
        durationSeconds: transition.durationSeconds || undefined,
      },
    });

    logger.info('[hold-processor] Recorded agent transition', {
      callAttemptId: context.callAttemptId,
      fromAgent: transition.fromAgent,
      toAgent: transition.toAgent,
      durationSeconds: transition.durationSeconds,
    });

    // If this transition indicates Hold_Sentinel timeout occurred
    // (e.g., Hold_Sentinel → Escalation_Closer with no Claims_Agent engagement),
    // mark the holdTimeoutOccurred flag on the CallAttempt.
    if (transition.holdTimeoutTriggered || transition.toAgent === 'Escalation_Closer') {
      await db.callAttempt.update({
        where: { id: context.callAttemptId },
        data: { holdTimeoutOccurred: true },
      });
    }
  } catch (error) {
    logger.error('[hold-processor] Failed to record agent transition', {
      error,
      callAttemptId: context.callAttemptId,
      transition,
    });
    // Non-fatal — continue processing other webhook data
  }
}

/**
 * Main entry point: process hold and transition events from a Vapi webhook.
 * Called after idempotency/signature validation and metadata validation pass.
 */
export async function processHoldAndTransitions(
  payload: VapiWebhookPayload,
  context: HoldTransitionContext,
): Promise<void> {
  // call.started indicates hold has ended; record it and mark Claims_Agent transition
  if (payload.type === 'call.started') {
    await processCallStarted(payload, context);
  }

  // end-of-call-report may contain agent transition metadata
  if (payload.type === 'call.ended' && payload.analysis?.collectrx) {
    await processAgentTransition(payload, context);
  }

  // status-update could carry mid-call agent transition events in the future
  // (currently not used, but reserved for real-time squad state updates)
}
