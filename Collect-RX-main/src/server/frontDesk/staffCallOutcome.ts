import type { PrismaClient, CarrierId } from '@prisma/client';
import { KNOWN_SCRIBE_SCENARIOS } from '../../outcome/humanAssistedOutcomeResolver.js';
import { reconcileLateHandoffLog } from '../../outcome/lateLogReconciliation.js';
import { redactNarrativePhi } from '../../services/guardrails/transcriptRedaction.js';

export interface StaffOutcomeInput {
  practiceId: string;
  callAttemptId: string;
  scenario: string;
  repName?: string;
  referenceNumber?: string;
  summary: string;
}

export type StaffOutcomeResult =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Staff backup for when the listener logged nothing (B-09). Writes the same
 * HumanAssistedCallLog row the scribe would have, so downstream handling and
 * learning treat it identically, then fills the attempt like a late log.
 */
export async function submitStaffCallOutcome(
  prisma: PrismaClient,
  input: StaffOutcomeInput,
): Promise<StaffOutcomeResult> {
  if (!KNOWN_SCRIBE_SCENARIOS.includes(input.scenario)) {
    return { ok: false, status: 400, error: 'Unknown scenario' };
  }
  const summary = (input.summary ?? '').trim();
  if (!summary || summary.length > 2000) {
    return { ok: false, status: 400, error: 'Summary is required (max 2000 characters)' };
  }
  const attempt = await prisma.callAttempt.findFirst({
    where: { id: input.callAttemptId, claim: { practiceId: input.practiceId } },
    select: { id: true, vapiCallId: true, claimId: true, claim: { select: { carrierId: true } } },
  });
  if (!attempt) return { ok: false, status: 404, error: 'Call not found' };

  const existing = await prisma.humanAssistedCallLog.findUnique({ where: { vapiCallId: attempt.vapiCallId } });
  if (existing) return { ok: false, status: 409, error: 'An outcome is already logged for this call' };

  const log = await prisma.humanAssistedCallLog.create({
    data: {
      claimId: attempt.claimId,
      practiceId: input.practiceId,
      carrierId: attempt.claim.carrierId as CarrierId,
      vapiCallId: attempt.vapiCallId,
      scenario: input.scenario,
      repName: input.repName?.trim().slice(0, 120) || null,
      referenceNumber: input.referenceNumber?.trim().slice(0, 60) || null,
      automationSuspicionFlag: false,
      callSummary: redactNarrativePhi(summary),
    },
  });
  await reconcileLateHandoffLog(prisma, log);
  return { ok: true };
}
