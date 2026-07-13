/**
 * Carrier lesson loop — CollectRx learns from every call transcript.
 *
 * After a call completes and validation runs, a small model reads the
 * transcript and proposes structured lessons ("RBC's menu now offers a
 * claims fax-back option at step 5", "This carrier's reps ask for the
 * provider number before the claim number"). Lessons are stored PROPOSED
 * and reviewed by a human; only APPROVED navigation lessons are injected
 * into future call instructions.
 *
 * Security invariant: transcripts are UNTRUSTED input — a carrier rep (or
 * hold recording) could say something crafted to become an instruction.
 * The human review gate is the injection barrier; never widen the
 * auto-injection path past APPROVED status.
 */

import type { CarrierId, PrismaClient } from '@prisma/client';
import { LLM_RESIDENCY_HEADERS } from '../../services/pii-vault';
import {
  assertAllowedEvalModel,
  assertAnthropicEvalAllowed,
} from '../../services/analytics/anthropicEvalGuard.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
/** Extraction is a narrow structured task — the cheap model tier is deliberate. */
const LESSON_MODEL = 'claude-haiku-4-5-20251001';
const MAX_LESSONS_PER_CALL = 3;
const MAX_PROPOSED_PER_CARRIER = 25;
const MAX_INJECTED_NOTES = 5;

const CATEGORIES = [
  'IVR_NAVIGATION',
  'REP_INTERACTION',
  'HOLD_BEHAVIOR',
  'REFUSAL',
  'EXTRACTION',
] as const;
type LessonCategory = (typeof CATEGORIES)[number];

export interface ExtractedLesson {
  category: LessonCategory;
  observation: string;
  recommendation: string;
  confidence: number;
}

const EXTRACTOR_SYSTEM_PROMPT = `You extract operational lessons from dental-insurance carrier call transcripts for CollectRx.

A lesson is a reusable fact about HOW THIS CARRIER OPERATES that would help future calls: menu structure changes, what order reps ask for identifiers, hold patterns, refusal triggers, phrasing that worked or backfired.

RULES:
- NEVER include patient names, dates of birth, policy numbers, claim numbers, phone numbers, dollar amounts, or any identifier. Lessons describe the CARRIER's behavior, not this call's data.
- Only extract lessons that generalize beyond this single call. A rep being in a bad mood is not a lesson; a rep requiring the provider number before discussing any claim is.
- 0 lessons is a perfectly good answer for a routine call. Maximum ${MAX_LESSONS_PER_CALL}.
- confidence: 0.0-1.0, how strongly the transcript supports the lesson.
- category must be one of: ${CATEGORIES.join(', ')}.
- Return ONLY valid JSON: {"lessons": [{"category": "...", "observation": "...", "recommendation": "...", "confidence": 0.0}]}`;

function getAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('[carrierLessons] ANTHROPIC_API_KEY not set');
  return key;
}

/** Reject any lesson that leaked an identifier-like token despite instructions. */
function containsIdentifierLikeContent(text: string): boolean {
  return /\b\d{6,}\b/.test(text) || /\b\d{4}-\d{2}-\d{2}\b/.test(text);
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

async function runExtraction(transcript: string, carrierId: string): Promise<ExtractedLesson[]> {
  assertAnthropicEvalAllowed('carrierLessons');
  assertAllowedEvalModel(LESSON_MODEL, 'carrierLessons');
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': getAnthropicKey(),
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      ...LLM_RESIDENCY_HEADERS,
    },
    body: JSON.stringify({
      model: LESSON_MODEL,
      max_tokens: 1024,
      system: EXTRACTOR_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Carrier: ${carrierId}.\n\nTranscript:\n${transcript}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`[carrierLessons] Anthropic API error: HTTP ${response.status} — ${body}`);
  }

  const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
  const text = data.content?.find((c) => c.type === 'text')?.text ?? '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  const parsed = JSON.parse(jsonMatch[0]) as { lessons?: unknown };
  if (!Array.isArray(parsed.lessons)) return [];

  const lessons: ExtractedLesson[] = [];
  for (const raw of parsed.lessons.slice(0, MAX_LESSONS_PER_CALL)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const l = raw as Record<string, unknown>;
    const category = CATEGORIES.find((c) => c === l.category);
    if (!category) continue;
    if (typeof l.observation !== 'string' || typeof l.recommendation !== 'string') continue;
    if (containsIdentifierLikeContent(l.observation + ' ' + l.recommendation)) continue;
    lessons.push({
      category,
      observation: l.observation.slice(0, 500),
      recommendation: l.recommendation.slice(0, 500),
      confidence: typeof l.confidence === 'number' ? Math.max(0, Math.min(1, l.confidence)) : 0.5,
    });
  }
  return lessons;
}

/**
 * Extract and store lessons from a completed call. Non-fatal by design —
 * callers should treat a throw here as loggable, never blocking.
 */
export async function extractLessonsFromCall(
  prisma: PrismaClient,
  callAttemptId: string,
): Promise<number> {
  const attempt = await prisma.callAttempt.findUnique({
    where: { id: callAttemptId },
    select: {
      transcriptText: true,
      claim: { select: { carrierId: true } },
    },
  });
  if (!attempt?.transcriptText || attempt.transcriptText.length < 200) return 0;
  const carrierId = attempt.claim.carrierId;

  const proposedCount = await prisma.carrierLesson.count({
    where: { carrierId, status: 'PROPOSED' },
  });
  if (proposedCount >= MAX_PROPOSED_PER_CARRIER) return 0;

  const extracted = await runExtraction(attempt.transcriptText, carrierId);
  if (extracted.length === 0) return 0;

  const existing = await prisma.carrierLesson.findMany({
    where: { carrierId, status: { in: ['PROPOSED', 'APPROVED'] } },
    select: { observation: true },
  });
  const seen = new Set(existing.map((e) => normalize(e.observation)));

  let stored = 0;
  for (const lesson of extracted) {
    if (seen.has(normalize(lesson.observation))) continue;
    await prisma.carrierLesson.create({
      data: {
        carrierId,
        category: lesson.category,
        observation: lesson.observation,
        recommendation: lesson.recommendation,
        confidence: lesson.confidence,
        sourceCallAttemptId: callAttemptId,
      },
    });
    stored += 1;
  }
  return stored;
}

/**
 * Human-APPROVED navigation lessons for a carrier, formatted for appending
 * to the carrier_ivr_instructions call variable. Empty string when none.
 */
export async function getApprovedNavigationNotes(
  prisma: PrismaClient,
  carrierId: CarrierId,
): Promise<string> {
  const lessons = await prisma.carrierLesson.findMany({
    where: { carrierId, status: 'APPROVED', category: 'IVR_NAVIGATION' },
    orderBy: [{ confidence: 'desc' }, { reviewedAt: 'desc' }],
    take: MAX_INJECTED_NOTES,
    select: { recommendation: true },
  });
  if (lessons.length === 0) return '';
  return ' | LEARNED: ' + lessons.map((l) => l.recommendation).join(' | ');
}

export async function reviewLesson(
  prisma: PrismaClient,
  lessonId: string,
  action: 'approve' | 'reject',
  reviewedBy: string,
): Promise<boolean> {
  const result = await prisma.carrierLesson.updateMany({
    where: { id: lessonId, status: 'PROPOSED' },
    data: {
      status: action === 'approve' ? 'APPROVED' : 'REJECTED',
      reviewedAt: new Date(),
      reviewedBy,
    },
  });
  return result.count > 0;
}
