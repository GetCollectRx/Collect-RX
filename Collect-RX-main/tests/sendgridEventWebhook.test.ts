/**
 * SendGrid Event Webhook — payload validation + crash-safety regression.
 *
 * Before this fix, `events = JSON.parse(body) as SgEvent[]` was an unchecked
 * type assertion: any array element that wasn't a plain object (e.g. `null`)
 * threw a TypeError on `ev.prospect_id` access, inside an unguarded `async`
 * Express route handler with no local try/catch. Express 4 doesn't await
 * async handlers, so that throw became an unhandled promise rejection —
 * which this app's `process.on('unhandledRejection', ...)` handler turns
 * into `process.exit(1)`: a single malformed webhook event took down the
 * entire server, not just the one request.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { makeSendgridEventWebhookHandler } from '../src/server/sendgrid/handleSendgridEventWebhook.js';
import { sendgridEventSchema, sendgridEventBatchSchema } from '../src/server/sendgrid/sendgridEventSchema.js';

function fakePrisma(): PrismaClient {
  return {
    prospect: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    emailCampaignEvent: {
      create: vi.fn().mockResolvedValue({ id: 'evt_1' }),
    },
  } as unknown as PrismaClient;
}

function fakeReq(body: unknown): Request {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body), 'utf8');
  return {
    body: raw,
    headers: {},
  } as unknown as Request;
}

function fakeRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    type() {
      return res;
    },
    send(payload: unknown) {
      res.body = payload;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sendgridEventSchema', () => {
  it('accepts a well-formed event with only known optional fields', () => {
    const result = sendgridEventSchema.safeParse({
      event: 'open',
      prospect_id: 'prospect-1',
      email: 'a@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('passes through unknown SendGrid fields it does not read', () => {
    const result = sendgridEventSchema.safeParse({
      event: 'delivered',
      sg_event_id: 'abc123',
      timestamp: 1700000000,
      category: ['test'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an event where a known field has the wrong type', () => {
    const result = sendgridEventSchema.safeParse({ event: 'open', prospect_id: 12345 });
    expect(result.success).toBe(false);
  });

  it('rejects non-object entries (null, string, number)', () => {
    for (const bad of [null, 'not-an-object', 42, true]) {
      expect(sendgridEventSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('batch schema requires a top-level array', () => {
    expect(sendgridEventBatchSchema.safeParse({ event: 'open' }).success).toBe(false);
    expect(sendgridEventBatchSchema.safeParse([]).success).toBe(true);
  });
});

describe('makeSendgridEventWebhookHandler — crash safety', () => {
  it('returns 400 without processing when the body is invalid JSON', async () => {
    const prisma = fakePrisma();
    const handler = makeSendgridEventWebhookHandler(prisma);
    const req = { body: Buffer.from('{not json', 'utf8'), headers: {} } as unknown as Request;
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 without processing when the top-level payload is not an array', async () => {
    const prisma = fakePrisma();
    const handler = makeSendgridEventWebhookHandler(prisma);
    const res = fakeRes();

    await handler(fakeReq({ event: 'open', prospect_id: 'p1' }), res);

    expect(res.statusCode).toBe(400);
    expect(prisma.prospect.findUnique).not.toHaveBeenCalled();
  });

  it('does not throw when the batch contains malformed elements (null, string, wrong-typed field) mixed with valid ones', async () => {
    const prisma = fakePrisma();
    const handler = makeSendgridEventWebhookHandler(prisma);
    const res = fakeRes();

    const batch = [
      null,
      'not-an-object',
      42,
      { event: 'open', prospect_id: 999 }, // wrong type for prospect_id
      { event: 'open', prospect_id: 'valid-prospect' }, // valid — should still be processed
    ];

    await expect(handler(fakeReq(batch), res)).resolves.not.toThrow();
    expect(res.statusCode).toBe(200);
    // The one valid event in the batch was still processed despite the
    // four malformed entries around it.
    expect(prisma.prospect.findUnique).toHaveBeenCalledWith({
      where: { id: 'valid-prospect' },
    });
  });

  it('processes a fully valid batch and returns 200', async () => {
    const prisma = fakePrisma();
    const handler = makeSendgridEventWebhookHandler(prisma);
    const res = fakeRes();

    await handler(
      fakeReq([
        { event: 'open', prospect_id: 'p1' },
        { event: 'bounce', prospect_id: 'p2', reason: 'mailbox full' },
      ]),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(prisma.prospect.findUnique).toHaveBeenCalledTimes(2);
  });

  it('skips events with no prospect_id without error', async () => {
    const prisma = fakePrisma();
    const handler = makeSendgridEventWebhookHandler(prisma);
    const res = fakeRes();

    await expect(
      handler(fakeReq([{ event: 'open' }, {}]), res),
    ).resolves.not.toThrow();
    expect(res.statusCode).toBe(200);
    expect(prisma.prospect.findUnique).not.toHaveBeenCalled();
  });
});
