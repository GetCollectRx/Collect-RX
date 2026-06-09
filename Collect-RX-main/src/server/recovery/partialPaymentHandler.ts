import type { PrismaClient } from '@prisma/client';

const PARTIAL_TRACE_EXTENSION_DAYS = 7;

/**
 * When PMS sync shows a partial payment, extend verification window and open staff review.
 */
export async function handlePartialPaymentSync(
  prisma: PrismaClient,
  params: {
    practiceId: string;
    claimId: string;
    previousOutstanding: number;
    newOutstanding: number;
    amountRecoveredCents: number;
  },
): Promise<void> {
  const { claimId, practiceId, previousOutstanding, newOutstanding, amountRecoveredCents } = params;
  const claim = await prisma.insuranceClaim.findUnique({
    where: { id: claimId },
    select: { recoveryRoute: true, paymentExpectedBy: true, status: true },
  });
  if (!claim) return;

  const extensionMs = PARTIAL_TRACE_EXTENSION_DAYS * 86_400_000;
  const base = claim.paymentExpectedBy?.getTime() ?? Date.now();
  const paymentExpectedBy = new Date(Math.max(base, Date.now()) + extensionMs);

  const route =
    claim.recoveryRoute === 'STOP' || claim.recoveryRoute === 'OPEN_CDCP'
      ? claim.recoveryRoute
      : newOutstanding > previousOutstanding * 0.5
        ? 'CALL_CARRIER'
        : 'WAIT_SYNC';

  await prisma.insuranceClaim.update({
    where: { id: claimId },
    data: {
      recoveryRoute: route,
      paymentExpectedBy,
      outstandingAmount: newOutstanding,
    },
  });

  await prisma.claimRecoveryAction.updateMany({
    where: {
      claimId,
      actionType: 'PAYMENT_VERIFY_SYNC',
      status: 'OPEN',
      clearedAt: null,
    },
    data: { status: 'CLEARED', clearedAt: new Date() },
  });

  await prisma.claimRecoveryAction.create({
    data: {
      practiceId,
      claimId,
      actionType: 'PAYMENT_VERIFY_SYNC',
      status: 'OPEN',
      route: route === 'CALL_CARRIER' ? 'CALL_CARRIER' : 'WAIT_SYNC',
      title: 'Partial payment — verify remaining balance',
      detail: `$${(amountRecoveredCents / 100).toFixed(2)} received via PMS sync; $${newOutstanding.toFixed(2)} still outstanding. Trace extended ${PARTIAL_TRACE_EXTENSION_DAYS}d.`,
      scheduledRecallAt: paymentExpectedBy,
      metadata: {
        partial: true,
        amountRecoveredCents,
        previousOutstanding,
        newOutstanding,
      },
    },
  });

  if (route === 'CALL_CARRIER') {
    await prisma.callQueue.upsert({
      where: { claimId },
      create: {
        practiceId,
        claimId,
        scheduledFor: new Date(Date.now() + 72 * 3_600_000),
        status: 'PENDING',
        attempts: 0,
        lastAttemptAt: new Date(),
      },
      update: {
        status: 'PENDING',
        scheduledFor: new Date(Date.now() + 72 * 3_600_000),
      },
    });
  }

  await prisma.claimRecoveryEvent.create({
    data: {
      practiceId,
      claimId,
      eventType: 'PARTIAL_PAYMENT_SYNC',
      amountRecoveredCents,
      previousOutstanding,
      newOutstanding,
      metadata: {
        paymentExpectedBy: paymentExpectedBy.toISOString(),
        route,
      },
    },
  });
}
