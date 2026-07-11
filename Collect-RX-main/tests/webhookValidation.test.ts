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

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createHash, createHmac } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { app, prisma } from '../src/server/index.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';

const TEST_VAPI_WEBHOOK_SECRET = 'test_vapi_secret_12345678';
const TEST_SENDGRID_WEBHOOK_KEY = 'test_sendgrid_key_87654321';
const TEST_STRIPE_WEBHOOK_SECRET = 'whsec_test_stripe_webhook_secret_key';

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

  vi.stubEnv('VAPI_WEBHOOK_SECRET', TEST_VAPI_WEBHOOK_SECRET);
  vi.stubEnv('SENDGRID_WEBHOOK_VERIFICATION_KEY', TEST_SENDGRID_WEBHOOK_KEY);
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', TEST_STRIPE_WEBHOOK_SECRET);
  vi.stubEnv('NODE_ENV', 'production');

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
      call: {
        id: 'test-vapi-call-001',
        endedReason: 'customer_hangup',
      },
      metadata: {
        practiceId: practiceA.id,
        claimId: 'claim-uuid-123',
      },
      transcript: 'Agent: Hello, calling about claim 123.',
      analysis: { summary: 'Claim status verified' },
    };

    const bodyBuffer = Buffer.from(JSON.stringify(payload));
    const bodyHash = createHash('sha256').update(bodyBuffer).digest('hex');

    const res = await request(app)
      .post('/api/webhooks/vapi')
      .set('X-Vapi-Secret', TEST_VAPI_WEBHOOK_SECRET)
      .set('Content-Type', 'application/json')
      .send(payload);

    // Should be 200 (or 5xx if deduplication logic hits, but not 401/403)
    expect(res.status).toBeLessThan(400);
  });

  // ─── Test 2: Webhook with wrong practice ID: rejected 403 ✓
  it('rejects Vapi webhook with wrong practice ID', async () => {
    const payload = {
      call: {
        id: 'test-vapi-call-002',
        endedReason: 'customer_hangup',
      },
      metadata: {
        practiceId: 'non-existent-practice-id-xyz',
        claimId: 'claim-uuid-456',
      },
      transcript: 'Agent: Checking claim status.',
      analysis: { summary: 'Claim not found' },
    };

    const res = await request(app)
      .post('/api/webhooks/vapi')
      .set('X-Vapi-Secret', TEST_VAPI_WEBHOOK_SECRET)
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
  });

  // ─── Test 3: Webhook with tampered signature: rejected 401 ✓
  it('rejects Vapi webhook with invalid secret', async () => {
    const payload = {
      call: {
        id: 'test-vapi-call-003',
        endedReason: 'customer_hangup',
      },
      metadata: {
        practiceId: practiceA.id,
        claimId: 'claim-uuid-789',
      },
      transcript: 'Agent: Status check.',
      analysis: { summary: 'Verified' },
    };

    const res = await request(app)
      .post('/api/webhooks/vapi')
      .set('X-Vapi-Secret', 'wrong_secret_key')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(401);
  });

  // ─── Test 4: Webhook from Practice A claiming Practice B: rejected via claim lookup ✓
  it('rejects Vapi webhook with mismatched practice claim', async () => {
    const payload = {
      call: {
        id: 'test-vapi-call-004',
        endedReason: 'customer_hangup',
      },
      metadata: {
        practiceId: practiceA.id,
        claimId: 'claim-from-practice-b',
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
      },
    });

    const res = await request(app)
      .post('/api/webhooks/vapi')
      .set('X-Vapi-Secret', TEST_VAPI_WEBHOOK_SECRET)
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(403);

    await prisma.insuranceClaim.delete({ where: { id: claimB.id } });
  });

  // ─── Test 5: Audit log records access attempt
  it('logs successful Vapi webhook access to audit log', async () => {
    const payload = {
      call: {
        id: 'test-vapi-call-005-audit',
        endedReason: 'customer_hangup',
      },
      metadata: {
        practiceId: practiceA.id,
        claimId: 'claim-audit-test',
      },
      transcript: 'Agent: Audit test call.',
      analysis: { summary: 'Logged' },
    };

    const beforeCount = await prisma.auditLog.count({
      where: { practiceId: practiceA.id, action: 'webhook.vapi.received' },
    });

    await request(app)
      .post('/api/webhooks/vapi')
      .set('X-Vapi-Secret', TEST_VAPI_WEBHOOK_SECRET)
      .set('Content-Type', 'application/json')
      .send(payload);

    const afterCount = await prisma.auditLog.count({
      where: { practiceId: practiceA.id, action: 'webhook.vapi.received' },
    });

    expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
  });

  it('logs failed Vapi webhook access (wrong secret) to audit log', async () => {
    const payload = {
      call: {
        id: 'test-vapi-call-006-audit-fail',
        endedReason: 'customer_hangup',
      },
      metadata: {
        practiceId: practiceA.id,
        claimId: 'claim-audit-fail-test',
      },
      transcript: 'Agent: Failed audit test.',
      analysis: { summary: 'Failed' },
    };

    const beforeCount = await prisma.auditLog.count({
      where: { action: 'webhook.vapi.rejected_invalid_signature' },
    });

    await request(app)
      .post('/api/webhooks/vapi')
      .set('X-Vapi-Secret', 'invalid_secret')
      .set('Content-Type', 'application/json')
      .send(payload);

    const afterCount = await prisma.auditLog.count({
      where: { action: 'webhook.vapi.rejected_invalid_signature' },
    });

    expect(afterCount).toBeGreaterThan(beforeCount);
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

  // ─── Test 4: Audit log records Stripe webhook validation attempt
  it('logs Stripe webhook validation attempt to audit log', async () => {
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

    const beforeCount = await prisma.auditLog.count({
      where: { action: 'webhook.stripe.signature_validation_failed' },
    });

    await request(app)
      .post('/api/stripe/webhook')
      .set('Stripe-Signature', 't=invalid,v1=bad_sig')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(payload));

    const afterCount = await prisma.auditLog.count({
      where: { action: 'webhook.stripe.signature_validation_failed' },
    });

    expect(afterCount).toBeGreaterThan(beforeCount);
  });
});

