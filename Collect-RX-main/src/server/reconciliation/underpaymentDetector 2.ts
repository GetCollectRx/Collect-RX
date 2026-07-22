import type { PrismaClient } from '@prisma/client';

const MIN_VARIANCE_CENTS = 500; // $5.00

export interface UnderpaymentCandidate {
  claimId: string;
  expectedCents: number;
  paidCents: number;
  varianceCents: number;
  reasonCode?: string | null;
}

export function detectUnderpayment(params: {
  expectedAmount: number | null | undefined;
  paidAmount: number;
  reasonCode?: string | null;
}): UnderpaymentCandidate | null {
  const expected = params.expectedAmount;
  if (expected == null || expected <= 0) return null;
  const paid = params.paidAmount;
  if (paid < 0 || paid >= expected) return null;
  const expectedCents = Math.round(expected * 100);
  const paidCents = Math.round(paid * 100);
  const varianceCents = expectedCents - paidCents;
  if (varianceCents < MIN_VARIANCE_CENTS) return null;
  return {
    claimId: '',
    expectedCents,
    paidCents,
    varianceCents,
    reasonCode: params.reasonCode ?? null,
  };
}

export async function upsertUnderpaymentCase(
  prisma: PrismaClient,
  practiceId: string,
  claimId: string,
  candidate: UnderpaymentCandidate,
): Promise<void> {
  const existingAction = await prisma.claimRecoveryAction.findFirst({
    where: {
      claimId,
      actionType: 'UNDERPAYMENT_REVIEW',
      status: { in: ['OPEN', 'BLOCKING'] },
    },
  });

  await prisma.underpaymentCase.upsert({
    where: {
      claimId_expectedCents_paidCents: {
        claimId,
        expectedCents: candidate.expectedCents,
        paidCents: candidate.paidCents,
      },
    },
    create: {
      practiceId,
      claimId,
      expectedCents: candidate.expectedCents,
      paidCents: candidate.paidCents,
      varianceCents: candidate.varianceCents,
      reasonCode: candidate.reasonCode ?? null,
      status: 'OPEN',
    },
    update: { status: 'OPEN' },
  });

  if (!existingAction) {
    await prisma.claimRecoveryAction.create({
      data: {
        practiceId,
        claimId,
        actionType: 'UNDERPAYMENT_REVIEW',
        status: 'OPEN',
        route: 'CALL_CARRIER',
        title: 'Review carrier underpayment',
        detail: `Paid $${(candidate.paidCents / 100).toFixed(2)} vs expected $${(candidate.expectedCents / 100).toFixed(2)}.`,
        metadata: {
          source: 'csv_reconciliation',
          varianceCents: candidate.varianceCents,
        },
      },
    });
    await prisma.claimRecoveryEvent.create({
      data: {
        practiceId,
        claimId,
        eventType: 'UNDERPAYMENT_DETECTED',
        metadata: {
          expectedCents: candidate.expectedCents,
          paidCents: candidate.paidCents,
          varianceCents: candidate.varianceCents,
        },
      },
    });
  }
}
