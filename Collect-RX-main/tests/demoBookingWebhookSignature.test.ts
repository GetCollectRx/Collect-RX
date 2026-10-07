import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createDemoBookingWebhookRouter } from '../src/server/routes/demoBookingWebhookRouter.js';

/**
 * Cal.com and Calendly both sign the raw request body and reject a real
 * delivery if the server tries to verify against a re-serialized copy of
 * it — so these tests send the exact bytes both ways: once to compute the
 * signature, once as the request body, the same way the production route
 * receives them (mounted behind express.raw(), not express.json()).
 */
const SECRET = 'test-demo-booking-secret';

function buildApp() {
  const app = express();
  // prospect lookups are unreachable in this test (no real DB) — that's
  // fine, since the assertions only need to distinguish "rejected before
  // reaching business logic" (401) from "got past the signature check."
  const fakePrisma = {} as PrismaClient;
  app.use(
    '/api/webhooks/demo-booking',
    express.raw({ type: 'application/json' }),
    createDemoBookingWebhookRouter(fakePrisma),
  );
  return app;
}

function calComSignature(rawBody: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(rawBody).digest('hex')}`;
}

function calendlySignature(rawBody: string, timestamp: string): string {
  const digest = createHmac('sha256', SECRET).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

describe('demo booking webhook — signature verification', () => {
  const originalSecret = process.env.MARKETING_DEMO_WEBHOOK_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.MARKETING_DEMO_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    process.env.MARKETING_DEMO_WEBHOOK_SECRET = originalSecret;
    process.env.NODE_ENV = originalNodeEnv;
  });

  const calComBody = JSON.stringify({
    triggerEvent: 'BOOKING_CREATED',
    payload: {
      uid: 'test-uid-123',
      startTime: '2026-08-25T14:00:00.000Z',
      attendees: [{ email: 'test@example.com' }],
    },
  });

  it('accepts a Cal.com delivery with a correctly computed signature', async () => {
    const res = await request(buildApp())
      .post('/api/webhooks/demo-booking')
      .set('Content-Type', 'application/json')
      .set('X-Cal-Signature-256', calComSignature(calComBody))
      .send(calComBody);

    expect(res.status).not.toBe(401);
    expect(res.body.error).not.toBe('Unauthorized');
  });

  it('rejects a Cal.com delivery with a wrong signature', async () => {
    const res = await request(buildApp())
      .post('/api/webhooks/demo-booking')
      .set('Content-Type', 'application/json')
      .set('X-Cal-Signature-256', 'sha256=0000000000000000000000000000000000000000000000000000000000000000')
      .send(calComBody);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, error: 'Unauthorized' });
  });

  it('rejects a Cal.com-shaped delivery whose signature was computed over a different body', async () => {
    const tamperedBody = JSON.stringify({
      triggerEvent: 'BOOKING_CREATED',
      payload: { uid: 'tampered', startTime: '2026-08-25T14:00:00.000Z', attendees: [] },
    });
    const res = await request(buildApp())
      .post('/api/webhooks/demo-booking')
      .set('Content-Type', 'application/json')
      .set('X-Cal-Signature-256', calComSignature(calComBody)) // signed for the original body
      .send(tamperedBody);

    expect(res.status).toBe(401);
  });

  const calendlyBody = JSON.stringify({
    event: 'invitee.created',
    payload: {
      email: 'test@example.com',
      uri: 'https://api.calendly.com/scheduled_events/test/invitees/test',
      scheduled_event: { start_time: '2026-08-25T14:00:00.000Z' },
    },
  });

  it('accepts a Calendly delivery with a correctly computed t=/v1= signature', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await request(buildApp())
      .post('/api/webhooks/demo-booking')
      .set('Content-Type', 'application/json')
      .set('Calendly-Webhook-Signature', calendlySignature(calendlyBody, timestamp))
      .send(calendlyBody);

    expect(res.status).not.toBe(401);
    expect(res.body.error).not.toBe('Unauthorized');
  });

  it('rejects a Calendly delivery with a wrong signature', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await request(buildApp())
      .post('/api/webhooks/demo-booking')
      .set('Content-Type', 'application/json')
      .set('Calendly-Webhook-Signature', `t=${timestamp},v1=deadbeef`)
      .send(calendlyBody);

    expect(res.status).toBe(401);
  });

  it('accepts a generic internal booking with the raw shared-secret header', async () => {
    const genericBody = JSON.stringify({
      prospectId: 'p1',
      scheduledAt: '2026-08-25T14:00:00.000Z',
      source: 'internal-test',
    });
    const res = await request(buildApp())
      .post('/api/webhooks/demo-booking')
      .set('Content-Type', 'application/json')
      .set('X-CollectRx-Webhook-Secret', SECRET)
      .send(genericBody);

    expect(res.status).not.toBe(401);
  });

  it('rejects a request with no signature and no secret header when a secret is configured', async () => {
    const res = await request(buildApp())
      .post('/api/webhooks/demo-booking')
      .set('Content-Type', 'application/json')
      .send(calComBody);

    expect(res.status).toBe(401);
  });

  it('fails closed in production when no secret is configured at all', async () => {
    delete process.env.MARKETING_DEMO_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'production';

    const res = await request(buildApp())
      .post('/api/webhooks/demo-booking')
      .set('Content-Type', 'application/json')
      .send(calComBody);

    expect(res.status).toBe(401);
  });
});
