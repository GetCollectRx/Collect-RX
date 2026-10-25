import type { ClaimStatus, PrismaClient } from '@prisma/client';

/**
 * Most PMS aging reports list only open balances, so a claim the practice
 * resolved in its own system simply stops appearing in the next export.
 * Without this, CollectRx kept those claims open and could keep calling a
 * carrier about a claim that was already paid.
 *
 * Only applies when the practice says the file is its full open insurance AR.
 * A partial or date-ranged export proves nothing about missing claims.
 */

export const ABSENT_FROM_EXPORT_EVENT = 'ABSENT_FROM_FULL_EXPORT';
export const REAPPEARED_IN_EXPORT_EVENT = 'REAPPEARED_IN_EXPORT';

/**
 * A filtered export (wrong date range, one provider only) makes most open
 * claims vanish at once. Above this share, hold instead of closing and let
 * staff confirm, because wrongly closing claims hides real money.
 */
export const MASS_ABSENCE_SHARE = 0.5;
export const MASS_ABSENCE_MIN_CLAIMS = 10;

// CALLING is excluded on purpose: a live call finishes through the normal router.
const OPEN_STATUSES: ClaimStatus[] = [
  'PENDING',
  'IN_QUEUE',
  'APPROVED_PENDING_PAYMENT',
  'ESCALATED',
  'ON_HOLD',
  'DENIED',
];

export interface AbsentClaimResult {
  closed: number;
  /** Set when the mass-absence guardrail held the update for staff review. */
  held: number;
  warning: string | null;
}

export async function closeClaimsMissingFromFullExport(
  prisma: PrismaClient,
  practiceId: string,
  claimNumbersInFile: ReadonlySet<string>,
): Promise<AbsentClaimResult> {
  const open = await prisma.insuranceClaim.findMany({
    where: {
      practiceId,
      deletedAt: null,
      outstandingAmount: { gt: 0 },
      status: { in: OPEN_STATUSES },
      OR: [{ recoveryRoute: null }, { recoveryRoute: { not: 'STOP' } }],
    },
    select: { id: true, claimNumber: true, outstandingAmount: true, recoveryRoute: true },
  });

  const missing = open.filter((claim) => !claimNumbersInFile.has(claim.claimNumber));
  if (missing.length === 0) return { closed: 0, held: 0, warning: null };

  if (missing.length >= MASS_ABSENCE_MIN_CLAIMS && missing.length / open.length > MASS_ABSENCE_SHARE) {
    return {
      closed: 0,
      held: missing.length,
      warning:
        `${missing.length} of ${open.length} open claims are missing from this file. ` +
        'That usually means the export was filtered, so no claims were closed. ' +
        'Re-export the full open insurance AR, or import this file as a partial export.',
    };
  }

  const now = new Date();
  for (const claim of missing) {
    await prisma.insuranceClaim.update({
      where: { id: claim.id },
      data: { recoveryRoute: 'STOP' },
    });
    await prisma.claimRecoveryEvent.create({
      data: {
        practiceId,
        claimId: claim.id,
        eventType: ABSENT_FROM_EXPORT_EVENT,
        previousOutstanding: claim.outstandingAmount,
        metadata: {
          previousRoute: claim.recoveryRoute,
          detectedAt: now.toISOString(),
          reason: 'Claim missing from a full open-AR export; presumed resolved in the PMS. No carrier calls.',
        },
      },
    });
  }
  return { closed: missing.length, held: 0, warning: null };
}

/**
 * A claim closed only because it went missing comes back into recovery when a
 * later export lists it again with a balance. Claims closed for any other
 * reason (carrier block, resolved by a call) stay closed.
 */
export async function reopenIfReappeared(
  prisma: PrismaClient,
  practiceId: string,
  claimId: string,
): Promise<boolean> {
  const latest = await prisma.claimRecoveryEvent.findFirst({
    where: { claimId, practiceId },
    orderBy: { createdAt: 'desc' },
    select: { eventType: true, metadata: true },
  });
  if (latest?.eventType !== ABSENT_FROM_EXPORT_EVENT) return false;

  const metadata = latest.metadata as { previousRoute?: string | null } | null;
  const previousRoute = metadata?.previousRoute;
  const restoreRoute =
    previousRoute === 'WAIT_SYNC' || previousRoute === 'OPEN_CDCP' || previousRoute === 'PRACTICE_GATE'
      ? previousRoute
      : 'CALL_CARRIER';

  await prisma.insuranceClaim.update({
    where: { id: claimId },
    data: { recoveryRoute: restoreRoute },
  });
  await prisma.claimRecoveryEvent.create({
    data: {
      practiceId,
      claimId,
      eventType: REAPPEARED_IN_EXPORT_EVENT,
      metadata: { restoredRoute: restoreRoute },
    },
  });
  return true;
}
