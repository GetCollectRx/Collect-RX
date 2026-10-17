/**
 * Regression test for the verify_payment_amount claim-lookup path.
 *
 * src/webhooks/vapi.ts resolves the server-side "expected" amount for a
 * claim as `outstandingAmount ?? billedAmount` (outstandingAmount is the
 * primary source; billedAmount is the fallback for claims that don't carry
 * an outstanding balance yet). This exercises that fallback specifically —
 * no prior test sent a claimId, so the claim-lookup branch (including the
 * billedAmount fallback) had zero coverage.
 *
 * Regression context: claimContext's inline type previously omitted
 * `billedAmount` even though it was selected from Prisma, which failed
 * `tsc --noEmit` (TS2339) without being a runtime failure — ts-node/tsx
 * don't type-check. This test covers the runtime behavior; the type itself
 * is guarded by the normal build/typecheck gate, not by this test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const { findUnique } = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    insuranceClaim: { findUnique },
  },
}));

import { app } from '../src/server/index.js';

function secret(): string {
  return process.env.VAPI_WEBHOOK_SECRET ?? 'test_vapi_secret_12345678';
}

function toolCallPayloadWithClaim(
  claimId: string,
  statedAmount: string,
  fallbackExpectedAmount: string,
): Record<string, unknown> {
  return {
    message: {
      type: 'tool-calls',
      call: {
        id: 'vapi-call-claim-amount',
        assistantOverrides: { metadata: { claimId } },
      },
      toolWithToolCallList: [
        {
          name: 'verify_payment_amount',
          toolCall: {
            id: 'tc_claim_amount_1',
            function: {
              name: 'verify_payment_amount',
              // Deliberately wrong/distinct from the DB value: if the
              // server-side claim lookup (and its billedAmount fallback)
              // silently fails, this is what the response falls through to
              // — so the assertion below fails loudly instead of passing
              // for the wrong reason.
              arguments: JSON.stringify({ statedAmount, expectedAmount: fallbackExpectedAmount }),
            },
          },
        },
      ],
    },
  };
}

describe('POST /api/webhooks/vapi — verify_payment_amount claim lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to billedAmount when outstandingAmount is null', async () => {
    findUnique.mockResolvedValue({
      claimNumber: 'CLM-FALLBACK-1',
      practiceId: 'practice-1',
      carrierId: 'sun_life',
      outstandingAmount: null,
      billedAmount: '1250.00',
    });

    const res = await request(app)
      .post('/api/webhooks/vapi')
      .set('x-vapi-secret', secret())
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(toolCallPayloadWithClaim('claim-fallback-1', '1250.00', '9999.00')));

    expect(res.status).toBe(200);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'claim-fallback-1' } }),
    );
    // If the billedAmount fallback had silently failed, the server would
    // have used the tool-supplied 9999.00 instead and reported a shortfall.
    expect(res.body.results[0].result).toContain('AMOUNT OK');
    expect(res.body.results[0].result).not.toContain('SHORTFALL DETECTED');
  });

  it('prefers outstandingAmount over billedAmount when both are present', async () => {
    findUnique.mockResolvedValue({
      claimNumber: 'CLM-OUTSTANDING-1',
      practiceId: 'practice-1',
      carrierId: 'sun_life',
      outstandingAmount: '410.00',
      billedAmount: '1250.00',
    });

    const res = await request(app)
      .post('/api/webhooks/vapi')
      .set('x-vapi-secret', secret())
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(toolCallPayloadWithClaim('claim-outstanding-1', '410.00', '9999.00')));

    expect(res.status).toBe(200);
    expect(res.body.results[0].result).toContain('AMOUNT OK');
  });
});
