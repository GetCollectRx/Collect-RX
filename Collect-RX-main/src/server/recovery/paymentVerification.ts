import type { ClaimStatus, PrismaClient } from '@prisma/client';
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

/**
 * A balance can drop in the PMS for reasons that are not an insurance payment:
 * a write-off, an adjustment, a patient payment, a reversal. Counting every
 * drop as recovered money overstated what CollectRx recovered. A drop only
 * counts when something independent says insurance paid: the carrier confirmed
 * payment on a call (claim status set by the call router), or the export
 * itself carries an insurance-paid amount.
 */
const CARRIER_CONFIRMED_STATUSES: ClaimStatus[] = ['RESOLVED', 'APPROVED_PENDING_PAYMENT'];

export const BALANCE_CLEARED_UNVERIFIED_EVENT = 'BALANCE_CLEARED_UNVERIFIED';

export type PaymentEvidence = 'carrier_confirmed' | 'insurance_payment_in_export' | null;

export interface PaymentVerificationResult {
  claimId: string;
  verified: boolean;
  amountRecoveredCents: number;
  previousOutstanding: number;
  newOutstanding: number;
  evidence: PaymentEvidence;
}

export function paymentEvidenceFor(
  claimStatus: ClaimStatus,
  insurancePaymentReported: boolean,
): PaymentEvidence {
  if (CARRIER_CONFIRMED_STATUSES.includes(claimStatus)) return 'carrier_confirmed';
  if (insurancePaymentReported) return 'insurance_payment_in_export';
  return null;
}

export async function verifyPaymentFromSyncUpdate(
  prisma: PrismaClient,
  params: {
    practiceId: string;
    claimId: string;
    previousOutstanding: number;
    newOutstanding: number;
    /** True when the import row carried an insurance-paid amount above zero. */
    insurancePaymentReported?: boolean;
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
  const evidence = paymentEvidenceFor(claim.status, params.insurancePaymentReported === true);

  if (fullyPaid && !evidence) {
    // The claim is closed in the PMS, so stop calling, but do not credit it as recovered.
    await prisma.insuranceClaim.update({
      where: { id: claimId },
      data: { outstandingAmount: 0, recoveryRoute: 'STOP', paymentExpectedBy: null },
    });
    await prisma.claimRecoveryEvent.create({
      data: {
        practiceId,
        claimId,
        eventType: BALANCE_CLEARED_UNVERIFIED_EVENT,
        previousOutstanding,
        newOutstanding: 0,
        metadata: {
          reason:
            'Balance reached zero in the PMS with no carrier confirmation or insurance payment on the export. ' +
            'Not counted as recovered.',
        },
      },
    });
    return { claimId, verified: false, amountRecoveredCents, previousOutstanding, newOutstanding, evidence };
  }

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
      evidence,
    };
  }

  await handlePartialPaymentSync(prisma, {
    practiceId,
    claimId,
    previousOutstanding,
    newOutstanding,
    amountRecoveredCents,
    evidence,
  });
  return {
    claimId,
    verified: false,
    amountRecoveredCents,
    previousOutstanding,
    newOutstanding,
    evidence,
  };
}

export async function runPaymentVerificationBatch(
  prisma: PrismaClient,
  practiceId: string,
  updates: Array<{
    claimId: string;
    previousOutstanding: number;
    newOutstanding: number;
    insurancePaymentReported?: boolean;
  }>,
): Promise<PaymentVerificationResult[]> {
  const results: PaymentVerificationResult[] = [];
  for (const u of updates) {
    const r = await verifyPaymentFromSyncUpdate(prisma, { practiceId, ...u });
    if (r) results.push(r);
  }
  return results;
}
