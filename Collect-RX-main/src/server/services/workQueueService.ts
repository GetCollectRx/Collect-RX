import type { CarrierId, Prisma, PrismaClient } from '@prisma/client';

export interface QueueRankingWeights {
  dollarsWeight: number;
  daysWeight: number;
  carrierRiskWeight: number;
}

const DEFAULT_WEIGHTS: QueueRankingWeights = {
  dollarsWeight: 0.5,
  daysWeight: 0.35,
  carrierRiskWeight: 0.15,
};

const CARRIER_DENIAL_RISK: Partial<Record<CarrierId, number>> = {
  sun_life: 0.7,
  canada_life: 0.75,
  manulife: 0.8,
  green_shield: 0.65,
  rbc: 0.7,
  telus_adjudicare: 0.6,
};

function computeRankScore(
  dollarsAtRisk: number,
  daysOutstanding: number,
  carrierId: CarrierId | null,
  weights: QueueRankingWeights,
): number {
  const maxDollars = 5000;
  const maxDays = 120;
  const dollarNorm = Math.min(1, dollarsAtRisk / maxDollars);
  const daysNorm = Math.min(1, daysOutstanding / maxDays);
  const carrierRisk = carrierId ? (CARRIER_DENIAL_RISK[carrierId] ?? 0.5) : 0.5;
  return (
    dollarNorm * weights.dollarsWeight +
    daysNorm * weights.daysWeight +
    carrierRisk * weights.carrierRiskWeight
  );
}

export async function getQueueWeights(
  prisma: PrismaClient,
  practiceId: string,
): Promise<QueueRankingWeights> {
  const practice = await prisma.practice.findUnique({
    where: { id: practiceId },
    select: { settings: true },
  });
  const settings = practice?.settings as { workQueue?: Partial<QueueRankingWeights> } | null;
  return { ...DEFAULT_WEIGHTS, ...settings?.workQueue };
}

export async function syncWorkItemsForPractice(
  prisma: PrismaClient,
  practiceId: string,
): Promise<{ upserted: number }> {
  const weights = await getQueueWeights(prisma, practiceId);
  let upserted = 0;

  const openClaimStatuses = ['PENDING', 'IN_QUEUE', 'CALLING', 'DENIED', 'ESCALATED', 'ON_HOLD', 'APPROVED_PENDING_PAYMENT'] as const;

  const claims = await prisma.insuranceClaim.findMany({
    where: { practiceId, status: { in: [...openClaimStatuses] }, outstandingAmount: { gt: 0 } },
  });

  for (const c of claims) {
    const dollars = Number(c.outstandingAmount);
    const rankScore = computeRankScore(dollars, c.daysOutstanding, c.carrierId, weights);
    await prisma.workItem.upsert({
      where: {
        practiceId_sourceType_sourceId: {
          practiceId,
          sourceType: 'insurance_claim',
          sourceId: c.id,
        },
      },
      create: {
        practiceId,
        sourceType: 'insurance_claim',
        sourceId: c.id,
        itemType: 'insurance',
        dollarsAtRisk: dollars,
        daysOutstanding: c.daysOutstanding,
        carrierId: c.carrierId,
        title: `Claim ${c.claimNumber}`,
        rankScore,
        status: 'open',
      },
      update: {
        dollarsAtRisk: dollars,
        daysOutstanding: c.daysOutstanding,
        carrierId: c.carrierId,
        title: `Claim ${c.claimNumber}`,
        rankScore,
      },
    });
    upserted += 1;
  }

  const patientRows = await prisma.patientBalance.findMany({
    where: { practiceId, paymentStatus: { in: ['outstanding', 'partial'] }, patientOwes: { gt: 0 } },
  });

  for (const p of patientRows) {
    const dollars = Number(p.patientOwes);
    const days = p.daysSinceAdjudication;
    const carrierId = p.carrierCode ? mapCarrierCodeString(p.carrierCode) : null;
    const rankScore = computeRankScore(dollars, days, carrierId, weights);
    const name = `${p.patientFirstName} ${p.patientLastName}`.trim();
    await prisma.workItem.upsert({
      where: {
        practiceId_sourceType_sourceId: {
          practiceId,
          sourceType: 'patient_balance',
          sourceId: p.id,
        },
      },
      create: {
        practiceId,
        sourceType: 'patient_balance',
        sourceId: p.id,
        itemType: 'patient_ar',
        dollarsAtRisk: dollars,
        daysOutstanding: days,
        carrierId,
        title: name || 'Patient balance',
        rankScore,
        status: 'open',
      },
      update: {
        dollarsAtRisk: dollars,
        daysOutstanding: days,
        carrierId,
        title: name || 'Patient balance',
        rankScore,
      },
    });
    upserted += 1;
  }

  const outreachBalances = await prisma.balance.findMany({
    where: { practiceId, status: 'OPEN' },
    include: { patient: true },
  });

  for (const b of outreachBalances) {
    const dollars = b.amountCents / 100;
    const days = Math.floor((Date.now() - b.createdAt.getTime()) / 86400000);
    const rankScore = computeRankScore(dollars, days, null, weights);
    await prisma.workItem.upsert({
      where: {
        practiceId_sourceType_sourceId: {
          practiceId,
          sourceType: 'outreach_balance',
          sourceId: b.id,
        },
      },
      create: {
        practiceId,
        sourceType: 'outreach_balance',
        sourceId: b.id,
        itemType: 'outreach',
        dollarsAtRisk: dollars,
        daysOutstanding: days,
        title: b.patient.displayName,
        rankScore,
        status: 'open',
      },
      update: {
        dollarsAtRisk: dollars,
        daysOutstanding: days,
        title: b.patient.displayName,
        rankScore,
      },
    });
    upserted += 1;
  }

  return { upserted };
}

function mapCarrierCodeString(code: string): CarrierId | null {
  const normalized = code.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const map: Record<string, CarrierId> = {
    sun_life: 'sun_life',
    canada_life: 'canada_life',
    manulife: 'manulife',
    green_shield: 'green_shield',
    rbc: 'rbc',
    rbc_insurance: 'rbc',
    telus_adjudicare: 'telus_adjudicare',
  };
  return map[normalized] ?? null;
}

export interface WorkQueueFilters {
  itemType?: string;
  carrierId?: CarrierId;
  aging?: '30' | '60' | '90' | '120+';
  assignedRep?: string;
  status?: string;
}

export async function listWorkItems(
  prisma: PrismaClient,
  practiceId: string,
  filters: WorkQueueFilters,
  page = 1,
  limit = 50,
) {
  const where: Prisma.WorkItemWhereInput = { practiceId, status: filters.status ?? 'open' };

  if (filters.itemType) {
    where.itemType = filters.itemType as Prisma.EnumWorkItemTypeFilter['equals'];
  }
  if (filters.carrierId) where.carrierId = filters.carrierId;
  if (filters.assignedRep) where.assignedRep = filters.assignedRep;

  if (filters.aging) {
    const agingMap: Record<string, Prisma.IntFilter> = {
      '30': { gte: 30, lt: 60 },
      '60': { gte: 60, lt: 90 },
      '90': { gte: 90, lt: 120 },
      '120+': { gte: 120 },
    };
    where.daysOutstanding = agingMap[filters.aging];
  }

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    prisma.workItem.findMany({
      where,
      orderBy: [{ rankScore: 'desc' }, { dollarsAtRisk: 'desc' }],
      skip,
      take: limit,
    }),
    prisma.workItem.count({ where }),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}
