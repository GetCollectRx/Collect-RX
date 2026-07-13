import type { CarrierId, PrismaClient } from '@prisma/client';

export interface CarrierIntelligenceFeedItem {
  id: string;
  carrierId: CarrierId;
  category: string;
  observation: string;
  recommendation: string;
  confidence: number;
  reviewedAt: Date | null;
}

export async function getPracticeCarrierIntelligenceFeed(
  prisma: PrismaClient,
  practiceId: string,
  limit = 20,
): Promise<CarrierIntelligenceFeedItem[]> {
  const lessons = await prisma.carrierLesson.findMany({
    where: { status: 'APPROVED' },
    orderBy: [{ reviewedAt: 'desc' }, { confidence: 'desc' }],
    take: limit,
    select: {
      id: true,
      carrierId: true,
      category: true,
      observation: true,
      recommendation: true,
      confidence: true,
      reviewedAt: true,
    },
  });

  // Practice-scoped telemetry: count recent call outcomes per carrier (no PHI).
  const since = new Date(Date.now() - 30 * 86400000);
  const callStats = await prisma.callAttempt.groupBy({
    by: ['outcome'],
    where: {
      initiatedAt: { gte: since },
      claim: { practiceId },
    },
    _count: { id: true },
  });

  void callStats;

  return lessons.map((l) => ({
    id: l.id,
    carrierId: l.carrierId,
    category: l.category,
    observation: l.observation,
    recommendation: l.recommendation,
    confidence: l.confidence,
    reviewedAt: l.reviewedAt,
  }));
}

export async function listProposedCarrierLessons(
  prisma: PrismaClient,
  carrierId?: CarrierId,
) {
  return prisma.carrierLesson.findMany({
    where: {
      status: 'PROPOSED',
      ...(carrierId ? { carrierId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}
