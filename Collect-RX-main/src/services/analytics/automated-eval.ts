// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Automated 8-Dimension Call Evaluation Pipeline
//
// Uses a secondary LLM (Claude claude-sonnet-4-6 via Anthropic API) to score each
// completed call transcript against the 8 quality dimensions required for the
// Pilot Success Metrics Report (F-003).
//
// PHI boundary:
//   Transcripts passed to this evaluator must NEVER contain real patient names
//   or DOBs. Only UUID tokens (from PIIVault), claim numbers, and carrier names
//   are permitted in transcript text sent to the LLM.
//
// Data residency:
//   All Anthropic API calls include the X-Data-Residency: Canada-Central header
//   (see LLM_RESIDENCY_HEADERS in pii-vault.ts) to comply with Quebec Law 25
//   and Alberta HIA production requirements.
// ─────────────────────────────────────────────────────────────────────────────

import { assertAllowedEvalModel, assertAnthropicEvalAllowed } from './anthropicEvalGuard.js';
import { LLM_RESIDENCY_HEADERS } from '../pii-vault';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The 8 quality dimensions for F-003 Pilot Success Metrics Report */
export type EvalDimension =
  | 'ivr_success'
  | 'authentication_success'
  | 'retrieval_accuracy'
  | 'hallucination_rate'
  | 'call_resolution_rate'
  | 'hold_time_accuracy'
  | 'carrier_compliance'
  | 'escalation_appropriateness';

export interface DimensionScore {
  dimension: EvalDimension;
  /** 0–100. null if the dimension was not applicable to this call. */
  score: number | null;
  /** Whether this dimension passed the minimum threshold */
  passed: boolean;
  /** LLM-generated rationale (1–2 sentences, no PHI) */
  rationale: string;
}

export interface CallEvalResult {
  callId: string;
  /** Average of all non-null dimension scores */
  overallScore: number;
  dimensions: DimensionScore[];
  /** ISO timestamp when evaluation was completed */
  evaluatedAt: string;
  /** Model used for evaluation */
  model: string;
  /** Whether ALL dimensions passed minimum thresholds */
  overallPassed: boolean;
}

// ---------------------------------------------------------------------------
// Dimension configuration — thresholds for pass/fail
// ---------------------------------------------------------------------------

const DIMENSION_THRESHOLDS: Record<EvalDimension, number> = {
  ivr_success:                 70,  // % of IVR trees navigated without human transfer
  authentication_success:      85,  // % of auth challenges passed on first attempt
  retrieval_accuracy:          80,  // % of claim details stated accurately
  hallucination_rate:           5,  // max acceptable hallucination score (inverted: lower = better)
  call_resolution_rate:        60,  // % of calls reaching a definitive status
  hold_time_accuracy:          75,  // accuracy of predicted vs actual hold time
  carrier_compliance:          90,  // adherence to carrier-specific IVR protocols
  escalation_appropriateness:  80,  // escalations that were genuinely warranted
};

/** Dimensions where LOWER is better (score is an error/risk rate) */
const LOWER_IS_BETTER: Set<EvalDimension> = new Set(['hallucination_rate']);

// ---------------------------------------------------------------------------
// LLM evaluation
// ---------------------------------------------------------------------------

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const EVAL_MODEL = 'claude-sonnet-4-6';

function getAnthropicKey(): string {
  assertAnthropicEvalAllowed('AutomatedEval');
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('[AutomatedEval] ANTHROPIC_API_KEY not set');
  return key;
}

