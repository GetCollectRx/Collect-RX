/**
 * PHI webhook guard — known gap found during pre-pilot validation (2026-08-09).
 *
 * The core PHI/Vapi boundary (metadata = UUID token only, PHI only in ephemeral
 * `variables`) is enforced by initiateCall() and is covered by
 * tests/workflowPhiVapiBoundary.test.ts. This file tests the *safety net* behind that
 * boundary — src/services/guardrails/webhookGuard.ts — which is supposed to catch a PHI
 * leak if the boundary is ever violated by a code path that hasn't been audited yet.
 *
 * The guard only checks 3 regexes: a bare 10-digit number, and two DOB formats
 * (YYYY-MM-DD, MM/DD/YYYY). It has no concept of a patient name at all. These tests are
 * RED by design: they demonstrate realistic PHI shapes the guard does not catch.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/guardrails/audit.js', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { webhookGuardScanMetadata, webhookGuardScanPayload } from '../src/services/guardrails/webhookGuard.js';
import type { VapiWebhookPayload } from '../src/vapi/client.js';

function payload(overrides: Partial<VapiWebhookPayload> = {}): VapiWebhookPayload {
  return {
    type: 'call.ended',
    call: { id: 'call-1', status: 'ended', durationSeconds: 60 },
    ...overrides,
  };
}

describe('webhookGuardScanMetadata — control cases the guard DOES catch', () => {
  it('flags a bare 10-digit number (health-card-shaped)', async () => {
    const result = await webhookGuardScanMetadata(
      payload({ metadata: { carrierId: 'x', patientToken: 't', practiceId: 'p', note: '1234567890' } as never }),
    );
    expect(result.hasPhi).toBe(true);
  });

  it('flags an ISO-format DOB', async () => {
    const result = await webhookGuardScanMetadata(
      payload({ metadata: { carrierId: 'x', patientToken: 't', practiceId: 'p', note: '1985-06-12' } as never }),
    );
    expect(result.hasPhi).toBe(true);
  });
});

describe('GAP: webhookGuardScanMetadata misses realistic PHI shapes', () => {
  it('MISSES a full patient name with no digits at all', async () => {
    const result = await webhookGuardScanMetadata(
      payload({
        metadata: { carrierId: 'x', patientToken: 't', practiceId: 'p', note: 'Patient is Jane Elizabeth Doe' } as never,
      }),
    );
    // GAP: the guard has zero name-pattern detection. A leaked patient name in any
    // metadata field is invisible to this safety net.
    expect(result.hasPhi).toBe(false);
  });

  it('MISSES a DOB in a common non-ISO, non-slash spoken/written format', async () => {
    const result = await webhookGuardScanMetadata(
      payload({ metadata: { carrierId: 'x', patientToken: 't', practiceId: 'p', note: 'DOB: March 3, 1985' } as never }),
    );
    // GAP: only YYYY-MM-DD and MM/DD/YYYY are covered. "Month D, YYYY" — a very common
    // way a transcript or summary would render a spoken date of birth — is invisible.
    expect(result.hasPhi).toBe(false);
  });

  it('MISSES a health card number formatted with separators (e.g. 1234-567-890)', async () => {
    const result = await webhookGuardScanMetadata(
      payload({ metadata: { carrierId: 'x', patientToken: 't', practiceId: 'p', note: 'HCN 1234-567-890' } as never }),
    );
    // GAP: the 10-digit regex requires an unbroken \b\d{10}\b run. Provincial health
    // card numbers are frequently rendered with separators and won't match.
    expect(result.hasPhi).toBe(false);
  });
});

describe('GAP: webhookGuardScanPayload only samples the first 5 transcript lines', () => {
  it('MISSES PHI that appears after line 5 of the transcript', async () => {
    const leadingLines = Array.from({ length: 5 }, (_, i) => `Line ${i + 1}: general call chatter, nothing sensitive.`);
    const transcriptWithLatePhi = [...leadingLines, 'Line 6: for verification, DOB is 1985-06-12'].join('\n');

    const result = await webhookGuardScanPayload(
      payload({ transcript: transcriptWithLatePhi, analysis: { summary: '', successEvaluation: '' } }),
    );
    // GAP: the function comment says "we'll audit the full transcript post-call; just flag
    // obvious patterns here" — but no code path in this repo actually performs that fuller
    // audit. The 5-line sample is the only check that runs, so PHI beyond line 5 is missed.
    expect(result.hasPhi).toBe(false);
  });
});
