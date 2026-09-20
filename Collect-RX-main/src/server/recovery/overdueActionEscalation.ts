/**
 * Overdue recovery-action escalation sweep.
 *
 * Practice-facing actions (resubmit claim, send documentation) carry a
 * carrier deadline. If the action is still open past autoEscalateAt, the
 * claim silently dies at the carrier — so this sweep escalates it to a human
 * and notifies the practice dashboard. escalatedAt guards against repeat
 * escalations across ticks.
 */

import type { PrismaClient } from '@prisma/client';
import { createEscalation } from '../services/escalationService.js';
import { sendPracticeNotification } from '../services/practiceNotificationService.js';
import { logger } from '../observability/logger.js';

export async function escalateOverdueRecoveryActions(prisma: PrismaClient): Promise<number> {
  const overdue = await prisma.claimRecoveryAction.findMany({
    where: {
      autoEscalateAt: { lte: new Date() },
      escalatedAt: null,
      clearedAt: null,
      status: { in: ['OPEN', 'BLOCKING'] },
    },
    include: {
      claim: {
        select: {
          id: true,
          practiceId: true,
          claimNumber: true,
          carrierId: true,
          billedAmount: true,
        },
      },
    },
    take: 100,
  });

  let escalated = 0;
  for (const action of overdue) {
    const deadlineText = action.deadline
      ? ` Carrier deadline was ${action.deadline.toISOString().slice(0, 10)}.`
      : '';
    try {
      await createEscalation(prisma, {
        practiceId: action.claim.practiceId,
        claimId: action.claim.id,
        claimRef: action.claim.claimNumber,
        carrierId: action.claim.carrierId,
        amountClaimedCents: Math.round(Number(action.claim.billedAmount) * 100),
        reason: `Practice action overdue: ${action.title}.${deadlineText}`,
      });

      try {
        await sendPracticeNotification(prisma, {
          practiceId: action.claim.practiceId,
          type: 'ACTION_OVERDUE',
          subject: `Claim ${action.claim.claimNumber}: action overdue`,
          message: `"${action.title}" was not completed by its deadline.${deadlineText} The claim has been escalated for human follow-up.`,
          claimId: action.claim.id,
          severity: 'warning',
        });
      } catch (notifErr) {
        logger.error('[overdue-actions] notification failed (non-fatal)', { error: notifErr });
      }

      await prisma.claimRecoveryAction.update({
        where: { id: action.id },
        data: { escalatedAt: new Date() },
      });
      escalated += 1;
    } catch (err) {
      logger.error('[overdue-actions] escalation failed', {
        actionId: action.id,
        claimId: action.claim.id,
        error: err,
      });
    }
  }

  return escalated;
}