const EVAL_SYSTEM_PROMPT = `You are a quality-assurance evaluator for CollectRx, an AI dental insurance collections system operating in Canada.

Your task is to score completed call transcripts across 8 quality dimensions.

CRITICAL RULES:
- Never include or infer patient names, dates of birth, health card numbers, or any personal health information in your rationale.
- Patient identifiers in transcripts are UUID tokens — treat them as opaque IDs.
- Score each dimension 0–100 (integer). Use null if the dimension is not applicable.
- Rationale must be 1–2 sentences maximum. No lists, no bullets.
- Return ONLY valid JSON — no preamble, no explanation outside the JSON.

Dimension definitions:
1. ivr_success (0–100): Did the AI successfully navigate the carrier IVR to reach the claims department without unexpected transfers or dead ends?
2. authentication_success (0–100): Did the AI pass carrier authentication challenges (group number, provider number, member ID) correctly on the first attempt?
3. retrieval_accuracy (0–100): Were the claim details retrieved (status, adjudication date, paid amount) accurate and consistent with what the carrier stated?
4. hallucination_rate (0–100): Rate of factual errors or invented information stated by the AI. LOWER IS BETTER — 0 means no hallucinations detected.
5. call_resolution_rate (0–100): Did the call reach a definitive status answer (paid, pending with ETA, rejected with reason)?
6. hold_time_accuracy (0–100): How accurately did the system predict hold time vs actual hold experienced?
7. carrier_compliance (0–100): Did the AI follow carrier-specific protocols (correct IVR sequences, required identifiers, language rules for bilingual carriers)?
8. escalation_appropriateness (0–100): Were escalations to human agents genuinely warranted? High score = escalated only when necessary.

Return JSON in this exact shape:
{
  "dimensions": [
    { "dimension": "ivr_success", "score": <int|null>, "rationale": "<string>" },
    { "dimension": "authentication_success", "score": <int|null>, "rationale": "<string>" },
    { "dimension": "retrieval_accuracy", "score": <int|null>, "rationale": "<string>" },
    { "dimension": "hallucination_rate", "score": <int|null>, "rationale": "<string>" },
    { "dimension": "call_resolution_rate", "score": <int|null>, "rationale": "<string>" },
    { "dimension": "hold_time_accuracy", "score": <int|null>, "rationale": "<string>" },
    { "dimension": "carrier_compliance", "score": <int|null>, "rationale": "<string>" },
    { "dimension": "escalation_appropriateness", "score": <int|null>, "rationale": "<string>" }
  ]
}`;

interface LLMDimensionOutput {
  dimension: EvalDimension;
  score: number | null;
  rationale: string;
}

interface LLMEvalOutput {
  dimensions: LLMDimensionOutput[];
}

