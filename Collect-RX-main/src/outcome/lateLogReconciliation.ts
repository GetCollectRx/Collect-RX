import type { HumanAssistedCallLog, PrismaClient } from '@prisma/client';
import { NO_LOG_OUTCOME_DETAIL, resolveOutcomeFromHumanAssistedLog } from './humanAssistedOutcomeResolver';

/**
 * A scribe log can arrive after the end-of-call report already closed the
 * attempt as "needs staff review" (B-08). Fill in the attempt's outcome, rep
 * and reference from the log so staff see what was learned. The claim status
 * is left alone: it was escalated for review and a late log must not silently
 * resolve or deny a claim.
 */
export async function reconcileLateHandoffLog(
  prisma: PrismaClient,
  log: HumanAssistedCallLog,
): Promise<boolean> {
  const attempt = await prisma.callAttempt.findFirst({
    where: { vapiCallId: log.vapiCallId },
    select: { id: true, completedAt: true, outcomeDetail: true, transcriptUrl: true, durationSeconds: true },
  });
  if (!attempt?.completedAt || attempt.outcomeDetail !== NO_LOG_OUTCOME_DETAIL) return false;

  const { processed } = resolveOutcomeFromHumanAssistedLog(log, {
    transcriptUrl: attempt.transcriptUrl,
    durationSeconds: attempt.durationSeconds,
  });
  const res = await prisma.callAttempt.updateMany({
    where: { id: attempt.id, outcomeDetail: NO_LOG_OUTCOME_DETAIL },
    data: {
      outcome: processed.outcome,
      outcomeDetail: processed.outcomeDetail,
      repName: processed.repName,
      referenceNumber: processed.referenceNumber,
    },
  });
  return res.count > 0;
}
