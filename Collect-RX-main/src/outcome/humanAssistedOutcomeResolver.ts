// ─────────────────────────────────────────────────────────────────────────────
// V1 human-assisted squad — outcome derivation from ground truth, not a guess.
//
// For the fully-autonomous squad, `resolveOutcomeFromWebhookPayload` has to fall
// back on `classifyOutcome()`, which regex-matches Vapi/assistant-generated
// transcript + summary + successEvaluation text. That is a best-effort guess.
//
// For a human-assisted call, practice staff spoke with the rep directly and
// Claims_Scribe's `log_call_outcome` tool captured what staff heard — a
// structured, human-witnessed record (`HumanAssistedCallLog`). That is strictly
// higher-trust than anything Vapi's own analysis can produce, so it is treated
// exactly like a schema-validated `metadata.collectrx` structured payload: it
// wins outright, no text parsing, and it satisfies the anti-hallucination
// financial-corroboration gate in `outcomeConfidence.ts` (see `claimStatus`
// below, threaded through as `structuredClaimStatus` — mirrors the trust model
// `resolveGatedClaimStatus` already gives `metadata.collectrx`).
//
// Scenario → outcome / claim-status mapping is intentionally conservative:
// anything with real financial or documentation ambiguity (a shortfall, a
// transfer, "unclear") lands on ESCALATED rather than being auto-resolved, so
// a human reviews it before the platform acts on the claim or the money.
// ───────────────────────────────────────────────────────────────────────────

import type { CallOutcome, ClaimStatus, HumanAssistedCallLog } from '@prisma/client';
import type { ProcessedOutcome } from './processor';

interface ScenarioMapping {
  outcome: CallOutcome;
  /** Either a fixed ClaimStatus, or a function of the log for scenarios where a
   *  single field (e.g. matchesExpectedAmount) changes the right status. */
  claimStatus: ClaimStatus | ((log: HumanAssistedCallLog) => ClaimStatus);
}

/**
 * Mirrors the SCENARIOS list in Claims_Scribe's system prompt (Vapi dashboard).
 * Keep in sync if that list changes — an unrecognized scenario falls back to
 * the UNCLEAR mapping (ESCALATED) rather than guessing.
 */
const SCENARIO_MAP: Record<string, ScenarioMapping> = {
  // Carrier has no record of the claim — practice must resubmit. Actionable,
  // not just "wait and call back", so it goes to a human rather than the
  // automatic retry cadence.
  CLAIM_NOT_RECEIVED: { outcome: 'PENDING', claimStatus: 'ESCALATED' },

  NOT_COVERED: { outcome: 'DENIED', claimStatus: 'DENIED' },
  MAX_BENEFITS_REACHED: { outcome: 'DENIED', claimStatus: 'DENIED' },

  // Carrier wants documentation before it will proceed — a practice action,
  // not a call-back.
  NEED_INFORMATION: { outcome: 'ESCALATED', claimStatus: 'ESCALATED' },

  // Still adjudicating on the carrier's normal timeline — natural retry.
  PROCESSING: { outcome: 'PENDING', claimStatus: 'PENDING' },

  // Rep confirmed payment. Only auto-resolve when the amount was confirmed to
  // match what CollectRx expected; a stated mismatch always goes to a human.
  CLAIM_PAID: {
    outcome: 'RESOLVED',
    claimStatus: (log) => (log.matchesExpectedAmount === false ? 'ESCALATED' : 'RESOLVED'),
  },

  // A shortfall was confirmed by a human on the call — real, not inferred —
  // but whether to accept it or appeal is a staff decision, so it always
  // lands on ESCALATED rather than auto-closing the claim.
  PARTIAL_PAYMENT: { outcome: 'RESOLVED', claimStatus: 'ESCALATED' },

  CLAIM_DENIED: { outcome: 'DENIED', claimStatus: 'DENIED' },

  // Call didn't reach a resolution with this rep — needs deliberate follow-up
  // rather than silently requeuing.
  TRANSFER: { outcome: 'ESCALATED', claimStatus: 'ESCALATED' },

  UNCLEAR: { outcome: 'ESCALATED', claimStatus: 'ESCALATED' },
};

/** Claims_Scribe is told to use the literal string "unknown" as a placeholder. */
function cleanOptional(v: string | null | undefined): string | null {
  const t = v?.trim();
  if (!t || t.toLowerCase() === 'unknown' || t.toLowerCase() === 'none') return null;
  return t;
}

export interface HumanAssistedResolution {
  processed: ProcessedOutcome;
  /** Fed to `resolveGatedClaimStatus` as `structuredClaimStatus` — wins over any
   *  text-inferred status and counts as corroboration for the financial gate. */
  structuredClaimStatus: ClaimStatus;
}

/**
 * Build a `ProcessedOutcome` + claim status directly from the human-witnessed
 * call log, bypassing `classifyOutcome()`'s transcript/summary regex entirely.
 */
export function resolveOutcomeFromHumanAssistedLog(
  log: HumanAssistedCallLog,
  callMeta: { transcriptUrl: string | null; durationSeconds: number | null },
): HumanAssistedResolution {
  const mapping = SCENARIO_MAP[log.scenario] ?? SCENARIO_MAP.UNCLEAR;
  const claimStatus =
    typeof mapping.claimStatus === 'function' ? mapping.claimStatus(log) : mapping.claimStatus;

  const detailParts = [log.callSummary.trim()];
  const unresolved = cleanOptional(log.unresolvedFields);
  if (unresolved) detailParts.push(`Unresolved: ${unresolved}.`);
  if (log.automationSuspicionFlag) {
    detailParts.push('Rep indicated at some point they suspected an automated caller.');
  }

  const processed: ProcessedOutcome = {
    outcome: mapping.outcome,
    outcomeDetail: detailParts.join(' ').slice(0, 2000) || `[human-assisted] ${log.scenario}`,
    repName: cleanOptional(log.repName),
    referenceNumber: cleanOptional(log.referenceNumber),
    transcriptUrl: callMeta.transcriptUrl,
    durationSeconds: callMeta.durationSeconds,
    // Human-assisted calls are staff-driven end to end — the automated-block
    // detector (BLOCK_SIGNAL_PATTERNS in processor.ts) targets a fully
    // autonomous call getting stonewalled, which doesn't apply here.
    carrierBlockDetected: false,
  };

  return { processed, structuredClaimStatus: claimStatus };
}
