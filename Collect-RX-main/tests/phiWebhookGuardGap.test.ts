/**
 * PHI webhook guard — found and strengthened during pre-pilot validation (2026-08-09).
 *
 * The core PHI/Vapi boundary (metadata = UUID token only, PHI only in ephemeral
 * `variables`) is enforced by initiateCall() and is covered by
 * tests/workflowPhiVapiBoundary.test.ts. This file tests the *safety net* behind that
 * boundary — src/services/guardrails/webhookGuard.ts — which is supposed to catch a PHI
 * leak if the boundary is ever violated by a code path that hasn't been audited yet.
 *
 * It's still a regex-based best-effort net, not a substitute for the real boundary —
 * a sufficiently unusual PHI shape can still slip past it. What changed: bare/separated
 * HCN formats, month-name DOBs, an explicit name-shape heuristic, and a full-transcript
 * scan instead of a 5-line sample.
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

describe('FIXED: webhookGuardScanMetadata now catches previously-missed PHI shapes', () => {
  it('catches a full patient name with no digits at all', async () => {
    const result = await webhookGuardScanMetadata(
      payload({
        metadata: { carrierId: 'x', patientToken: 't', practiceId: 'p', note: 'Patient is Jane Elizabeth Doe' } as never,
      }),
    );
    expect(result.hasPhi).toBe(true);
  });

  it('catches a DOB in a common non-ISO, non-slash spoken/written format', async () => {
    const result = await webhookGuardScanMetadata(
      payload({ metadata: { carrierId: 'x', patientToken: 't', practiceId: 'p', note: 'DOB: March 3, 1985' } as never }),
    );
    expect(result.hasPhi).toBe(true);
  });

  it('catches a reversed-order DOB ("3 March 1985")', async () => {
    const result = await webhookGuardScanMetadata(
      payload({ metadata: { carrierId: 'x', patientToken: 't', practiceId: 'p', note: 'born 3 March 1985' } as never }),
    );
    expect(result.hasPhi).toBe(true);
  });

  it('catches a health card number formatted with separators (e.g. 1234-567-890)', async () => {
    const result = await webhookGuardScanMetadata(
      payload({ metadata: { carrierId: 'x', patientToken: 't', practiceId: 'p', note: 'HCN 1234-567-890' } as never }),
    );
    expect(result.hasPhi).toBe(true);
  });

  it('catches a bare "DOB:" label regardless of the date shape after it', async () => {
    const result = await webhookGuardScanMetadata(
      payload({ metadata: { carrierId: 'x', patientToken: 't', practiceId: 'p', note: 'DOB: sometime in 1985' } as never }),
    );
    expect(result.hasPhi).toBe(true);
  });

  it('still passes clean, non-PHI metadata', async () => {
    const result = await webhookGuardScanMetadata(
      payload({ metadata: { carrierId: 'sun_life', patientToken: 't', practiceId: 'p', claimId: 'claim-1' } as never }),
    );
    expect(result.hasPhi).toBe(false);
  });
});

describe('FIXED: webhookGuardScanPayload now scans the full transcript, not a 5-line sample', () => {
  it('catches PHI that appears well after line 5 of the transcript', async () => {
    const leadingLines = Array.from({ length: 5 }, (_, i) => `Line ${i + 1}: general call chatter, nothing sensitive.`);
    const transcriptWithLatePhi = [...leadingLines, 'Line 6: for verification, DOB is 1985-06-12'].join('\n');

    const result = await webhookGuardScanPayload(
      payload({ transcript: transcriptWithLatePhi, analysis: { summary: '', successEvaluation: '' } }),
    );
    expect(result.hasPhi).toBe(true);
  });

  it('catches PHI dozens of lines into a long transcript', async () => {
    const leadingLines = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}: general call chatter, nothing sensitive.`);
    const transcriptWithLatePhi = [...leadingLines, 'Line 41: patient is Jane Elizabeth Doe'].join('\n');

    const result = await webhookGuardScanPayload(
      payload({ transcript: transcriptWithLatePhi, analysis: { summary: '', successEvaluation: '' } }),
    );
    expect(result.hasPhi).toBe(true);
  });
});
