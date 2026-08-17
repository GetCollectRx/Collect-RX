/**
 * Anti-hallucination gate — found and partly fixed during pre-pilot validation (2026-08-09).
 *
 * `outcomeConfidence.ts` downgrades a financial-terminal outcome (RESOLVED / DENIED /
 * APPROVED_PENDING_PAYMENT) to ESCALATED unless it is corroborated by either (a) a
 * schema-validated structured carrier payload, or (b) a captured reference number.
 *
 * FIXED: `classifyOutcome()` (src/outcome/processor.ts) used to derive resolution
 * language and the reference number from `transcript + analysis.summary +
 * analysis.successEvaluation` combined — but `summary`/`successEvaluation` are
 * themselves LLM-generated interpretations of the call, not carrier speech, and can
 * hallucinate a clean "resolved, ref #X" narrative independent of what was actually
 * said. Financial classification now reads the raw `transcript` only.
 *
 * STILL OPEN (not fixed here — a harder problem): the transcript itself includes the
 * AI agent's own turns, not just the carrier rep's. If the agent parrots back or
 * invents a reference number mid-call, that still lands in `transcript` and can still
 * satisfy the reference-number corroboration path. Closing that fully needs
 * speaker-attributed extraction (only trust reference numbers attributed to the rep's
 * turns), which isn't implemented — see the last test below.
 */
import { describe, expect, it } from 'vitest';
import { classifyOutcome } from '../src/outcome/processor.js';
import { gateFinancialOutcome, hasFinancialCorroboration } from '../src/server/outcomeConfidence.js';
import { claimStatusFromCallOutcome } from '../src/server/claimStatusFromCallOutcome.js';
import { resolveOutcomeFromWebhookPayload, extractStructuredClaimStatus } from '../src/outcome/webhookOutcomeResolver.js';
import type { VapiWebhookPayload } from '../src/vapi/client.js';
import squadConfig from '../vapi-squad-config.json';

function basePayload(overrides: Partial<VapiWebhookPayload> = {}): VapiWebhookPayload {
  return {
    type: 'call.ended',
    call: { id: 'call-1', status: 'ended', durationSeconds: 180 },
    transcript: '',
    ...overrides,
  };
}

describe('FIXED: a hallucinated call-summary can no longer manufacture a RESOLVED outcome', () => {
  it('a hallucinated LLM call-summary with an invented reference number is ignored — transcript governs', () => {
    // The carrier rep's actual words (transcript) never confirm resolution.
    const transcript = 'Rep: I show this claim as still in adjudication, please call back next week.';
    // Vapi's own LLM-generated `analysis.summary` can itself hallucinate a clean narrative —
    // this is not user input, it is a second model summarizing the first model's call.
    const hallucinatedSummary =
      'The representative confirmed the claim has been processed and payment issued. Reference number is REF98765.';

    const payload = basePayload({
      transcript,
      analysis: { summary: hallucinatedSummary, successEvaluation: '' },
    });

    const processed = classifyOutcome(payload);
    // Classification now comes from the transcript ("still in adjudication") — the
    // fabricated summary text is never consulted for financial-outcome purposes.
    expect(processed.outcome).toBe('PENDING');
    expect(processed.referenceNumber).toBeNull();

    const corroboration = { hasStructuredPayload: false, referenceNumber: processed.referenceNumber };
    const finalStatus = claimStatusFromCallOutcome(processed.outcome, hallucinatedSummary, 45000, null, corroboration);
    expect(finalStatus).not.toBe('RESOLVED');
  });

  it('control: a real resolution + real reference number in the transcript still resolves normally', () => {
    const payload = basePayload({
      transcript: 'Rep: I can confirm payment was issued. Reference number is REF12345.',
      analysis: { summary: '', successEvaluation: '' },
    });
    const processed = classifyOutcome(payload);
    expect(processed.outcome).toBe('RESOLVED');
    expect(processed.referenceNumber?.toLowerCase()).toBe('ref12345');

    const corroboration = { hasStructuredPayload: false, referenceNumber: processed.referenceNumber };
    const gated = gateFinancialOutcome('RESOLVED', corroboration);
    expect(gated.status).toBe('RESOLVED');
    expect(gated.requiresHumanVerification).toBe(false);
  });

  it('control: with no reference number and no structured payload, an unconfirmed RESOLVED IS correctly held for review', () => {
    const payload = basePayload({
      transcript: 'Rep: claim has been processed and payment issued.',
      analysis: { summary: '', successEvaluation: '' },
    });
    const processed = classifyOutcome(payload);
    expect(processed.outcome).toBe('RESOLVED');
    expect(processed.referenceNumber).toBeNull();

    const corroboration = { hasStructuredPayload: false, referenceNumber: processed.referenceNumber };
    const gated = gateFinancialOutcome('RESOLVED', corroboration);
    expect(gated.status).toBe('ESCALATED'); // Correct — the gate does its job when there's no reference number.
    expect(gated.requiresHumanVerification).toBe(true);
  });

  it('STILL OPEN: a reference number the AI agent itself speaks, inside the transcript, is still trusted', () => {
    // This is the harder residual risk noted above: extractReferenceNumber has no
    // concept of speaker turns, so a number the *agent* says (not just the rep) still
    // counts as corroboration. Fixing this needs speaker-attributed transcript parsing.
    const payload = basePayload({
      transcript:
        'AI: Great, I can confirm the claim has been processed and payment issued. Reference number is REF00000. Rep: okay.',
      analysis: { summary: '', successEvaluation: '' },
    });
    const processed = classifyOutcome(payload);
    expect(processed.outcome).toBe('RESOLVED');
    expect(processed.referenceNumber?.toLowerCase()).toBe('ref00000');
    const corroboration = { hasStructuredPayload: false, referenceNumber: processed.referenceNumber };
    expect(hasFinancialCorroboration(corroboration)).toBe(true); // Known residual gap — not yet fixed.
  });
});

