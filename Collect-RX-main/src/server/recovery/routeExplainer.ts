import type { PrismaClient, RecoveryRoute } from '@prisma/client';
import { CLAIM_ROUTER_DECISION_TABLE } from './claimRouter.js';
import { extractLegacyOutcomeCode } from './legacyOutcomeCode.js';

export interface RouteExplanation {
  recoveryRoute: RecoveryRoute | null;
  matchedRule: string;
  notes: string;
  legacyOutcome: string | null;
  decisionTableRow: (typeof CLAIM_ROUTER_DECISION_TABLE)[number] | null;
}

export function explainRecoveryRoute(params: {
  recoveryRoute: RecoveryRoute | null;
  callOutcome?: string | null;
  outcomeDetail?: string | null;
  claimStatus?: string | null;
}): RouteExplanation {
  const legacy = extractLegacyOutcomeCode(params.outcomeDetail);
  const route = params.recoveryRoute;

  let matchedRule = 'Default — awaiting first carrier outcome';
  let notes = 'CollectRx assigns a route after each call or sync event.';
  let row: (typeof CLAIM_ROUTER_DECISION_TABLE)[number] | null = null;

  if (route) {
    row =
      CLAIM_ROUTER_DECISION_TABLE.find((r) => r.route === route) ??
      CLAIM_ROUTER_DECISION_TABLE[0];
    matchedRule = row.when;
    notes = row.notes;
  }

  if (legacy === 'resubmit_required') {
    matchedRule = 'Resubmit / docs required';
    notes = 'Carrier has no record — staff must resubmit before re-call.';
  } else if (legacy === 'processing') {
    matchedRule = 'Claim processing at carrier';
    notes = 'Carrier acknowledged the claim; CollectRx schedules a follow-up call.';
  } else if (params.callOutcome === 'RESOLVED' && route === 'WAIT_SYNC') {
    matchedRule = 'RESOLVED + corroborated (ref or structured payload)';
    notes = 'Waiting for PMS sync to confirm payment — not call status alone.';
  }

  return {
    recoveryRoute: route,
    matchedRule,
    notes,
    legacyOutcome: legacy,
    decisionTableRow: row,
  };
}

export async function getClaimRouteExplanation(
  prisma: PrismaClient,
  practiceId: string,
  claimId: string,
): Promise<RouteExplanation | null> {
  const claim = await prisma.insuranceClaim.findFirst({
    where: { id: claimId, practiceId },
    select: {
      recoveryRoute: true,
      status: true,
      callAttempts: {
        orderBy: { initiatedAt: 'desc' },
        take: 1,
        select: { outcome: true, outcomeDetail: true },
      },
    },
  });
  if (!claim) return null;

  const last = claim.callAttempts[0];
  return explainRecoveryRoute({
    recoveryRoute: claim.recoveryRoute,
    callOutcome: last?.outcome ?? null,
    outcomeDetail: last?.outcomeDetail ?? null,
    claimStatus: claim.status,
  });
}
