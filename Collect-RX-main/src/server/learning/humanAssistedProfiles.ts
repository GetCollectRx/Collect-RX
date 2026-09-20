/**
 * V1 human-assisted profile synthesis — CollectRx learns from every
 * Claims_Scribe call log. Deliberately separate from carrierLessons.ts,
 * which is scoped to the fully-autonomous squad's own calls (see the
 * schema.prisma comment above HumanAssistedCallLog for why).
 *
 * Claims_Scribe already extracts structured facts per call (log_call_outcome,
 * persisted as HumanAssistedCallLog by src/webhooks/vapi.ts). This module is
 * the second-level synthesis: look ACROSS a carrier's accumulated call logs
 * for what recurs, and fold that into HumanAssistedCarrierProfile rows —
 * carrier is the primary key, by design.
 *
 * Runs periodically (see scheduler below): pulls unprocessed call logs per
 * carrier, has a small model look for cross-call patterns (single-call
 * facts are not patterns — see the system prompt), and either strengthens
 * an existing profile row or creates a new one.
 */

import type { CarrierId, PrismaClient } from '@prisma/client';
import cron from 'node-cron';
import { LLM_RESIDENCY_HEADERS } from '../../services/pii-vault';
import {
  assertAllowedEvalModel,
  assertAnthropicEvalAllowed,
} from '../../services/analytics/anthropicEvalGuard.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
/** Synthesis is a narrow structured task — the cheap model tier is deliberate. */
const PROFILE_MODEL = 'claude-haiku-4-5-20251001';
const BATCH_SIZE = 40;
const MAX_PROFILES_PER_RUN = 6;
const MIN_RECORDS_FOR_SYNTHESIS = 2;

const CATEGORIES = [
  'DOCUMENTATION',
  'HOLD_BEHAVIOR',
  'STAFF_DECISION',
  'DENIAL_PATTERN',
  'REP_BEHAVIOR',
] as const;
type ProfileCategory = (typeof CATEGORIES)[number];

interface SynthesizedProfile {
  category: ProfileCategory;
  observation: string;
  recommendation: string;
  confidence: number;
  supportingCallCount: number;
}

interface CallLogForSynthesis {
  id: string;
  scenario: string;
  shortfallReason: string | null;
  documentationRequested: string | null;
  submissionMethod: string | null;
  denialOrReductionCode: string | null;
  callSummary: string;
  unresolvedFields: string | null;
}

const SYNTHESIS_SYSTEM_PROMPT = `You look across several human-assisted insurance calls for ONE carrier and find PATTERNS THAT RECUR ACROSS MULTIPLE CALLS — not facts about any single call.

Each record below is a structured summary of a call where CollectRx practice staff spoke with a carrier rep (CollectRx's AI only listened and logged — it never spoke). You are looking for what tends to be true of this carrier: documentation it tends to ask for, how staff tend to handle a shortfall or denial, hold behavior, how reps tend to phrase things, decisions staff made that worked.

RULES:
- Only report a pattern that appears in at least 2 of the records below. A single occurrence is not a pattern — do not report it.
- NEVER include patient names, claim numbers, reference numbers, dollar amounts, or dates from any individual record. Describe the CARRIER's tendency, not one call's data.
- category must be one of: ${CATEGORIES.join(', ')}.
- confidence: 0.0-1.0, how consistently the records support the pattern.
- supportingCallCount: how many of the provided records support this pattern.
- Return ONLY valid JSON: {"profiles": [{"category": "...", "observation": "...", "recommendation": "...", "confidence": 0.0, "supportingCallCount": 0}]}. An empty array is a perfectly good answer.`;

function getAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('[humanAssistedProfiles] ANTHROPIC_API_KEY not set');
  return key;
}

