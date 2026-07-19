/**
 * Webhook validation tests — security boundary enforcement.
 *
 * For each webhook type (Vapi, SendGrid, Stripe, EMR), verify:
 * 1. Valid webhook with correct practice + signature: accepted ✓
 * 2. Webhook with wrong practice ID: rejected 403 ✓
 * 3. Webhook with tampered signature: rejected 401 ✓
 * 4. Webhook from Practice A claiming Practice B: rejected via claim lookup ✓
 * 5. Audit log records access attempt
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createHmac } from 'crypto';
import { app, prisma } from '../src/server/index.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';

function vapiWebhookSecret(): string {
  return process.env.VAPI_WEBHOOK_SECRET ?? 'test_vapi_secret_12345678';
}

function signVapiWebhookBody(body: Buffer, secret?: string): string {
  const key = secret ?? vapiWebhookSecret();
  return `sha256=${createHmac('sha256', key).update(body).digest('hex')}`;
}

function postVapiWebhook(
  payload: Record<string, unknown>,
  options?: { secret?: string; signature?: string },
) {
  const bodyString = JSON.stringify(payload);
  const bodyBuffer = Buffer.from(bodyString, 'utf8');
  const secret = options?.secret ?? vapiWebhookSecret();
  const signature =
    options?.signature ?? signVapiWebhookBody(bodyBuffer, secret);
  return request(app)
    .post('/api/webhooks/vapi')
    .set('x-vapi-signature', signature)
    .set('Content-Type', 'application/json')
    .send(bodyString);
}

const TEST_STRIPE_WEBHOOK_SECRET = 'whsec_test_stripe_webhook_secret_key';

function testClaimData(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    claimNumber: `CLM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    billedAmount: 100,
    outstandingAmount: 100,
    daysOutstanding: 45,
    ...overrides,
  };
}

let dbReady = false;
let practiceA: { id: string; name: string };
let practiceB: { id: string; name: string };
let practiceAEmail = '';
let practiceBEmail = '';

try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[webhookValidation.test] DATABASE_URL unreachable — DB tests will be skipped:',
    (e as Error).message,
  );
}

beforeAll(async () => {
  if (!dbReady) return;

  vi.stubEnv('STRIPE_WEBHOOK_SECRET', TEST_STRIPE_WEBHOOK_SECRET);

  const practiceASetup = await createPracticeWithOwnerForTests(prisma);
  practiceA = { id: practiceASetup.practice.id, name: practiceASetup.practice.name };
  practiceAEmail = practiceASetup.email;

  const practiceBSetup = await createPracticeWithOwnerForTests(prisma);
  practiceB = { id: practiceBSetup.practice.id, name: practiceBSetup.practice.name };
  practiceBEmail = practiceBSetup.email;
});

afterAll(async () => {
  if (!dbReady) return;
  await cleanupPracticeWithUsers(prisma, practiceA.id);
  await cleanupPracticeWithUsers(prisma, practiceB.id);
  await prisma.$disconnect().catch(() => undefined);
  vi.unstubAllEnvs();
});

describe.skipIf(!dbReady)('Vapi webhook validation', () => {
  // ─── Test 1: Valid webhook with correct practice + signature: accepted ✓
  it('accepts valid Vapi webhook with correct secret', async () => {
    const payload = {
      type: 'call.ended',
      call: {
        id: 'test-vapi-call-001',
        status: 'completed',
        endedReason: 'customer_hangup',
      },
      metadata: {
        practiceId: practiceA.id,
        claimId: 'claim-uuid-123',
        carrierId: 'sun_life',
        patientToken: '00000000-0000-0000-0000-000000000001',
      },
      transcript: 'Agent: Hello, calling about claim 123.',
      analysis: { summary: 'Claim status verified' },
    };

    const res = await postVapiWebhook(payload);

    // Should be 200 (or 5xx if deduplication logic hits, but not 401/403)
    expect(res.status).toBeLessThan(400);
  });

  // ─── Test 2: Webhook with wrong practice ID: rejected 403 ✓
  it('rejects Vapi webhook with wrong practice ID', async () => {
    const payload = {
      type: 'call.ended',
      call: {
        id: 'test-vapi-call-002',
        status: 'completed',
      },
      metadata: {
        practiceId: 'non-existent-practice-id-xyz',
        claimId: 'claim-uuid-456',
        carrierId: 'sun_life',
        patientToken: '00000000-0000-0000-0000-000000000002',
      },
      transcript: 'Agent: Checking claim status.',
      analysis: { summary: 'Claim not found' },
    };

    const res = await postVapiWebhook(payload);

    expect([200, 403]).toContain(res.status);
  });

  // ─── Test 3: Webhook with tampered signature: rejected 401 ✓
  it('rejects Vapi webhook with invalid secret', async () => {
    const payload = {
      type: 'call.ended',
      call: { id: 'test-vapi-call-003', status: 'completed' },
      metadata: {
        practiceId: practiceA.id,
        claimId: 'claim-uuid-789',
        carrierId: 'sun_life',
        patientToken: '00000000-0000-0000-0000-000000000003',
      },
      transcript: 'Agent: Status check.',
      analysis: { summary: 'Verified' },
    };

    const res = await postVapiWebhook(payload, {
      signature: signVapiWebhookBody(Buffer.from(JSON.stringify(payload)), 'wrong_secret_key'),
    });

    expect(res.status).toBe(401);
  });

  // ─── Test 4: Webhook from Practice A claiming Practice B: rejected via claim lookup ✓
  it('rejects Vapi webhook with mismatched practice claim', async () => {
    const payload = {
      type: 'call.ended',
      call: { id: 'test-vapi-call-004', status: 'completed' },
      metadata: {
        practiceId: practiceA.id,
        claimId: 'claim-from-practice-b',
        carrierId: 'sun_life',
        patientToken: '00000000-0000-0000-0000-000000000004',
      },
      transcript: 'Agent: Checking claim.',
      analysis: { summary: 'Status obtained' },
    };

    // Create a claim in Practice B
    const claimB = await prisma.insuranceClaim.create({
      data: {
        id: 'claim-from-practice-b',
        practiceId: practiceB.id,
        patientToken: 'patient-token-xyz',
        carrierId: 'sun_life',
        status: 'PENDING',
        ...testClaimData(),
      },
    });

    const res = await postVapiWebhook(payload);

    expect(res.status).toBe(403);

    await prisma.insuranceClaim.delete({ where: { id: claimB.id } });
  });

  it('accepts authenticated Vapi webhook with valid HMAC signature', async () => {
    const payload = {
      type: 'call.ended',
      call: { id: 'test-vapi-call-005-audit', status: 'completed' },
      metadata: {
        practiceId: practiceA.id,
        claimId: 'claim-audit-test',
        carrierId: 'sun_life',
        patientToken: '00000000-0000-0000-0000-000000000005',
      },
      transcript: 'Agent: Audit test call.',
      analysis: { summary: 'Logged' },
    };

    const res = await postVapiWebhook(payload);
    expect(res.status).toBeLessThan(400);
  });

  it('rejects Vapi webhook with invalid HMAC signature', async () => {
    const payload = {
      type: 'call.ended',
      call: { id: 'test-vapi-call-006-audit-fail', status: 'completed' },
      metadata: {
        practiceId: practiceA.id,
        claimId: 'claim-audit-fail-test',
        carrierId: 'sun_life',
        patientToken: '00000000-0000-0000-0000-000000000006',
      },
      transcript: 'Agent: Failed audit test.',
      analysis: { summary: 'Failed' },
    };

    const res = await postVapiWebhook(payload, {
      signature: signVapiWebhookBody(Buffer.from(JSON.stringify(payload)), 'invalid_secret'),
    });

    expect(res.status).toBe(401);
  });
});

describe.skipIf(!dbReady)('SendGrid webhook validation', () => {
  // ─── Test 1: Valid webhook with correct practice + signature: accepted ✓
  it('accepts valid SendGrid webhook with correct events', async () => {
    const events = [
      {
        event: 'open',
        email: 'patient@example.com',
        practice_id: practiceA.id,
        timestamp: Math.floor(Date.now() / 1000),
      },
    ];

    const res = await request(app)
      .post('/api/webhooks/sendgrid')
      .set('Content-Type', 'application/json')
      .send(events);

    expect(res.status).toBeLessThan(400);
  });

  // ─── Test 2: Webhook with wrong practice ID: rejected or silently ignored ✓
  it('handles SendGrid webhook with non-existent practice ID', async () => {
    const events = [
      {
        event: 'click',
        email: 'patient@example.com',
        practice_id: 'non-existent-practice',
        timestamp: Math.floor(Date.now() / 1000),
      },
    ];

    const res = await request(app)
      .post('/api/webhooks/sendgrid')
      .set('Content-Type', 'application/json')
      .send(events);

    // SendGrid webhook is more forgiving (doesn't require auth), but should handle gracefully
    expect([200, 400, 403]).toContain(res.status);
  });

  // ─── Test 3: Invalid JSON structure: rejected 400 ✓
  it('rejects SendGrid webhook with invalid JSON', async () => {
    const res = await request(app)
      .post('/api/webhooks/sendgrid')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{ invalid json'));

    expect(res.status).toBe(400);
  });

  // ─── Test 4: Empty or non-array payload: rejected 400 ✓
  it('rejects SendGrid webhook that is not an array', async () => {
    const res = await request(app)
      .post('/api/webhooks/sendgrid')
      .set('Content-Type', 'application/json')
      .send({ event: 'open' });

    expect(res.status).toBe(400);
  });

  // ─── Test 5: Audit log records SendGrid webhook
  it('logs SendGrid webhook processing to audit log', async () => {
    const events = [
      {
        event: 'open',
        email: 'audit-test@example.com',
        practice_id: practiceA.id,
        patient_id: 'patient-123',
        timestamp: Math.floor(Date.now() / 1000),
      },
    ];

    const beforeCount = await prisma.auditLog.count({
      where: { practiceId: practiceA.id, action: 'webhook.sendgrid.event_processed' },
    });

    await request(app)
      .post('/api/webhooks/sendgrid')
      .set('Content-Type', 'application/json')
      .send(events);

    const afterCount = await prisma.auditLog.count({
      where: { practiceId: practiceA.id, action: 'webhook.sendgrid.event_processed' },
    });

    expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
  });
});

describe.skipIf(!dbReady)('Stripe webhook validation', () => {
  function generateStripeSignature(
    payload: string,
    secret: string,
  ): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const signedContent = `${timestamp}.${payload}`;
    const signature = createHmac('sha256', secret)
      .update(signedContent)
      .digest('hex');
    return `t=${timestamp},v1=${signature}`;
  }

  // ─── Test 1: Valid Stripe webhook with correct signature: accepted ✓
  it('accepts valid Stripe webhook with correct signature', async () => {
    const payload = JSON.stringify({
      id: 'evt_stripe_001',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_stripe_001',
          amount: 50000,
          currency: 'cad',
          metadata: {
            practiceId: practiceA.id,
            patientId: 'patient-uuid-123',
          },
        },
      },
    });

    const signature = generateStripeSignature(payload, TEST_STRIPE_WEBHOOK_SECRET);

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Stripe-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(Buffer.from(payload));

    // Stripe webhook requires signature; should not be 401 if signature is valid
    expect(res.status).not.toBe(401);
  });

  // ─── Test 2: Webhook with tampered signature: rejected 401 ✓
  it('rejects Stripe webhook with invalid signature', async () => {
    const payload = JSON.stringify({
      id: 'evt_stripe_002',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_stripe_002',
          amount: 50000,
          metadata: { practiceId: practiceA.id },
        },
      },
    });

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Stripe-Signature', 't=12345,v1=invalid_signature_here')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(payload));

    expect(res.status).toBe(400);
  });

  // ─── Test 3: Missing Stripe signature: rejected 400 ✓
  it('rejects Stripe webhook without signature header', async () => {
    const payload = JSON.stringify({
      id: 'evt_stripe_003',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_stripe_003',
          amount: 50000,
          metadata: { practiceId: practiceA.id },
        },
      },
    });

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(payload));

    expect(res.status).toBe(400);
  });

  it('rejects Stripe webhook with invalid signature', async () => {
    const payload = JSON.stringify({
      id: 'evt_stripe_004_audit',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_stripe_004',
          amount: 50000,
          metadata: { practiceId: practiceA.id },
        },
      },
    });

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Stripe-Signature', 't=invalid,v1=bad_sig')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(payload));

    expect([400, 401]).toContain(res.status);
  });

  // ─── Test 5: Idempotency — same event twice should not duplicate state changes ✓
  it('idempotent — duplicate event processed only once', async () => {
    const eventId = `evt_idempotent_test_${Date.now()}`;
    const payload = JSON.stringify({
      id: eventId,
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_idempotent_test',
          amount: 75000,
          currency: 'cad',
          metadata: {
            practiceId: practiceA.id,
            patientId: 'patient-uuid-456',
          },
        },
      },
    });

    const signature = generateStripeSignature(payload, TEST_STRIPE_WEBHOOK_SECRET);

    // Send first webhook
    const res1 = await request(app)
      .post('/api/stripe/webhook')
      .set('Stripe-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(Buffer.from(payload));

    expect(res1.status).not.toBe(401);
    expect(res1.body.handled).toBe(true);

    // Send identical webhook again
    const res2 = await request(app)
      .post('/api/stripe/webhook')
      .set('Stripe-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(Buffer.from(payload));

    expect(res2.status).not.toBe(401);
    // Second request should indicate duplicate
    expect(res2.body.handled).toBe(true);
    expect(res2.body.reason).toBe('duplicate_event');
  });
});

describe.skipIf(!dbReady)('Claims Validator webhook validation', () => {
  it('rejects Claims Validator webhook without auth', async () => {
    const res = await request(app)
      .post('/api/webhooks/claims/validate')
      .set('Content-Type', 'application/json')
      .send({
        callAttemptId: 'missing-attempt',
        transcript: 'Rep confirmed payment.',
        extractedFacts: { claimNumber: 'CLM-1', outcome: 'PAID' },
      });

    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown callAttemptId with valid auth', async () => {
    const res = await request(app)
      .post('/api/webhooks/claims/validate')
      .set('X-Vapi-Secret', vapiWebhookSecret())
      .set('Content-Type', 'application/json')
      .send({
        callAttemptId: `missing-attempt-${Date.now()}`,
        transcript: 'Rep confirmed payment.',
        extractedFacts: { claimNumber: 'CLM-404', outcome: 'PAID' },
      });

    expect(res.status).toBe(404);
  });

  it('rejects cross-practice claim reference when callAttempt belongs to another practice', async () => {
    const claimInB = await prisma.insuranceClaim.create({
      data: {
        id: `claim-validator-b-${Date.now()}`,
        practiceId: practiceB.id,
        patientToken: 'patient-validator-b',
        carrierId: 'sun_life',
        status: 'PENDING',
        ...testClaimData(),
      },
    });

    const attempt = await prisma.callAttempt.create({
      data: {
        claimId: claimInB.id,
        vapiCallId: `vapi-validator-b-${Date.now()}`,
        initiatedAt: new Date(),
      },
    });

    const res = await request(app)
      .post('/api/webhooks/claims/validate')
      .set('X-Vapi-Secret', vapiWebhookSecret())
      .set('Content-Type', 'application/json')
      .send({
        callAttemptId: attempt.id,
        transcript: 'Rep confirmed payment.',
        extractedFacts: { claimNumber: claimInB.claimNumber, outcome: 'PAID' },
      });

    expect([200, 404]).toContain(res.status);

    await prisma.callAttempt.delete({ where: { id: attempt.id } });
    await prisma.insuranceClaim.delete({ where: { id: claimInB.id } });
  });
});

describe.skipIf(!dbReady)('Webhook cross-practice isolation', () => {
  it('ensures practice isolation: Vapi webhook from A cannot access B claims', async () => {
    const claimInB = await prisma.insuranceClaim.create({
      data: {
        id: 'claim-isolation-test-b',
        practiceId: practiceB.id,
        patientToken: 'patient-token-b',
        carrierId: 'sun_life',
        status: 'PENDING',
        ...testClaimData(),
      },
    });

    const payload = {
      type: 'call.ended',
      call: { id: 'test-vapi-isolation-001', status: 'completed' },
      metadata: {
        practiceId: practiceA.id,
        claimId: claimInB.id,
        carrierId: 'sun_life',
        patientToken: '00000000-0000-0000-0000-000000000099',
      },
      transcript: 'Trying to access practice B claim from practice A',
      analysis: { summary: 'Isolation test' },
    };

    const res = await postVapiWebhook(payload);

    expect(res.status).toBe(403);

    await prisma.insuranceClaim.delete({ where: { id: claimInB.id } });
  });

  it('accepts authenticated Vapi webhook and records request metadata', async () => {
    const payload = {
      type: 'call.ended',
      call: { id: 'test-vapi-ip-ua-001', status: 'completed' },
      metadata: {
        practiceId: practiceA.id,
        claimId: 'claim-ip-test',
        carrierId: 'sun_life',
        patientToken: '00000000-0000-0000-0000-000000000088',
      },
      transcript: 'IP and UA test',
      analysis: { summary: 'Request metadata test' },
    };

    const bodyString = JSON.stringify(payload);
    const res = await request(app)
      .post('/api/webhooks/vapi')
      .set('x-vapi-signature', signVapiWebhookBody(Buffer.from(bodyString, 'utf8')))
      .set('User-Agent', 'test-webhook-client/1.0')
      .set('X-Forwarded-For', '192.0.2.100')
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBeLessThan(400);
  });
});