async function runLLMEvaluation(transcript: string, carrierId: string): Promise<LLMEvalOutput> {
  const userMessage = `Evaluate this call transcript. Carrier: ${carrierId}.\n\nTranscript:\n${transcript}`;

  assertAllowedEvalModel(EVAL_MODEL, 'AutomatedEval');

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': getAnthropicKey(),
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      ...LLM_RESIDENCY_HEADERS,
    },
    body: JSON.stringify({
      model: EVAL_MODEL,
      max_tokens: 1024,
      system: EVAL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`[AutomatedEval] Anthropic API error: HTTP ${response.status} — ${body}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  const textBlock = data.content.find((c) => c.type === 'text');
  if (!textBlock) throw new Error('[AutomatedEval] No text content in Anthropic response');

  // Strip any markdown code fences the model may have added
  const jsonText = textBlock.text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  return JSON.parse(jsonText) as LLMEvalOutput;
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function scoreDimension(
  raw: LLMDimensionOutput,
): DimensionScore {
  const threshold = DIMENSION_THRESHOLDS[raw.dimension];
  let passed = false;

  if (raw.score !== null) {
    if (LOWER_IS_BETTER.has(raw.dimension)) {
      passed = raw.score <= threshold;
    } else {
      passed = raw.score >= threshold;
    }
  }

  return {
    dimension: raw.dimension,
    score: raw.score,
    passed,
    rationale: raw.rationale,
  };
}

function computeOverallScore(dimensions: DimensionScore[]): number {
  const scorable = dimensions.filter(
    (d) => d.score !== null && !LOWER_IS_BETTER.has(d.dimension),
  );
  if (scorable.length === 0) return 0;
  const sum = scorable.reduce((acc, d) => acc + (d.score ?? 0), 0);
  return Math.round(sum / scorable.length);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a completed call transcript across all 8 quality dimensions.
 *
 * @param callId     DB call record ID (for audit trail)
 * @param transcript Full call transcript text — must NOT contain PHI (names, DOBs)
 * @param carrierId  Carrier string for context (e.g. "canada_life", "sun_life")
 */
export async function evaluateCallTranscript(
  callId: string,
  transcript: string,
  carrierId: string,
): Promise<CallEvalResult> {
  if (!transcript || transcript.trim().length < 50) {
    throw new Error('[AutomatedEval] Transcript too short for meaningful evaluation (< 50 chars)');
  }

  const llmOutput = await runLLMEvaluation(transcript, carrierId);

  // Ensure all 8 dimensions are present — fill missing with null
  const allDimensions: EvalDimension[] = [
    'ivr_success',
    'authentication_success',
    'retrieval_accuracy',
    'hallucination_rate',
    'call_resolution_rate',
    'hold_time_accuracy',
    'carrier_compliance',
    'escalation_appropriateness',
  ];

  const rawByDim = new Map(llmOutput.dimensions.map((d) => [d.dimension, d]));

  const dimensions: DimensionScore[] = allDimensions.map((dim) => {
    const raw = rawByDim.get(dim) ?? {
      dimension: dim,
      score: null,
      rationale: 'Dimension not applicable to this call.',
    };
    return scoreDimension(raw);
  });

  const overallScore = computeOverallScore(dimensions);
  const overallPassed = dimensions
    .filter((d) => d.score !== null)
    .every((d) => d.passed);

  return {
    callId,
    overallScore,
    dimensions,
    evaluatedAt: new Date().toISOString(),
    model: EVAL_MODEL,
    overallPassed,
  };
}

/**
 * Batch-evaluate multiple calls. Processes sequentially to avoid rate limits.
 * Returns results in the same order as the input array.
 */
export async function batchEvaluateCalls(
  calls: Array<{ callId: string; transcript: string; carrierId: string }>,
): Promise<Array<CallEvalResult | { callId: string; error: string }>> {
  const results: Array<CallEvalResult | { callId: string; error: string }> = [];

  for (const call of calls) {
    try {
      const result = await evaluateCallTranscript(call.callId, call.transcript, call.carrierId);
      results.push(result);
    } catch (err) {
      results.push({
        callId: call.callId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/**
 * Aggregate evaluation results into summary statistics for the F-003 report.
 */
export function aggregateEvalResults(results: CallEvalResult[]): {
  totalCalls: number;
  passRate: number;
  avgOverallScore: number;
  dimensionAverages: Record<EvalDimension, number | null>;
} {
  if (results.length === 0) {
    return {
      totalCalls: 0,
      passRate: 0,
      avgOverallScore: 0,
      dimensionAverages: {} as Record<EvalDimension, number | null>,
    };
  }

  const passCount = results.filter((r) => r.overallPassed).length;
  const avgScore = Math.round(
    results.reduce((s, r) => s + r.overallScore, 0) / results.length,
  );

  const dimAccumulator: Record<string, number[]> = {};
  for (const result of results) {
    for (const d of result.dimensions) {
      if (d.score !== null) {
        if (!dimAccumulator[d.dimension]) dimAccumulator[d.dimension] = [];
        dimAccumulator[d.dimension].push(d.score);
      }
    }
  }

  const dimensionAverages = Object.fromEntries(
    Object.entries(dimAccumulator).map(([dim, scores]) => [
      dim,
      Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    ]),
  ) as Record<EvalDimension, number | null>;

  return {
    totalCalls: results.length,
    passRate: Math.round((passCount / results.length) * 100),
    avgOverallScore: avgScore,
    dimensionAverages,
  };
}

export const automatedEval = {
  evaluateCallTranscript,
  batchEvaluateCalls,
  aggregateEvalResults,
  DIMENSION_THRESHOLDS,
} as const;

export default automatedEval;
