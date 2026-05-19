import type { PrismaClient } from '@prisma/client';
import {
  isLearningLoopEnabled,
  learningFeasibilityMin,
  learningMaxImplementPerCycle,
  notionStatusesToPull,
} from './config.js';
import { pullLearningBacklog, getNotionConfig } from './notionClient.js';
import { researchItem } from './research.js';
import { rankCandidates } from './bucketRanker.js';
import { implementRankedItem } from './implementer.js';
import { sendLearningCycleSms } from './notify.js';
import type { CycleSummary } from './types.js';

export async function runLearningCycle(prisma: PrismaClient): Promise<CycleSummary> {
  if (!isLearningLoopEnabled()) {
    console.log('[learning] LEARNING_LOOP_ENABLED is off — skipping cycle');
    return {
      pulled: 0,
      researched: 0,
      ranked: 0,
      implemented: [],
      skipped: [],
      topRanked: [],
    };
  }

  if (!getNotionConfig()) {
    throw new Error(
      'Learning loop enabled but NOTION_API_KEY / NOTION_LEARNING_DATABASE_ID missing',
    );
  }

  const run = await prisma.learningCycleRun.create({
    data: { status: 'running' },
  });

  const summary: CycleSummary = {
    pulled: 0,
    researched: 0,
    ranked: 0,
    implemented: [],
    skipped: [],
    topRanked: [],
  };

  try {
    const statuses = notionStatusesToPull();
    const items = await pullLearningBacklog(statuses);
    summary.pulled = items.length;

    const researchByPage = new Map<string, ReturnType<typeof researchItem>>();
    for (const item of items) {
      researchByPage.set(item.pageId, researchItem(item));
    }
    summary.researched = researchByPage.size;

    const ranked = rankCandidates(items, researchByPage);
    summary.ranked = ranked.length;
    summary.topRanked = ranked.slice(0, 5).map((r) => ({
      title: r.item.title,
      rankScore: r.rankScore,
      feasibilityScore: r.feasibilityScore,
    }));

    const minFeas = learningFeasibilityMin();
    const maxImpl = learningMaxImplementPerCycle();
    let implementedCount = 0;

    for (const r of ranked) {
      await prisma.learningCandidate.create({
        data: {
          cycleRunId: run.id,
          notionPageId: r.item.pageId,
          title: r.item.title,
          bucket: r.bucket,
          rankScore: r.rankScore,
          feasibilityScore: r.feasibilityScore,
          status: 'RANKED',
          researchNotes: {
            summary: r.research.summary,
            keywords: r.research.keywords,
            codebaseHits: r.research.codebaseHits,
            feasibilityReasons: r.feasibilityReasons,
          },
        },
      });

      if (r.feasibilityScore < minFeas) {
        summary.skipped.push({
          title: r.item.title,
          reason: `feasibility ${r.feasibilityScore} < ${minFeas}`,
        });
        await prisma.learningCandidate.updateMany({
          where: { cycleRunId: run.id, notionPageId: r.item.pageId },
          data: { status: 'SKIPPED' },
        });
        continue;
      }

      if (implementedCount >= maxImpl) {
        summary.skipped.push({
          title: r.item.title,
          reason: `cycle cap (${maxImpl}) reached`,
        });
        await prisma.learningCandidate.updateMany({
          where: { cycleRunId: run.id, notionPageId: r.item.pageId },
          data: { status: 'SKIPPED' },
        });
        continue;
      }

      const outcome = await implementRankedItem(r);
      if (outcome.ok) {
        implementedCount++;
        summary.implemented.push(r.item.title);
        await prisma.learningCandidate.updateMany({
          where: { cycleRunId: run.id, notionPageId: r.item.pageId },
          data: {
            status: 'IMPLEMENTED',
            implementationResult: { actions: outcome.actions },
          },
        });
      } else {
        summary.skipped.push({
          title: r.item.title,
          reason: outcome.error ?? 'implementation failed',
        });
        await prisma.learningCandidate.updateMany({
          where: { cycleRunId: run.id, notionPageId: r.item.pageId },
          data: { status: 'FAILED', implementationResult: { error: outcome.error } },
        });
      }
    }

    const smsSent = await sendLearningCycleSms(summary);

    await prisma.learningCycleRun.update({
      where: { id: run.id },
      data: {
        status: 'completed',
        finishedAt: new Date(),
        pulledCount: summary.pulled,
        researchedCount: summary.researched,
        rankedCount: summary.ranked,
        implementedCount: summary.implemented.length,
        skippedCount: summary.skipped.length,
        smsSent,
        summary: summary as object,
      },
    });

    console.log('[learning] cycle complete', summary);
    return summary;
  } catch (err) {
    const message = (err as Error).message;
    await prisma.learningCycleRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        error: message,
      },
    });
    throw err;
  }
}
