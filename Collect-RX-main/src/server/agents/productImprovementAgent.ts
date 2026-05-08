import { createHash } from 'node:crypto';
import cron from 'node-cron';
import { Client } from '@notionhq/client';
import type { PrismaClient } from '@prisma/client';
import { appendAuditLog } from '../audit/auditLog.js';

type StoryCandidate = {
  practiceId: string;
  practiceName: string;
  title: string;
  summary: string;
  rationale: string;
  acceptanceCriteria: string[];
  priority: 'High' | 'Medium';
  fingerprint: string;
};

type NotebookResearchFinding = {
  theme: string;
  finding: string;
  recommendedAction: string;
  urgency?: 'low' | 'medium' | 'high';
};

type NotebookResearchIngestPayload = {
  title: string;
  sourceUrl?: string;
  findings: NotebookResearchFinding[];
  practiceId?: string;
};

const DEFAULT_AGENT_CRON = '0 9 * * *';
const OVERDUE_DAYS = 45;
const LOOKBACK_DAYS = 30;

function isAgentEnabled(): boolean {
  return ['1', 'true', 'yes'].includes(String(process.env.PRODUCT_AGENT_ENABLED || '').toLowerCase());
}

function getNotionConfig() {
  const apiKey = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_PRODUCT_STORIES_DB_ID;
  if (!apiKey || !databaseId) {
    return null;
  }
  return { apiKey, databaseId };
}

function makeFingerprint(parts: string[]): string {
  return createHash('sha256').update(parts.join('::')).digest('hex').slice(0, 16);
}

function scorePriority(input: { staffReviewCount: number; lowPayRate: boolean }): 'High' | 'Medium' {
  if (input.staffReviewCount >= 15 || input.lowPayRate) {
    return 'High';
  }
  return 'Medium';
}

async function buildStoryCandidates(prisma: PrismaClient): Promise<StoryCandidate[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const practices = await prisma.practice.findMany({ select: { id: true, name: true } });
  const candidates: StoryCandidate[] = [];

  for (const practice of practices) {
    const [overdueByCarrier, reminderEvents, openBalances] = await Promise.all([
      prisma.patientBalance.groupBy({
        by: ['carrierCode'],
        where: {
          practiceId: practice.id,
          paymentStatus: { not: 'paid' },
          daysSinceAdjudication: { gte: OVERDUE_DAYS },
          carrierCode: { not: null },
        },
        _count: { _all: true },
      }),
      prisma.outreachEvent.findMany({
        where: {
          sentAt: { gte: since },
          templateKey: { in: ['NOTIFIED', 'REMINDER_1', 'REMINDER_2'] },
          balance: { practiceId: practice.id },
        },
        select: { responseStatus: true, templateKey: true },
      }),
      prisma.balance.findMany({
        where: { practiceId: practice.id, status: 'OPEN' },
        include: { states: { orderBy: { stageAt: 'desc' }, take: 1 } },
      }),
    ]);

    const topCarrier = overdueByCarrier
      .sort((a, b) => b._count._all - a._count._all)
      .find((row) => row.carrierCode);

    if (topCarrier && topCarrier._count._all >= 8) {
      const carrierCode = topCarrier.carrierCode as string;
      candidates.push({
        practiceId: practice.id,
        practiceName: practice.name,
        title: `[${practice.name}] Reduce ${carrierCode} overdue claim backlog`,
        summary: `${topCarrier._count._all} unpaid balances are ${OVERDUE_DAYS}+ days old for ${carrierCode}.`,
        rationale:
          'Carrier-specific delays are stacking aged A/R. A focused workflow can improve queue ordering, scripts, and escalation timing.',
        acceptanceCriteria: [
          `Introduce a carrier playbook for ${carrierCode} with clear call/escalation decision points.`,
          'Add dashboard visibility for overdue-by-carrier trend over rolling 4 weeks.',
          'Ship one measurable intervention and track reduction in overdue count week-over-week.',
        ],
        priority: 'High',
        fingerprint: makeFingerprint([practice.id, 'carrier-overdue', carrierCode]),
      });
    }

    if (reminderEvents.length >= 30) {
      const payResponses = reminderEvents.filter((event) => event.responseStatus === 'PAY').length;
      const payRate = payResponses / reminderEvents.length;
      if (payRate < 0.06) {
        candidates.push({
          practiceId: practice.id,
          practiceName: practice.name,
          title: `[${practice.name}] Improve reminder-to-payment conversion`,
          summary: `Reminder pay conversion is ${(payRate * 100).toFixed(1)}% over the last ${LOOKBACK_DAYS} days.`,
          rationale: 'Low payment intent from reminder messaging indicates friction in copy, cadence, or payment-link flow.',
          acceptanceCriteria: [
            'Create 2 message variants with explicit behavioral hypothesis.',
            'Run a 2-week experiment split by template key and capture pay conversion by variant.',
            'Promote winning variant when it improves conversion by at least 20% relative.',
          ],
          priority: scorePriority({ staffReviewCount: 0, lowPayRate: true }),
          fingerprint: makeFingerprint([practice.id, 'reminder-conversion', String(since.getUTCMonth())]),
        });
      }
    }

    const staffReviewCount = openBalances.filter((balance) => balance.states[0]?.stage === 'STAFF_REVIEW').length;
    if (staffReviewCount >= 10) {
      candidates.push({
        practiceId: practice.id,
        practiceName: practice.name,
        title: `[${practice.name}] Decrease manual STAFF_REVIEW load`,
        summary: `${staffReviewCount} open balances are currently blocked in STAFF_REVIEW.`,
        rationale: 'Manual review queues can hide repeatable patterns that should be automated with safer policy-based handling.',
        acceptanceCriteria: [
          'Classify top 3 STAFF_REVIEW causes from recent audit entries and outcomes.',
          'Convert at least one cause into a guardrailed automation or routing rule.',
          'Reduce STAFF_REVIEW volume by 15% over the next month without increasing disputes.',
        ],
        priority: scorePriority({ staffReviewCount, lowPayRate: false }),
        fingerprint: makeFingerprint([practice.id, 'staff-review', String(staffReviewCount >= 20)]),
      });
    }
  }

  const researchCandidates = await buildResearchDrivenCandidates(prisma, practices);
  return [...candidates, ...researchCandidates];
}

