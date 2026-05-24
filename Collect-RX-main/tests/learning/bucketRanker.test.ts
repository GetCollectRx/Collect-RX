import { describe, it, expect } from 'vitest';
import { assignBucket, rankCandidates, scoreFeasibility } from '../../src/server/learning/bucketRanker.js';
import type { NotionLearningItem } from '../../src/server/learning/types.js';

function item(overrides: Partial<NotionLearningItem> = {}): NotionLearningItem {
  return {
    pageId: 'page-1',
    title: 'Improve dashboard filters',
    status: 'Backlog',
    priority: 'P1',
    phase: 'Phase 5',
    description: 'Add sort and filter on claims table for front desk.',
    effortPoints: 2,
    ...overrides,
  };
}

describe('assignBucket', () => {
  it('classifies compliance-related work', () => {
    expect(
      assignBucket(item({ title: 'PHIPA consent portal', description: 'privacy compliance' })),
    ).toBe('COMPLIANCE');
  });

  it('defaults to engineering for generic tasks', () => {
    expect(assignBucket(item({ title: 'Fix webhook retry', description: 'api handler' }))).toBe(
      'ENGINEERING',
    );
  });
});

describe('scoreFeasibility', () => {
  it('scores higher when external research citations exist', () => {
    const { score: withSrc } = scoreFeasibility(
      item({ priority: 'P1', description: 'Detailed acceptance criteria here.' }),
      {
        keywords: [],
        codebaseHits: [],
        summary: '',
        sources: [{ title: 'Carrier guide', url: 'https://example.com' }],
      },
      'ENGINEERING',
    );
    const { score: noSrc } = scoreFeasibility(
      item({ priority: 'P1', description: 'Detailed acceptance criteria here.' }),
      { keywords: [], codebaseHits: [], summary: '' },
      'ENGINEERING',
    );
    expect(withSrc).toBeGreaterThan(noSrc);
  });

  it('scores higher for P0 with description', () => {
    const { score: p0 } = scoreFeasibility(
      item({ priority: 'P0', description: 'Detailed acceptance criteria here.' }),
      { keywords: [], codebaseHits: [{ path: 'a.ts', line: 1, snippet: 'x' }], summary: '' },
      'ENGINEERING',
    );
    const { score: p2 } = scoreFeasibility(
      item({ priority: 'P2', description: '' }),
      { keywords: [], codebaseHits: [], summary: '' },
      'ENGINEERING',
    );
    expect(p0).toBeGreaterThan(p2);
  });
});

describe('rankCandidates', () => {
  it('orders by rank score descending', () => {
    const a = item({ pageId: 'a', title: 'Small tweak', priority: 'P2', effortPoints: 1 });
    const b = item({ pageId: 'b', title: 'P0 carrier block alert', priority: 'P0', effortPoints: 1 });
    const research = new Map([
      ['a', { keywords: [], codebaseHits: [], summary: '' }],
      ['b', { keywords: [], codebaseHits: [], summary: '' }],
    ]);
    const ranked = rankCandidates([a, b], research);
    expect(ranked[0].item.pageId).toBe('b');
    expect(ranked[0].rankScore).toBeGreaterThanOrEqual(ranked[1].rankScore);
  });
});
