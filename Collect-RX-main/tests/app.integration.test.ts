/**
 * P7-03 + P7-04 — API and auth; P7-02 — Stripe webhook (HTTP + handler).
 *
 * Liveness and “missing signature” run without a database. DB-dependent cases are skipped
 * with a clear log if `DATABASE_URL` is unreachable (e.g. laptop without VPN, wrong host).
 * CI has Postgres; `npm test` there should be fully green.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { handleWebhook, signOnboardReturn } from '../src/server/stripe/connect.js';
import { app, prisma } from '../src/server/index.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';

const TEST_STRIPE_SECRET = 'whsec_test_00000000000000000000000000000000';
const TEST_STRIPE_KEY = 'sk_test_4eC39HqLyjWDarjtT1zdp7dc';
const STRIPE_API_VERSION = '2026-03-25.dahlia' as const;

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[app.integration] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
    (e as Error).message
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

describe('API (integration) — liveness (no DB required for /api/health)', () => {
  it('GET /api/health returns 200', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/health/metrics includes deployment flags (no secrets)', async () => {
    const res = await request(app).get('/api/health/metrics');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const m = res.body.metrics;
    expect(m.deployment).toMatchObject({
      nodeEnv: expect.any(String),
      redisUrlSet: expect.any(Boolean),
      schedulerDisabled: expect.any(Boolean),
      vapiWebhookSecretSet: expect.any(Boolean),
    });
    expect(m).not.toHaveProperty('databaseUrl');
  });
});

describe('Practice-scoped APIs — require authentication', () => {
  it('GET /api/insurance/claims returns 401 without session', async () => {
    const res = await request(app).get('/api/insurance/claims');
    expect(res.status).toBe(401);
  });

  it('GET /api/queue/priority-scores returns 401 without session', async () => {
    const res = await request(app).get('/api/queue/priority-scores');
    expect(res.status).toBe(401);
  });

  it('GET /api/queue/carrier-order returns 401 without session', async () => {
    const res = await request(app).get('/api/queue/carrier-order');
    expect(res.status).toBe(401);
  });

  it('GET /api/work-queue returns 401 without session', async () => {
    const res = await request(app).get('/api/work-queue');
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/sync/runs returns 401 without session', async () => {
    const res = await request(app).get('/api/admin/sync/runs');
    expect(res.status).toBe(401);
  });

  it('GET /api/analytics/phase5-kpis returns 401 without session', async () => {
    const res = await request(app).get('/api/analytics/phase5-kpis');
    expect(res.status).toBe(401);
  });
});

describe('Public patient pay — no auth', () => {
  it('GET /api/public/pay/:token returns 410 (patient outreach permanently disabled)', async () => {
    const res = await request(app).get('/api/public/pay/nonexistent-token-for-tests');
    expect(res.status).toBe(410);
    expect(res.headers['content-type']).toMatch(/json/i);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/insurance-carrier recovery only/i) });
  });

  it('GET /api/public/pay/:token returns 410 for a valid-format token too', async () => {
    const res = await request(app).get('/api/public/pay/00000000000000000000000000000000');
    expect(res.status).toBe(410);
    expect(res.headers['content-type']).toMatch(/json/i);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/insurance-carrier recovery only/i) });
  });
});

describe('Stripe Connect — onboard return URL must be signed or session', () => {
  const pid = '00000000-0000-4000-8000-00000000dead';

  it('GET /api/stripe/connect/onboard/complete rejects practice_id without v or session', async () => {
    const res = await request(app).get('/api/stripe/connect/onboard/complete').query({ practice_id: pid });
    expect(res.status).toBe(403);
  });

  it('GET /api/stripe/connect/onboard/complete redirects when v matches practice_id', async () => {
    const v = signOnboardReturn(pid);
    const res = await request(app)
      .get('/api/stripe/connect/onboard/complete')
      .query({ practice_id: pid, v })
      .redirects(0);
    expect(res.status).toBe(303);
  });

  it('GET /api/stripe/connect/onboard/refresh rejects without v or session', async () => {
    const res = await request(app).get('/api/stripe/connect/onboard/refresh').query({ practice_id: pid });
    expect(res.status).toBe(403);
  });
});

describe('Webhooks — SendGrid (raw JSON, no DB)', () => {
  it('POST /api/webhooks/sendgrid returns 400 when body is not a JSON array', async () => {
    const res = await request(app)
      .post('/api/webhooks/sendgrid')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));
    expect(res.status).toBe(400);
  });

  it('POST /api/webhooks/sendgrid returns 400 for invalid JSON', async () => {
    const res = await request(app)
      .post('/api/webhooks/sendgrid')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('not-json'));
    expect(res.status).toBe(400);
  });

  it('POST /api/webhooks/sendgrid returns 200 for events that do not trigger opt-out', async () => {
    const payload = JSON.stringify([{ event: 'open', email: 'noop@example.com' }]);
    const res = await request(app)
      .post('/api/webhooks/sendgrid')
      .set('Content-Type', 'application/json; charset=utf-8')
      .send(payload);
    expect(res.status).toBe(200);
  });
});

describe('Stripe webhook (HTTP) — P7-02', () => {
  it('returns 400 when stripe-signature is missing', async () => {
    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));
    expect(res.status).toBe(400);
  });
});

describe.skipIf(!dbReady)('API (integration) — P7-03, P7-04 (database)', () => {
  it('GET /api/health/ready returns 200 with DB', async () => {
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('POST /api/auth/login returns 400 without body', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/auth/login returns 401 for unknown user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody-unknown@fixture.test', password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/login returns 200 for a valid user', async () => {
    const { practice, email, password } = await createPracticeWithOwnerForTests(prisma);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    expect(res.body.practice?.id).toBe(practice.id);
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    expect(cookieHeader).toMatch(/crx_access=/);
    expect(res.body.health).toBeDefined();
    expect(res.body.health.ok).toBe(true);
    expect(Array.isArray(res.body.health.checks)).toBe(true);
    const sessionHealth = await request(app)
      .get('/api/auth/session-health')
      .set('Cookie', cookieHeader);
    expect(sessionHealth.status).toBe(200);
    expect(sessionHealth.body.ok).toBe(true);
    await cleanupPracticeWithUsers(prisma, practice.id);
  });

  it('GET /api/auth/session-health is 401 without session', async () => {
    const res = await request(app).get('/api/auth/session-health');
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me is 401 without session', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

/**
 * Call `handleWebhook` directly with the raw Buffer Stripe expects — supertest can alter
 * the raw body and break HMAC verification.
 */
describe.skipIf(!dbReady)('Stripe webhook (handler) — P7-02 (signature + Prisma)', () => {
  it('constructEvent + handler: unhandled customer.created', async () => {
    process.env.STRIPE_SECRET_KEY = TEST_STRIPE_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = TEST_STRIPE_SECRET;

    const stripe = new Stripe(TEST_STRIPE_KEY, { apiVersion: STRIPE_API_VERSION });
    const payload = JSON.stringify({
      id: 'evt_p7_02_ci_mock_1',
      object: 'event',
      type: 'customer.created',
      api_version: '2020-08-27',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'cus_x', object: 'customer' } },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
    });
    const header = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: TEST_STRIPE_SECRET,
    });
    const body = Buffer.from(payload, 'utf8');
    const result = await handleWebhook(body, header, prisma);
    expect(result).toMatchObject({ handled: false, reason: 'unhandled event type' });
  });
});