async function buildResearchDrivenCandidates(
  prisma: PrismaClient,
  practices: Array<{ id: string; name: string }>
): Promise<StoryCandidate[]> {
  const researchLookback = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const logs = await prisma.auditLog.findMany({
    where: {
      action: 'product_agent.notebooklm_ingest',
      createdAt: { gte: researchLookback },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  const byPractice = new Map(practices.map((p) => [p.id, p.name]));
  const out: StoryCandidate[] = [];

  for (const log of logs) {
    if (!log.details || typeof log.details !== 'object') continue;
    const details = log.details as Record<string, unknown>;
    const title = typeof details.title === 'string' ? details.title : 'NotebookLM research';
    const findings = Array.isArray(details.findings) ? (details.findings as unknown[]) : [];

    for (const raw of findings) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      const theme = typeof row.theme === 'string' ? row.theme : 'Research';
      const finding = typeof row.finding === 'string' ? row.finding : '';
      const recommendedAction =
        typeof row.recommendedAction === 'string' ? row.recommendedAction : '';
      const urgency = typeof row.urgency === 'string' ? row.urgency.toLowerCase() : 'medium';
      if (!finding || !recommendedAction) continue;

      const practiceName = byPractice.get(log.practiceId) || 'CollectRx';
      const fp = makeFingerprint([log.practiceId, 'notebooklm', title, theme, recommendedAction]);

      out.push({
        practiceId: log.practiceId,
        practiceName,
        title: `[${practiceName}] ${theme}: ${recommendedAction.slice(0, 72)}`,
        summary: finding,
        rationale:
          'NotebookLM daily research surfaced this change; product should convert it into a tracked implementation story.',
        acceptanceCriteria: [
          `Validate the finding source quality for "${theme}" and document confidence level.`,
          `Define implementation scope for: ${recommendedAction}`,
          'Ship a measurable change and track impact within one reporting cycle.',
        ],
        priority: urgency === 'high' ? 'High' : 'Medium',
        fingerprint: fp,
      });
    }
  }

  return out;
}

async function recentlyCreated(prisma: PrismaClient, practiceId: string, fingerprint: string): Promise<boolean> {
  const recent = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const hit = await prisma.auditLog.findFirst({
    where: {
      practiceId,
      action: 'product_agent.story_created',
      createdAt: { gte: recent },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!hit || !hit.details || typeof hit.details !== 'object') {
    return false;
  }
  const details = hit.details as Record<string, unknown>;
  return details.fingerprint === fingerprint;
}

function pickStatusName(options: string[]): string | null {
  const preferred = ['Backlog', 'To do', 'Todo', 'Not started', 'Inbox'];
  for (const name of preferred) {
    if (options.includes(name)) return name;
  }
  return options[0] || null;
}

async function createStoryInNotion(notion: Client, databaseId: string, story: StoryCandidate): Promise<string> {
  const database = await notion.databases.retrieve({ database_id: databaseId });
  const properties = 'properties' in database ? database.properties : {};
  const propsRecord = properties as Record<string, { type: string; status?: { options?: Array<{ name: string }> }; select?: { options?: Array<{ name: string }> } }>;
  const titleProp = Object.entries(propsRecord).find(([, value]) => value.type === 'title');
  if (!titleProp) {
    throw new Error('No title property found in Notion database');
  }

  const [titlePropName] = titleProp;
  const payloadProps: Record<string, unknown> = {
    [titlePropName]: { title: [{ text: { content: story.title } }] },
  };

  for (const [propName, prop] of Object.entries(propsRecord)) {
    if (prop.type === 'status') {
      const statusName = pickStatusName((prop.status?.options || []).map((o) => o.name));
      if (statusName) payloadProps[propName] = { status: { name: statusName } };
    } else if (prop.type === 'select' && propName.toLowerCase().includes('priority')) {
      const options = (prop.select?.options || []).map((o) => o.name);
      const preferred = options.includes(story.priority) ? story.priority : options[0];
      if (preferred) payloadProps[propName] = { select: { name: preferred } };
    } else if (prop.type === 'rich_text' && propName.toLowerCase().includes('source')) {
      payloadProps[propName] = { rich_text: [{ text: { content: 'CollectRx Product Agent' } }] };
    }
  }

  const page = await notion.pages.create({
    parent: { database_id: databaseId },
    properties: payloadProps as never,
    children: [
      { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: story.summary } }] } },
      { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: story.rationale } }] } },
      {
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: [{ type: 'text', text: { content: 'Acceptance Criteria' } }] },
      },
      ...story.acceptanceCriteria.map((item) => ({
        object: 'block' as const,
        type: 'bulleted_list_item' as const,
        bulleted_list_item: { rich_text: [{ type: 'text' as const, text: { content: item } }] },
      })),
    ],
  });
  return page.id;
}

