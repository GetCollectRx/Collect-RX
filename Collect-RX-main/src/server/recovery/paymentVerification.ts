import type { PrismaClient } from '@prisma/client';
import { handlePartialPaymentSync } from './partialPaymentHandler.js';
import { transitionClaimRecovery } from './transitionClaimRecovery.js';

const PAYMENT_VERIFY_STATUSES = [
  'RESOLVED',
  'APPROVED_PENDING_PAYMENT',
  'IN_QUEUE',
  'CALLING',
  'ESCALATED',
  'ON_HOLD',
] as const;

export interface PaymentVerificationResult {
  claimId: string;
  verified: boolean;
  amountRecoveredCents: number;
  previousOutstanding: number;
  newOutstanding: number;
}

export async function verifyPaymentFromSyncUpdate(
  prisma: PrismaClient,
  params: {
    practiceId: string;
    claimId: string;
    previousOutstanding: number;
    newOutstanding: number;
  },
): Promise<PaymentVerificationResult | null> {
  const { claimId, practiceId, previousOutstanding, newOutstanding } = params;
  if (previousOutstanding <= 0) return null;

  const claim = await prisma.insuranceClaim.findUnique({ where: { id: claimId } });
  if (!claim || claim.practiceId !== practiceId) return null;

  const delta = previousOutstanding - newOutstanding;
  if (delta <= 0) return null;

  const amountRecoveredCents = Math.round(delta * 100);
  const fullyPaid = newOutstanding <= 0.009;

  if (fullyPaid && PAYMENT_VERIFY_STATUSES.includes(claim.status as (typeof PAYMENT_VERIFY_STATUSES)[number])) {
    await transitionClaimRecovery(prisma, {
      practiceId,
      claimId,
      kind: 'PAYMENT_VERIFIED_SYNC',
      previousOutstanding,
      newOutstanding,
      amountRecoveredCents,
    });

    return {
      claimId,
      verified: true,
      amountRecoveredCents,
      previousOutstanding,
      newOutstanding,
    };
  }

  if (delta > 0) {
    await handlePartialPaymentSync(prisma, {
      practiceId,
      claimId,
      previousOutstanding,
      newOutstanding,
      amountRecoveredCents,
    });
    return {
      claimId,
      verified: false,
      amountRecoveredCents,
      previousOutstanding,
      newOutstanding,
    };
  }

  return null;
}

export async function runPaymentVerificationBatch(
  prisma: PrismaClient,
  practiceId: string,
  updates: Array<{ claimId: string; previousOutstanding: number; newOutstanding: number }>,
): Promise<PaymentVerificationResult[]> {
  const results: PaymentVerificationResult[] = [];
  for (const u of updates) {
    const r = await verifyPaymentFromSyncUpdate(prisma, { practiceId, ...u });
    if (r) results.push(r);
  }
  return results;
}