/** Reject any profile that leaked an identifier-like token despite instructions. */
function containsIdentifierLikeContent(text: string): boolean {
  return /\b\d{6,}\b/.test(text) || /\b\d{4}-\d{2}-\d{2}\b/.test(text) || /\$\d/.test(text);
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function formatRecordsForPrompt(records: CallLogForSynthesis[]): string {
  return records
    .map(
      (r, i) =>
        `Record ${i + 1} (scenario: ${r.scenario}): documentation requested: ${
          r.documentationRequested ?? 'none noted'
        }. submission method: ${r.submissionMethod ?? 'n/a'}. shortfall reason: ${
          r.shortfallReason ?? 'n/a'
        }. denial/reduction code: ${r.denialOrReductionCode ?? 'n/a'}. summary: ${r.callSummary}`,
    )
    .join('\n');
}

async function runSynthesis(
  records: CallLogForSynthesis[],
  carrierId: string,
): Promise<SynthesizedProfile[]> {
  assertAnthropicEvalAllowed('humanAssistedProfiles');
  assertAllowedEvalModel(PROFILE_MODEL, 'humanAssistedProfiles');

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': getAnthropicKey(),
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      ...LLM_RESIDENCY_HEADERS,
    },
    body: JSON.stringify({
      model: PROFILE_MODEL,
      max_tokens: 1536,
      system: SYNTHESIS_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Carrier: ${carrierId}. ${records.length} call records follow.\n\n${formatRecordsForPrompt(records)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`[humanAssistedProfiles] Anthropic API error: HTTP ${response.status} — ${body}`);
  }

  const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
  const text = data.content?.find((c) => c.type === 'text')?.text ?? '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  const parsed = JSON.parse(jsonMatch[0]) as { profiles?: unknown };
  if (!Array.isArray(parsed.profiles)) return [];

  const profiles: SynthesizedProfile[] = [];
  for (const raw of parsed.profiles.slice(0, MAX_PROFILES_PER_RUN)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const p = raw as Record<string, unknown>;
    const category = CATEGORIES.find((c) => c === p.category);
    if (!category) continue;
    if (typeof p.observation !== 'string' || typeof p.recommendation !== 'string') continue;
    if (containsIdentifierLikeContent(p.observation + ' ' + p.recommendation)) continue;
    profiles.push({
      category,
      observation: p.observation.slice(0, 500),
      recommendation: p.recommendation.slice(0, 500),
      confidence: typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0.5,
      supportingCallCount:
        typeof p.supportingCallCount === 'number' ? Math.max(1, Math.round(p.supportingCallCount)) : 2,
    });
  }
  return profiles;
}

/**
 * Process one carrier's backlog of unprocessed call logs into profile
 * entries. Non-fatal by design — callers should log a throw, never block.
 * Returns the number of profile rows created or strengthened.
 */
export async function synthesizeCarrierProfile(
  prisma: PrismaClient,
  carrierId: CarrierId,
): Promise<number> {
  const unprocessed = await prisma.humanAssistedCallLog.findMany({
    where: { carrierId, processedForProfileAt: null },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
    select: {
      id: true,
      scenario: true,
      shortfallReason: true,
      documentationRequested: true,
      submissionMethod: true,
      denialOrReductionCode: true,
      callSummary: true,
      unresolvedFields: true,
    },
  });
  if (unprocessed.length < MIN_RECORDS_FOR_SYNTHESIS) return 0;

  const synthesized = await runSynthesis(unprocessed, carrierId);
  const callIds = unprocessed.map((r) => r.id);
  const latestCallId = unprocessed[unprocessed.length - 1]?.id;

  const existing = await prisma.humanAssistedCarrierProfile.findMany({
    where: { carrierId },
    select: { id: true, observation: true, sampleSize: true, confidence: true },
  });
  const existingByNorm = new Map(existing.map((e) => [normalize(e.observation), e]));

  let touched = 0;
  for (const profile of synthesized) {
    const key = normalize(profile.observation);
    const match = existingByNorm.get(key);
    if (match) {
      // Same pattern seen again — strengthen it rather than duplicate it.
      await prisma.humanAssistedCarrierProfile.update({
        where: { id: match.id },
        data: {
          sampleSize: match.sampleSize + profile.supportingCallCount,
          confidence: Math.max(match.confidence, profile.confidence),
          recommendation: profile.recommendation,
          lastCallLogId: latestCallId,
        },
      });
    } else {
      await prisma.humanAssistedCarrierProfile.create({
        data: {
          carrierId,
          category: profile.category,
          observation: profile.observation,
          recommendation: profile.recommendation,
          sampleSize: profile.supportingCallCount,
          confidence: profile.confidence,
          lastCallLogId: latestCallId,
        },
      });
    }
    touched += 1;
  }

  await prisma.humanAssistedCallLog.updateMany({
    where: { id: { in: callIds } },
    data: { processedForProfileAt: new Date() },
  });

  return touched;
}

/** Run synthesis across every carrier with enough of a backlog. Entry point for the scheduler and for manual/admin triggering. */
export async function runHumanAssistedProfileSynthesis(prisma: PrismaClient): Promise<void> {
  const carriers = await prisma.humanAssistedCallLog.groupBy({
    by: ['carrierId'],
    where: { processedForProfileAt: null },
    _count: { id: true },
    having: { id: { _count: { gte: MIN_RECORDS_FOR_SYNTHESIS } } },
  });

  for (const c of carriers) {
    try {
      const touched = await synthesizeCarrierProfile(prisma, c.carrierId);
      console.log(`[humanAssistedProfiles] carrier=${c.carrierId} profiles touched=${touched}`);
    } catch (err) {
      console.error(`[humanAssistedProfiles] carrier=${c.carrierId} synthesis failed:`, (err as Error).message);
    }
  }
}

// ---------------------------------------------------------------------------
// In-process scheduler — mirrors src/server/learning/scheduler.ts's pattern.
// ---------------------------------------------------------------------------

let inProcessScheduled = false;

/** Default: every 6 hours. Override with HUMAN_ASSISTED_PROFILE_CRON. Set HUMAN_ASSISTED_PROFILE_LOOP_ENABLED=false to disable. */
export function startHumanAssistedProfileLoopInProcess(prisma: PrismaClient): void {
  if (process.env.HUMAN_ASSISTED_PROFILE_LOOP_ENABLED === 'false') {
    console.log('[humanAssistedProfiles] loop disabled via env — in-process scheduler not started');
    return;
  }
  if (inProcessScheduled) return;

  const expression = process.env.HUMAN_ASSISTED_PROFILE_CRON?.trim() || '0 */6 * * *';
  if (!cron.validate(expression)) {
    console.error(`[humanAssistedProfiles] Invalid HUMAN_ASSISTED_PROFILE_CRON "${expression}" — scheduler not started`);
    return;
  }

  cron.schedule(expression, () => {
    runHumanAssistedProfileSynthesis(prisma).catch((err) =>
      console.error('[humanAssistedProfiles] run error:', (err as Error).message),
    );
  });

  inProcessScheduled = true;
  console.log(`[humanAssistedProfiles] In-process cron scheduled: "${expression}"`);
}