export async function runProductImprovementCycle(prisma: PrismaClient): Promise<void> {
  if (!isAgentEnabled()) {
    return;
  }
  const notionConfig = getNotionConfig();
  if (!notionConfig) {
    console.warn('[product-agent] missing NOTION_API_KEY or NOTION_PRODUCT_STORIES_DB_ID');
    return;
  }

  const candidates = await buildStoryCandidates(prisma);
  if (candidates.length === 0) {
    console.log('[product-agent] no new story candidates');
    return;
  }

  const notion = new Client({ auth: notionConfig.apiKey });
  const maxStories = Math.max(1, Number(process.env.PRODUCT_AGENT_MAX_STORIES_PER_RUN || '3'));

  let createdCount = 0;
  for (const story of candidates) {
    if (createdCount >= maxStories) break;
    if (await recentlyCreated(prisma, story.practiceId, story.fingerprint)) continue;

    try {
      const notionPageId = await createStoryInNotion(notion, notionConfig.databaseId, story);
      await appendAuditLog(prisma, {
        practiceId: story.practiceId,
        action: 'product_agent.story_created',
        subjectType: 'NotionPage',
        subjectId: notionPageId,
        details: {
          title: story.title,
          priority: story.priority,
          fingerprint: story.fingerprint,
        },
      });
      createdCount += 1;
    } catch (error) {
      console.error('[product-agent] failed to create Notion story', {
        practiceId: story.practiceId,
        title: story.title,
        err: (error as Error).message,
      });
    }
  }

  console.log(`[product-agent] run complete; created ${createdCount} stories`);
}

export function startProductImprovementAgent(prisma: PrismaClient): void {
  if (!isAgentEnabled()) {
    return;
  }
  const pattern = process.env.PRODUCT_AGENT_CRON || DEFAULT_AGENT_CRON;
  if (!cron.validate(pattern)) {
    console.error(`[product-agent] invalid PRODUCT_AGENT_CRON "${pattern}"`);
    return;
  }
  cron.schedule(pattern, () => {
    void runProductImprovementCycle(prisma);
  });
  console.log(`[product-agent] scheduled in-process cron "${pattern}"`);
}

export async function ingestNotebookLmResearch(
  prisma: PrismaClient,
  payload: NotebookResearchIngestPayload
): Promise<{ practiceIds: string[]; findingCount: number }> {
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  if (!payload.title || findings.length === 0) {
    throw new Error('title and findings[] are required');
  }

  const practiceIds = payload.practiceId
    ? [payload.practiceId]
    : (await prisma.practice.findMany({ select: { id: true } })).map((p) => p.id);

  for (const practiceId of practiceIds) {
    await appendAuditLog(prisma, {
      practiceId,
      action: 'product_agent.notebooklm_ingest',
      details: {
        source: 'NotebookLM',
        title: payload.title,
        sourceUrl: payload.sourceUrl || null,
        findings: findings.map((f) => ({
          theme: f.theme,
          finding: f.finding,
          recommendedAction: f.recommendedAction,
          urgency: f.urgency || 'medium',
        })),
      },
    });
  }

  return { practiceIds, findingCount: findings.length };
}
