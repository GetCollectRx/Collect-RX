/**
 * In-call tool webhook: verify_payment_amount answered synchronously at
 * /api/webhooks/vapi, authenticated by either HMAC signature or the
 * per-tool x-vapi-secret header. Nothing is persisted for tool calls.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createHmac } from 'crypto';
import { app } from '../src/server/index.js';

function secret(): string {
  return process.env.VAPI_WEBHOOK_SECRET ?? 'test_vapi_secret_12345678';
}

function toolCallPayload(statedAmount: string, expectedAmount: string): Record<string, unknown> {
  return {
    message: {
      type: 'tool-calls',
      toolWithToolCallList: [
        {
          name: 'verify_payment_amount',
          toolCall: {
            id: 'tc_test_1',
            function: {
              name: 'verify_payment_amount',
              arguments: JSON.stringify({ statedAmount, expectedAmount }),
            },
          },
        },
      ],
    },
  };
}

describe('POST /api/webhooks/vapi — tool-calls', () => {
  it('answers verify_payment_amount with the shortfall directive via x-vapi-secret auth', async () => {
    const res = await request(app)
      .post('/api/webhooks/vapi')
      .set('x-vapi-secret', secret())
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(toolCallPayload('410 dollars', '$1,250.00')));
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].toolCallId).toBe('tc_test_1');
    expect(res.body.results[0].result).toContain('SHORTFALL DETECTED');
    expect(res.body.results[0].result).toContain('PARTIAL_PAYMENT');
  });

  it('answers via HMAC signature auth as well', async () => {
    const body = Buffer.from(JSON.stringify(toolCallPayload('$1,250.00', '$1,250.00')), 'utf8');
    const sig = `sha256=${createHmac('sha256', secret()).update(body).digest('hex')}`;
    const res = await request(app)
      .post('/api/webhooks/vapi')
      .set('x-vapi-signature', sig)
      .set('Content-Type', 'application/json')
      .send(body.toString());
    expect(res.status).toBe(200);
    expect(res.body.results[0].result).toContain('AMOUNT OK');
  });

  it('rejects a wrong x-vapi-secret', async () => {
    const res = await request(app)
      .post('/api/webhooks/vapi')
      .set('x-vapi-secret', 'wrong-secret')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(toolCallPayload('410', '1250')));
    expect(res.status).toBe(401);
  });

  it('rejects when no auth header is present at all', async () => {
    const res = await request(app)
      .post('/api/webhooks/vapi')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(toolCallPayload('410', '1250')));
    expect(res.status).toBe(401);
  });
});
