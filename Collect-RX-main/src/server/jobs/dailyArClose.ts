import type { PrismaClient } from '@prisma/client';

const VARIANCE_THRESHOLD = 0.005;

export async function runDailyArCloseForPractice(
  prisma: PrismaClient,
  practiceId: string,
  closeDate = new Date(),
): Promise<{ validationPassed: boolean; variancePct: number }> {
  const dayStart = new Date(closeDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const openItems = await prisma.workItem.findMany({
    where: { practiceId, status: 'open' },
    select: { dollarsAtRisk: true },
  });
  const queueOpenTotal = openItems.reduce((s, i) => s + Number(i.dollarsAtRisk), 0);

  const payments = await prisma.paymentEvent.findMany({
    where: {
      paidAt: { gte: dayStart, lt: dayEnd },
      balance: { practiceId },
    },
    select: { amountCents: true },
  });
  const paymentsReceived = payments.reduce((s, p) => s + p.amountCents / 100, 0);

  const claimPayments = await prisma.insuranceClaim.findMany({
    where: {
      practiceId,
      status: 'RESOLVED',
      updatedAt: { gte: dayStart, lt: dayEnd },
    },
    select: { billedAmount: true, outstandingAmount: true },
  });
  const insurancePaidToday = claimPayments.reduce(
    (s, c) => s + Math.max(0, Number(c.billedAmount) - Number(c.outstandingAmount)),
    0,
  );

  const totalReceived = paymentsReceived + insurancePaidToday;
  const pmsLedgerTotal = queueOpenTotal + totalReceived;
  const variancePct =
    pmsLedgerTotal > 0
      ? Math.abs(queueOpenTotal + totalReceived - pmsLedgerTotal) / pmsLedgerTotal
      : 0;
  const validationPassed = variancePct <= VARIANCE_THRESHOLD;

  await prisma.arCloseRun.upsert({
    where: {
      practiceId_closeDate: {
        practiceId,
        closeDate: dayStart,
      },
    },
    create: {
      practiceId,
      closeDate: dayStart,
      queueOpenTotal,
      paymentsReceived: totalReceived,
      pmsLedgerTotal,
      variancePct,
      validationPassed,
      details: {
        outreachPayments: paymentsReceived,
        insuranceResolvedValue: insurancePaidToday,
        openWorkItemCount: openItems.length,
      },
    },
    update: {
      queueOpenTotal,
      paymentsReceived: totalReceived,
      pmsLedgerTotal,
      variancePct,
      validationPassed,
      details: {
        outreachPayments: paymentsReceived,
        insuranceResolvedValue: insurancePaidToday,
        openWorkItemCount: openItems.length,
      },
    },
  });

  return { validationPassed, variancePct };
}

export async function runDailyArCloseAllPractices(prisma: PrismaClient): Promise<void> {
  const practices = await prisma.practice.findMany({ select: { id: true } });
  for (const p of practices) {
    try {
      const result = await runDailyArCloseForPractice(prisma, p.id);
      if (!result.validationPassed) {
        console.warn(
          `[arClose] practice ${p.id} variance ${(result.variancePct * 100).toFixed(2)}% exceeds threshold`,
        );
      }
    } catch (err) {
      console.error(`[arClose] practice ${p.id} failed:`, (err as Error).message);
    }
  }
}
