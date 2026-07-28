import type { PrismaClient } from '@prisma/client';
import { categorizeDenial, type DenialCategory } from './denialEvidenceRules.js';

export interface CategorizedDenial {
  claimId: string;
  denialReasonCode: string | null;
  denialReasonText: string | null;
  category: DenialCategory;
  confidence: 'high' | 'medium' | 'low';
}

export interface DenialCategoryStats {
  category: DenialCategory;
  count: number;
  percentOfDenials: number;
  claimIds: string[];
}

export async function categorizePracticeDenials(
  prisma: PrismaClient,
  practiceId: string,
): Promise<CategorizedDenial[]> {
  const deniedClaims = await prisma.insuranceClaim.findMany({
    where: {
      practiceId,
      status: { in: ['DENIED', 'ESCALATED'] },
    },
    select: {
      id: true,
      denialReasonCode: true,
      denialReasonText: true,
      callAttempts: {
        where: { outcome: 'DENIED' },
        select: { outcomeDetail: true },
        orderBy: { completedAt: 'desc' },
        take: 1,
      },
    },
  });

  return deniedClaims.map((claim) => {
    const outcomeDetail = claim.callAttempts[0]?.outcomeDetail ?? null;
    const category = categorizeDenial({
      denialReasonCode: claim.denialReasonCode,
      denialReasonText: claim.denialReasonText,
      outcomeDetail,
    });

    const confidence = computeConfidence(
      claim.denialReasonCode,
      claim.denialReasonText,
      outcomeDetail,
      category,
    );

    return {
      claimId: claim.id,
      denialReasonCode: claim.denialReasonCode,
      denialReasonText: claim.denialReasonText,
      category,
      confidence,
    };
  });
}

export async function getDenialCategoryStats(
  prisma: PrismaClient,
  practiceId: string,
): Promise<DenialCategoryStats[]> {
  const categorized = await categorizePracticeDenials(prisma, practiceId);
  const byCategory = new Map<DenialCategory, string[]>();

  for (const d of categorized) {
    if (!byCategory.has(d.category)) {
      byCategory.set(d.category, []);
    }
    byCategory.get(d.category)!.push(d.claimId);
  }

  const total = categorized.length || 1;
  const stats: DenialCategoryStats[] = [];

  for (const [cat, claimIds] of byCategory) {
    stats.push({
      category: cat,
      count: claimIds.length,
      percentOfDenials: Math.round((claimIds.length / total) * 1000) / 10,
      claimIds,
    });
  }

  return stats.sort((a, b) => b.count - a.count);
}

function computeConfidence(
  code: string | null,
  text: string | null,
  outcomeDetail: string | null,
  category: DenialCategory,
): 'high' | 'medium' | 'low' {
  if (!code && !text && !outcomeDetail) return 'low';
  if ((code ?? '').includes('FREQ') || (code ?? '').includes('COB')) return 'high';
  if (outcomeDetail && outcomeDetail.length > 50) return 'high';
  if (code || (text && text.length > 30)) return 'medium';
  return 'low';
}
