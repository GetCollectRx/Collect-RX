/**
 * Anti-hallucination gate — known gaps found during pre-pilot validation (2026-08-09).
 *
 * `outcomeConfidence.ts` downgrades a financial-terminal outcome (RESOLVED / DENIED /
 * APPROVED_PENDING_PAYMENT) to ESCALATED unless it is corroborated by either (a) a
 * schema-validated structured carrier payload, or (b) a captured reference number.
 * These tests document two ways that corroboration can be satisfied without the
 * carrier ever actually confirming anything — i.e. the gate can be defeated by the
 * exact class of hallucination it exists to catch.
 *
 * These are RED tests by design where noted: they assert the current (gapped)
 * behaviour so the gap is provable and regress-testable, not that the gap is fine.
 */
import { describe, expect, it } from 'vitest';
import { classifyOutcome } from '../src/outcome/processor.js';
import { gateFinancialOutcome, hasFinancialCorroboration } from '../src/server/outcomeConfidence.js';
import { claimStatusFromCallOutcome } from '../src/server/claimStatusFromCallOutcome.js';
import { resolveOutcomeFromWebhookPayload } from '../src/outcome/webhookOutcomeResolver.js';
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

describe('GAP: fabricated reference number defeats the anti-hallucination gate', () => {
  it('a hallucinated LLM call-summary with an invented reference number classifies as RESOLVED, not ESCALATED', () => {
    // The carrier rep's actual words (transcript) never confirm resolution.
    const transcript = 'Rep: I show this claim as still in adjudication, please call back next week.';
    // Vapi\'s own LLM-generated `analysis.summary` can itself hallucinate a clean narrative —
    // this is not user input, it is a second model summarizing the first model\'s call.
    const hallucinatedSummary =
      'The representative confirmed the claim has been processed and payment issued. Reference number is REF98765.';

    const payload = basePayload({
      transcript,
      analysis: { summary: hallucinatedSummary, successEvaluation: '' },
    });

    const processed = classifyOutcome(payload);
    // Fabricated resolution language + fabricated reference number, purely from the summary.
    // (extractReferenceNumber matches against the lowercased fullText, so casing isn't preserved.)
    expect(processed.outcome).toBe('RESOLVED');
    expect(processed.referenceNumber?.toLowerCase()).toBe('ref98765');

    const corroboration = { hasStructuredPayload: false, referenceNumber: processed.referenceNumber };
    expect(hasFinancialCorroboration(corroboration)).toBe(true); // GAP: passes corroboration on a fabricated number.

    const gated = gateFinancialOutcome('RESOLVED', corroboration);
    expect(gated.status).toBe('RESOLVED'); // GAP: should have been held as ESCALATED pending human verification.
    expect(gated.requiresHumanVerification).toBe(false);

    const finalStatus = claimStatusFromCallOutcome('RESOLVED', hallucinatedSummary, 45000, null, corroboration);
    expect(finalStatus).toBe('RESOLVED'); // GAP: this is the status that would be persisted to the claim.
  });

  it('control: with no reference number and no structured payload, the same fabricated RESOLVED IS correctly held for review', () => {
    const payload = basePayload({
      transcript: 'Rep: still processing.',
      analysis: { summary: 'Claim has been processed and payment issued.', successEvaluation: '' },
    });
    const processed = classifyOutcome(payload);
    expect(processed.outcome).toBe('RESOLVED');
    expect(processed.referenceNumber).toBeNull();

    const corroboration = { hasStructuredPayload: false, referenceNumber: processed.referenceNumber };
    const gated = gateFinancialOutcome('RESOLVED', corroboration);
    expect(gated.status).toBe('ESCALATED'); // Correct — the gate does its job when there's no fabricated reference number.
    expect(gated.requiresHumanVerification).toBe(true);
  });
});

describe('GAP: the high-trust "structured payload" corroboration path is unreachable with the deployed squad config', () => {
  it('vapi-squad-config.json does not produce metadata.collectrx / analysis.collectrx anywhere', () => {
    const raw = JSON.stringify(squadConfig);
    // The gate treats a structured payload as automatic corroboration (schemaVersion-checked,
    // see CollectrxWebhookStructured in src/vapi/client.ts). Nothing in the deployed squad
    // config produces that shape — Claims_Agent's firstMessage is a literal string, and its
    // analysisPlan.structuredDataPlan schema has no `collectrx` wrapper key or `schemaVersion`
    // field. It populates `analysis.structuredData` instead, which a *different*, unrelated
    // pipeline (src/webhooks/vapi.ts claims-validator path) reads — not the hallucination gate.
    expect(raw.includes('collectrx')).toBe(false);
    expect(raw.includes('schemaVersion')).toBe(false);
  });

  it('resolveOutcomeFromWebhookPayload() ignores analysis.structuredData — the shape the deployed squad actually sends', () => {
    // This mirrors the *real* shape Vapi sends given vapi-squad-config.json's
    // analysisPlan.structuredDataPlan: analysis.structuredData, not analysis.collectrx.
    // If the "trusted structured payload" path were reachable, this call's outcome would
    // come from `structuredData.outcome` ('CLAIM_PAID'). Instead it silently falls through
    // to the regex transcript classifier, because resolveOutcomeFromWebhookPayload only
    // ever looks at metadata.collectrx / analysis.collectrx (see CollectrxWebhookStructured
    // in src/vapi/client.ts) — a key the deployed squad config never populates.
    const payload = basePayload({
      transcript: 'no clear resolution language here',
      analysis: {
        summary: '',
        successEvaluation: '',
        structuredData: { claimNumber: 'CLM-1', outcome: 'CLAIM_PAID', referenceNumber: 'REF1' },
      },
    });
    const resolved = resolveOutcomeFromWebhookPayload(payload);
    // Falls back to the regex classifier's verdict on the transcript (HUNG_UP / no match),
    // completely ignoring the carrier's actual structured 'CLAIM_PAID' signal sitting right
    // there in analysis.structuredData.
    expect(resolved.outcome).not.toBe('RESOLVED');
    // Practical consequence: `hasStructuredPayload` is always false in production today,
    // so every financial-terminal outcome depends entirely on the reference-number path
    // demonstrated as fabricable above — there is no fallback to a stronger signal.
  });
});
