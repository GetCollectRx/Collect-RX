import type { LearningBucket } from '@prisma/client';

export interface NotionLearningItem {
  pageId: string;
  title: string;
  status: string;
  priority: string;
  phase: string;
  description: string;
  effortPoints: number | null;
}

export interface ResearchResult {
  keywords: string[];
  codebaseHits: { path: string; line: number; snippet: string }[];
  summary: string;
}

export interface RankedItem {
  item: NotionLearningItem;
  research: ResearchResult;
  bucket: LearningBucket;
  rankScore: number;
  feasibilityScore: number;
  feasibilityReasons: string[];
}

export interface CycleSummary {
  pulled: number;
  researched: number;
  ranked: number;
  implemented: string[];
  skipped: { title: string; reason: string }[];
  topRanked: { title: string; rankScore: number; feasibilityScore: number }[];
}
