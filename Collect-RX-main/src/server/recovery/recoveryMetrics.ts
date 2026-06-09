import type { PrismaClient } from '@prisma/client';

export interface RecoveryMetricsSnapshot {
  dollarsRecoveredSyncVerified: number;
  paymentsVerifiedBySync: number;
  openInsuranceOutstanding: number;
  syncVerifiedToday: number;
  dollarsRecoveredSyncVerifiedLast30Days: number;
  /** @deprecated use cohortRecoveryRatePct */
  recoveryRatePct: number | null;
  blockingGatesOpen: number;
  awaitingSyncVerification: number;
  medianTimeToSyncVerifyHours: number | null;
  medianGateClearanceHours: number | null;
  cohortRecoveryRatePct: number | null;
}

export interface PlatformRecoveryMetrics {
  practicesWithOpenGates: number;
  totalBlockingGatesOpen: number;
  totalAwaitingSyncVerification: number;
  syncVerifiedLast7Days: number;
  dollarsRecoveredSyncVerifiedLast7Days: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

async function computeMedianTimeToSyncVerify(
  prisma: PrismaClient,
  practiceId: string,
): Promise<number | null> {
  const verified = await prisma.claimRecoveryEvent.findMany({
    where: { practiceId, eventType: 'PAYMENT_VERIFIED_SYNC' },
    select: { claimId: true, createdAt: true },
    take: 200,
    orderBy: { createdAt: 'desc' },
  });
  const hours: number[] = [];
  for (const v of verified) {
    const wait = await prisma.claimRecoveryEvent.findFirst({
      where: {
        claimId: v.claimId,
        eventType: 'ROUTE_ASSIGNED',
        metadata: { path: ['route'], equals: 'WAIT_SYNC' },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (!wait) continue;
    hours.push((v.createdAt.getTime() - wait.createdAt.getTime()) / 3_600_000);
  }
  return median(hours);
}

async function computeMedianGateClearance(
  prisma: PrismaClient,
  practiceId: string,
): Promise<number | null> {
  const cleared = await prisma.claimRecoveryEvent.findMany({
    where: { practiceId, eventType: 'GATE_CLEARED' },
    select: { claimId: true, createdAt: true, metadata: true },
    take: 200,
    orderBy: { createdAt: 'desc' },
  });
  const hours: number[] = [];
  for (const c of cleared) {
    const actionId = (c.metadata as { actionId?: string })?.actionId;
    if (!actionId) continue;
    const action = await prisma.claimRecoveryAction.findUnique({
      where: { id: actionId },
      select: { createdAt: true },
    });
    if (!action) continue;
    hours.push((c.createdAt.getTime() - action.createdAt.getTime()) / 3_600_000);
  }
  return median(hours);
}

export async function computeRecoveryMetrics(
  prisma: PrismaClient,
  practiceId: string,
): Promise<RecoveryMetricsSnapshot> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
  const startOfUtcDay = new Date();
  startOfUtcDay.setUTCHours(0, 0, 0, 0);

  const [verifiedEvents, verified30, verifiedToday, openClaims, blockingGates, awaitingSync, medianSync, medianGate] =
    await Promise.all([
      prisma.claimRecoveryEvent.aggregate({
        where: { practiceId, eventType: 'PAYMENT_VERIFIED_SYNC' },
        _sum: { amountRecoveredCents: true },
        _count: true,
      }),
      prisma.claimRecoveryEvent.aggregate({
        where: {
          practiceId,
          eventType: 'PAYMENT_VERIFIED_SYNC',
          createdAt: { gte: thirtyDaysAgo },
        },
        _sum: { amountRecoveredCents: true },
      }),
      prisma.claimRecoveryEvent.count({
        where: {
          practiceId,
          eventType: 'PAYMENT_VERIFIED_SYNC',
          createdAt: { gte: startOfUtcDay },
        },
      }),
      prisma.insuranceClaim.aggregate({
        where: {
          practiceId,
          status: { notIn: ['RESOLVED'] },
          outstandingAmount: { gt: 0 },
        },
        _sum: { outstandingAmount: true },
      }),
      prisma.claimRecoveryAction.count({
        where: { practiceId, status: 'BLOCKING', clearedAt: null },
      }),
      prisma.insuranceClaim.count({
        where: {
          practiceId,
          recoveryRoute: 'WAIT_SYNC',
          outstandingAmount: { gt: 0 },
        },
      }),
      computeMedianTimeToSyncVerify(prisma, practiceId),
      computeMedianGateClearance(prisma, practiceId),
    ]);

  const dollarsRecoveredSyncVerified = (verifiedEvents._sum.amountRecoveredCents ?? 0) / 100;
  const dollarsRecoveredSyncVerifiedLast30Days = (verified30._sum.amountRecoveredCents ?? 0) / 100;
  const openInsuranceOutstanding = Number(openClaims._sum.outstandingAmount ?? 0);
  const denominator = dollarsRecoveredSyncVerified + openInsuranceOutstanding;
  const recoveryRatePct =
    denominator > 0
      ? Math.round((dollarsRecoveredSyncVerified / denominator) * 1000) / 10
      : null;
  /** @deprecated Misleading label — use cohortRecoveryRatePct; share of verified $ vs open+verified AR */

  const cohortDenominator = dollarsRecoveredSyncVerifiedLast30Days + openInsuranceOutstanding;
  const cohortRecoveryRatePct =
    cohortDenominator > 0
      ? Math.round((dollarsRecoveredSyncVerifiedLast30Days / cohortDenominator) * 1000) / 10
      : null;

  return {
    dollarsRecoveredSyncVerified,
    paymentsVerifiedBySync: verifiedEvents._count,
    openInsuranceOutstanding,
    syncVerifiedToday: verifiedToday,
    dollarsRecoveredSyncVerifiedLast30Days,
    recoveryRatePct,
    blockingGatesOpen: blockingGates,
    awaitingSyncVerification: awaitingSync,
    medianTimeToSyncVerifyHours: medianSync != null ? Math.round(medianSync * 10) / 10 : null,
    medianGateClearanceHours: medianGate != null ? Math.round(medianGate * 10) / 10 : null,
    cohortRecoveryRatePct,
  };
}

export async function computePlatformRecoveryMetrics(
  prisma: PrismaClient,
): Promise<PlatformRecoveryMetrics> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);

  const [gateGroups, awaitingSync, verified7, verifiedSum7] = await Promise.all([
    prisma.claimRecoveryAction.groupBy({
      by: ['practiceId'],
      where: { status: 'BLOCKING', clearedAt: null },
      _count: true,
    }),
    prisma.insuranceClaim.count({
      where: { recoveryRoute: 'WAIT_SYNC', outstandingAmount: { gt: 0 } },
    }),
    prisma.claimRecoveryEvent.count({
      where: { eventType: 'PAYMENT_VERIFIED_SYNC', createdAt: { gte: sevenDaysAgo } },
    }),
    prisma.claimRecoveryEvent.aggregate({
      where: { eventType: 'PAYMENT_VERIFIED_SYNC', createdAt: { gte: sevenDaysAgo } },
      _sum: { amountRecoveredCents: true },
    }),
  ]);

  const totalBlockingGatesOpen = gateGroups.reduce((s, g) => s + g._count, 0);

  return {
    practicesWithOpenGates: gateGroups.length,
    totalBlockingGatesOpen,
    totalAwaitingSyncVerification: awaitingSync,
    syncVerifiedLast7Days: verified7,
    dollarsRecoveredSyncVerifiedLast7Days: (verifiedSum7._sum.amountRecoveredCents ?? 0) / 100,
  };
}
