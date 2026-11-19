/**
 * Hold and Agent Transition Processor
 *
 * Processes explicit Vapi agent-transition data when it is present.
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
 * A Vapi call.started event means the outbound call connected. It does not
 * prove that a carrier representative answered or that hold ended. Keep this
 * handler as an explicit no-op so callers cannot accidentally reintroduce that
 * unsafe inference.
 */
export async function processCallStarted(
  _payload: VapiWebhookPayload,
  _context: HoldTransitionContext,
): Promise<void> {
  return;
}

const ALLOWED_AGENTS = new Set([
  'IVR_Navigator',
  'Hold_Sentinel',
  'Claims_Agent',
  'Escalation_Closer',
  'Resolution_Closer',
]);

type AgentTransition = {
  fromAgent?: string;
  toAgent: string;
  transitionedAt?: string;
  durationSeconds?: number;
  holdTimeoutTriggered?: boolean;
};

function readAgentTransition(payload: VapiWebhookPayload): AgentTransition | null {
  const collectrx = payload.analysis?.collectrx as unknown;
  if (!collectrx || typeof collectrx !== 'object') return null;
  const candidate = (collectrx as Record<string, unknown>).agentTransition;
  if (!candidate || typeof candidate !== 'object') return null;
  const value = candidate as Record<string, unknown>;
  if (typeof value.toAgent !== 'string' || !ALLOWED_AGENTS.has(value.toAgent)) return null;
  return {
    fromAgent: typeof value.fromAgent === 'string' ? value.fromAgent : undefined,
    toAgent: value.toAgent,
    transitionedAt: typeof value.transitionedAt === 'string' ? value.transitionedAt : undefined,
    durationSeconds: typeof value.durationSeconds === 'number' ? value.durationSeconds : undefined,
    holdTimeoutTriggered: value.holdTimeoutTriggered === true,
  };
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
  const transition = readAgentTransition(payload);
  if (!transition) return;

  try {
    const liveState = transition.toAgent === 'IVR_Navigator'
      ? 'ivr_navigation'
      : transition.toAgent === 'Claims_Agent'
        ? 'rep_connected'
        : transition.toAgent === 'Escalation_Closer'
          ? 'escalating'
          : transition.toAgent === 'Resolution_Closer'
            ? 'resolving'
            : 'on_hold';

    await db.callAttempt.update({
      where: { id: context.callAttemptId },
      data: { activeAgent: transition.toAgent, liveState },
    });

    logger.info('[hold-processor] Recorded agent transition', {
      callAttemptId: context.callAttemptId,
      fromAgent: transition.fromAgent,
      toAgent: transition.toAgent,
      durationSeconds: transition.durationSeconds,
    });

    if (transition.holdTimeoutTriggered) {
      logger.warn('[hold-processor] Explicit hold timeout reported', {
        callAttemptId: context.callAttemptId,
        vapiCallId: context.vapiCallId,
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
  // Never infer hold completion from call.started; it only means the call connected.
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
