import type { LearningBucket } from '@prisma/client';
import type { NotionLearningItem, RankedItem, ResearchResult } from './types.js';

const COMPLIANCE_KW = ['phipa', 'hipaa', 'phi', 'consent', 'privacy', 'compliance', 'audit'];
const OPS_KW = ['deploy', 'railway', 'sentry', 'cron', 'backup', 'on-call', 'ops', 'monitor'];
const GROWTH_KW = ['pricing', 'pilot', 'sales', 'marketing', 'onboarding', 'demo'];
const PRODUCT_KW = ['ux', 'dashboard', 'workflow', 'feature', 'user', 'practice', 'front desk'];

function textBlob(item: NotionLearningItem): string {
  return `${item.title} ${item.description} ${item.phase}`.toLowerCase();
}

export function assignBucket(item: NotionLearningItem): LearningBucket {
  const t = textBlob(item);
  if (COMPLIANCE_KW.some((k) => t.includes(k))) return 'COMPLIANCE';
  if (OPS_KW.some((k) => t.includes(k))) return 'OPS';
  if (GROWTH_KW.some((k) => t.includes(k))) return 'GROWTH';
  if (PRODUCT_KW.some((k) => t.includes(k))) return 'PRODUCT';
  return 'ENGINEERING';
}

function priorityBoost(priority: string): number {
  const p = priority.toUpperCase();
  if (p.startsWith('P0')) return 30;
  if (p.startsWith('P1')) return 20;
  if (p.startsWith('P2')) return 10;
  return 5;
}

function effortPenalty(item: NotionLearningItem): number {
  if (item.effortPoints != null) {
    if (item.effortPoints >= 5) return 25;
    if (item.effortPoints >= 3) return 15;
    return 5;
  }
  const t = textBlob(item);
  if (/migration|auth|stripe|carrier|vapi|prisma/i.test(t)) return 20;
  if (/refactor|rewrite|multi-tenant/i.test(t)) return 25;
  return 8;
}

function riskPenalty(item: NotionLearningItem, bucket: LearningBucket): number {
  const t = textBlob(item);
  let penalty = 0;
  if (bucket === 'COMPLIANCE') penalty += 35;
  if (COMPLIANCE_KW.some((k) => t.includes(k))) penalty += 25;
  if (/production|billing|payment|phi/i.test(t)) penalty += 15;
  return penalty;
}

export function scoreFeasibility(
  item: NotionLearningItem,
  research: ResearchResult,
  bucket: LearningBucket,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 50;

  const boost = priorityBoost(item.priority);
  score += boost;
  reasons.push(`priority +${boost}`);

  const effort = effortPenalty(item);
  score -= effort;
  reasons.push(`effort -${effort}`);

  const risk = riskPenalty(item, bucket);
  score -= risk;
  if (risk > 0) reasons.push(`risk -${risk}`);

  if (item.description.trim().length < 20) {
    score -= 15;
    reasons.push('thin description -15');
  } else {
    score += 10;
    reasons.push('has description +10');
  }

  if (research.codebaseHits.length > 0) {
    score += 8;
    reasons.push('codebase anchor +8');
  }

  if (research.sources && research.sources.length > 0) {
    score += 6;
    reasons.push(`external citations +6 (${research.sources.length})`);
  }

  if (bucket === 'COMPLIANCE') {
    score -= 10;
    reasons.push('compliance bucket gate -10');
  }

  return { score: Math.min(100, Math.max(0, Math.round(score))), reasons };
}

export function rankScore(
  item: NotionLearningItem,
  feasibility: number,
  bucket: LearningBucket,
): number {
  const impact = priorityBoost(item.priority);
  const effort = Math.max(1, effortPenalty(item));
  const bucketWeight =
    bucket === 'ENGINEERING' || bucket === 'PRODUCT' ? 1.1 : 1.0;
  return Math.round(((impact + feasibility * 0.4) / effort) * bucketWeight * 100) / 100;
}

export function rankCandidates(
  items: NotionLearningItem[],
  researchByPage: Map<string, ResearchResult>,
): RankedItem[] {
  const ranked: RankedItem[] = items.map((item) => {
    const research = researchByPage.get(item.pageId)!;
    const bucket = assignBucket(item);
    const { score: feasibilityScore, reasons: feasibilityReasons } = scoreFeasibility(
      item,
      research,
      bucket,
    );
    const rs = rankScore(item, feasibilityScore, bucket);
    return {
      item,
      research,
      bucket,
      rankScore: rs,
      feasibilityScore,
      feasibilityReasons,
    };
  });

  ranked.sort((a, b) => b.rankScore - a.rankScore || b.feasibilityScore - a.feasibilityScore);
  return ranked;
}