describe('FIXED: the structured-payload corroboration path now reads what the deployed squad actually sends', () => {
  it('vapi-squad-config.json still does not produce metadata.collectrx / analysis.collectrx (informational)', () => {
    const raw = JSON.stringify(squadConfig);
    // Confirms the squad config itself is unchanged (not touched by this fix, which is
    // backend-only) — it still populates analysis.structuredData, not a `collectrx` key.
    expect(raw.includes('collectrx')).toBe(false);
    expect(raw.includes('schemaVersion')).toBe(false);
  });

  it('resolveOutcomeFromWebhookPayload() now reads analysis.structuredData — the real deployed shape', () => {
    const payload = basePayload({
      transcript: 'no clear resolution language here',
      analysis: {
        summary: '',
        successEvaluation: '',
        structuredData: { claimNumber: 'CLM-1', outcome: 'CLAIM_PAID', referenceNumber: 'REF1' },
      },
    });
    const resolved = resolveOutcomeFromWebhookPayload(payload);
    expect(resolved.outcome).toBe('RESOLVED');
    expect(resolved.referenceNumber).toBe('REF1');
  });

  it('extractStructuredClaimStatus() recognizes the squad shape too, so hasStructuredPayload is true downstream', () => {
    const payload = basePayload({
      analysis: {
        summary: '',
        successEvaluation: '',
        structuredData: { claimNumber: 'CLM-1', outcome: 'CLAIM_PAID' },
      },
    });
    expect(extractStructuredClaimStatus(payload)).toBe('RESOLVED');
  });

  it('PARTIAL_PAYMENT never auto-resolves — routes to ESCALATED per the Claims_Agent prompt\'s own rule', () => {
    const payload = basePayload({
      analysis: {
        summary: '',
        successEvaluation: '',
        structuredData: { claimNumber: 'CLM-1', outcome: 'PARTIAL_PAYMENT', referenceNumber: 'REF2' },
      },
    });
    const resolved = resolveOutcomeFromWebhookPayload(payload);
    expect(resolved.outcome).toBe('ESCALATED');
    expect(extractStructuredClaimStatus(payload)).toBe('ESCALATED');
  });

  it('an unrecognized outcome enum value or missing claimNumber falls back to the transcript classifier, not a guess', () => {
    const badOutcome = basePayload({
      transcript: 'no clear resolution language here',
      analysis: { structuredData: { claimNumber: 'CLM-1', outcome: 'NOT_A_REAL_ENUM_VALUE' } },
    });
    expect(resolveOutcomeFromWebhookPayload(badOutcome).outcome).not.toBe('RESOLVED');

    const missingClaimNumber = basePayload({
      transcript: 'no clear resolution language here',
      analysis: { structuredData: { outcome: 'CLAIM_PAID' } },
    });
    expect(resolveOutcomeFromWebhookPayload(missingClaimNumber).outcome).not.toBe('RESOLVED');
  });
});