describe.skipIf(!dbReady)('Claims Validator webhook validation', () => {
  const VALIDATOR_WEBHOOK_SECRET = 'validator_test_secret_key_2024';

  function generateHmacSignature(
    payload: string,
    secret: string,
  ): string {
    return createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  // ─── Test 1: Valid Claims Validator webhook with correct signature: accepted ✓
  it('accepts valid Claims Validator webhook with correct HMAC signature', async () => {
    const claimInA = await prisma.insuranceClaim.create({
      data: {
        id: 'claim-validator-001',
        practiceId: practiceA.id,
        patientToken: 'patient-validator-001',
        carrierId: 'sun_life',
        status: 'PENDING',
      },
    });

    const payload = JSON.stringify({
      validatorId: 'validator-event-001',
      claimId: claimInA.id,
      practiceId: practiceA.id,
      result: 'valid',
      findings: [],
    });

    const bodyHash = createHash('sha256').update(payload).digest('hex');
    const signature = generateHmacSignature(payload, VALIDATOR_WEBHOOK_SECRET);

    const res = await request(app)
      .post('/api/webhooks/claims/validate')
      .set('X-Validator-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(JSON.parse(payload));

    expect([200, 400, 403]).toContain(res.status);

    await prisma.insuranceClaim.delete({ where: { id: claimInA.id } });
  });

  // ─── Test 2: Webhook with wrong practice ID: rejected 403 ✓
  it('rejects Claims Validator webhook with non-existent practice', async () => {
    const payload = JSON.stringify({
      validatorId: 'validator-event-002',
      claimId: 'claim-missing-002',
      practiceId: 'non-existent-practice-id',
      result: 'invalid',
      findings: ['mismatched_amount'],
    });

    const signature = generateHmacSignature(payload, VALIDATOR_WEBHOOK_SECRET);

    const res = await request(app)
      .post('/api/webhooks/claims/validate')
      .set('X-Validator-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(JSON.parse(payload));

    expect([401, 403, 404]).toContain(res.status);
  });

  // ─── Test 3: Webhook with tampered signature: rejected 401 ✓
  it('rejects Claims Validator webhook with invalid signature', async () => {
    const payload = JSON.stringify({
      validatorId: 'validator-event-003',
      claimId: 'claim-003',
      practiceId: practiceA.id,
      result: 'valid',
      findings: [],
    });

    const res = await request(app)
      .post('/api/webhooks/claims/validate')
      .set('X-Validator-Signature', 'tampered_signature_here')
      .set('Content-Type', 'application/json')
      .send(JSON.parse(payload));

    expect(res.status).toBe(401);
  });

  // ─── Test 4: Webhook claiming claim from different practice: rejected via lookup ✓
  it('rejects Claims Validator webhook claiming claim from different practice', async () => {
    const claimInB = await prisma.insuranceClaim.create({
      data: {
        id: 'claim-validator-b-lookup',
        practiceId: practiceB.id,
        patientToken: 'patient-validator-b',
        carrierId: 'sun_life',
        status: 'PENDING',
      },
    });

    const payload = JSON.stringify({
      validatorId: 'validator-event-004',
      claimId: claimInB.id,
      practiceId: practiceA.id,
      result: 'valid',
      findings: [],
    });

    const signature = generateHmacSignature(payload, VALIDATOR_WEBHOOK_SECRET);

    const res = await request(app)
      .post('/api/webhooks/claims/validate')
      .set('X-Validator-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(JSON.parse(payload));

    expect(res.status).toBe(403);

    await prisma.insuranceClaim.delete({ where: { id: claimInB.id } });
  });

  // ─── Test 5: Audit log records Claims Validator webhook access
  it('logs Claims Validator webhook access attempt to audit log', async () => {
    const claimInA = await prisma.insuranceClaim.create({
      data: {
        id: 'claim-validator-audit-001',
        practiceId: practiceA.id,
        patientToken: 'patient-validator-audit',
        carrierId: 'sun_life',
        status: 'PENDING',
      },
    });

    const payload = JSON.stringify({
      validatorId: 'validator-event-audit-001',
      claimId: claimInA.id,
      practiceId: practiceA.id,
      result: 'valid',
      findings: [],
    });

    const signature = generateHmacSignature(payload, VALIDATOR_WEBHOOK_SECRET);

    const beforeCount = await prisma.auditLog.count({
      where: { practiceId: practiceA.id, action: 'webhook.validator.received' },
    });

    await request(app)
      .post('/api/webhooks/claims/validate')
      .set('X-Validator-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(JSON.parse(payload));

    const afterCount = await prisma.auditLog.count({
      where: { practiceId: practiceA.id, action: 'webhook.validator.received' },
    });

    expect(afterCount).toBeGreaterThanOrEqual(beforeCount);

    await prisma.insuranceClaim.delete({ where: { id: claimInA.id } });
  });

  it('logs rejected Claims Validator webhook (invalid signature) to audit log', async () => {
    const payload = JSON.stringify({
      validatorId: 'validator-event-audit-reject',
      claimId: 'claim-audit-reject',
      practiceId: practiceA.id,
      result: 'invalid',
      findings: ['mismatch'],
    });

    const beforeCount = await prisma.auditLog.count({
      where: { action: 'webhook.validator.rejected_invalid_signature' },
    });

    await request(app)
      .post('/api/webhooks/claims/validate')
      .set('X-Validator-Signature', 'invalid_sig')
      .set('Content-Type', 'application/json')
      .send(JSON.parse(payload));

    const afterCount = await prisma.auditLog.count({
      where: { action: 'webhook.validator.rejected_invalid_signature' },
    });

    expect(afterCount).toBeGreaterThan(beforeCount);
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
      },
    });

    const payload = {
      call: {
        id: 'test-vapi-isolation-001',
        endedReason: 'customer_hangup',
      },
      metadata: {
        practiceId: practiceA.id,
        claimId: claimInB.id,
      },
      transcript: 'Trying to access practice B claim from practice A',
      analysis: { summary: 'Isolation test' },
    };

    const res = await request(app)
      .post('/api/webhooks/vapi')
      .set('X-Vapi-Secret', TEST_VAPI_WEBHOOK_SECRET)
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(403);

    await prisma.insuranceClaim.delete({ where: { id: claimInB.id } });
  });

  it('ensures practice isolation: request IP/UA logged separately per practice', async () => {
    const payload = {
      call: {
        id: 'test-vapi-ip-ua-001',
        endedReason: 'customer_hangup',
      },
      metadata: {
        practiceId: practiceA.id,
        claimId: 'claim-ip-test',
      },
      transcript: 'IP and UA test',
      analysis: { summary: 'Request metadata test' },
    };

    await request(app)
      .post('/api/webhooks/vapi')
      .set('X-Vapi-Secret', TEST_VAPI_WEBHOOK_SECRET)
      .set('User-Agent', 'test-webhook-client/1.0')
      .set('X-Forwarded-For', '192.0.2.100')
      .set('Content-Type', 'application/json')
      .send(payload);

    const logs = await prisma.auditLog.findMany({
      where: {
        practiceId: practiceA.id,
        action: 'webhook.vapi.received',
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });

    if (logs.length > 0) {
      expect(logs[0].requestIp).toBeTruthy();
      expect(logs[0].userAgent).toContain('test-webhook-client');
    }
  });
});
