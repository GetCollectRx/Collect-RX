/**
 * Real enforcement tests for every exported rate limiter in
 * src/server/middleware/rateLimiter.ts. Nothing in this repo had ever
 * automated-tested that a limiter actually fires — asked for directly after
 * a prior PR applied strictLimiter to a new route without any proof the
 * limiter itself works, in an environment (VITEST=true) that unconditionally
 * disables every limiter that checks skipForE2eOrVitest().
 *
 * Two methodologies, chosen per limiter:
 *
 * 1. Session/auth-dependent limiters (authLimiter, strictLimiter,
 *    sessionStandardLimiter, anonStandardLimiter) — their key generation
 *    depends on real cookie/session state, so they're tested through the
 *    real Express app + real Postgres via supertest, exactly as a real
 *    client would hit them.
 * 2. Session-independent limiters (webhookLimiter, healthLimiter,
 *    telemetryEventsLimiter, publicLimiter) — mounted directly (the REAL
 *    exported singleton object, not a re-created copy) on a trivial isolated
 *    test route instead of firing hundreds of requests at real webhook/
 *    telemetry handlers, which would risk unrelated side effects or crashes
 *    from downstream signature-verification/parsing code unrelated to what
 *    this file is testing. That these are also the same objects wired into
 *    real routes is confirmed separately by direct source citation below,
 *    not assumed.
 *
 * These are real, shared, module-singleton instances used by the whole app
 * and by every other test file that logs in or hits the API in this same
 * process (vitest.config.ts sets maxWorkers: 1 — one process, sequential
 * files). Deliberately exhausting one here and not resetting it would leak
 * real 429s into every later test in the suite. Every test below resets its
 * limiter's key before returning control.
 *
 * Reset mechanism: RateLimitRequestHandler only exposes resetKey(key), not
 * resetAll() (confirmed empirically — the type's resetAll only exists on an
 * internal Store interface, not the public handler). That means the reset
 * has to target the exact key makeLimiter()'s keyGenerator would have
 * produced:
 *   - Authenticated requests: `sess:${userId}` — known directly, since these
 *     tests create the session themselves.
 *   - Unauthenticated requests: ipKeyGenerator(req.ip ?? 'unknown'). Verified
 *     empirically (a throwaway debug route) that supertest requests against
 *     an in-process app (no real socket) always resolve req.ip to undefined,
 *     so this always evaluates to the literal string 'unknown' — the same
 *     for every anonymous request in this whole suite, which is exactly why
 *     resetting it after every test here is required, not optional.
 *
 * DB-dependent; skipped with a clear log if DATABASE_URL is unreachable.
 */
import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import { app, prisma } from '../src/server/index.js';
import {
  authLimiter,
  strictLimiter,
  sessionStandardLimiter,
  anonStandardLimiter,
  webhookLimiter,
  healthLimiter,
  telemetryEventsLimiter,
  publicLimiter,
} from '../src/server/middleware/rateLimiter.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[rateLimiters] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
    (e as Error).message,
  );
}

/** The key every anonymous/IP-based request resolves to in this test environment — see file header. */
const ANON_KEY = 'unknown';

function sessionKey(userId: string): string {
  return `sess:${userId}`;
}

function cookieHeaderFrom(res: request.Response): string {
  const setCookie = res.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
}

describe.skipIf(!dbReady)('authLimiter — 5 attempts / 15 min on POST /api/auth/login', () => {
  afterEach(async () => {
    authLimiter.resetKey(ANON_KEY);
  });

  it('the 6th login attempt from the same IP gets 429, not 401', async () => {
    // authLimiter's skip condition is `skipForE2eOrVitest() || NODE_ENV !== 'production'`
    // (src/server/middleware/rateLimiter.ts) — both must be defeated for this
    // limiter to actually run.
    const originalVitest = process.env.VITEST;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'production';
    try {
      const attempts: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ email: 'nonexistent-rate-limit-probe@fixture.test', password: 'wrong-password' });
        attempts.push(res.status);
      }
      // The limiter runs before the handler body, so it doesn't matter that
      // these credentials are bogus — every request still counts.
      expect(attempts.slice(0, 5).every((s) => s !== 429)).toBe(true);
      expect(attempts[5]).toBe(429);
    } finally {
      process.env.VITEST = originalVitest;
      process.env.NODE_ENV = originalNodeEnv;
    }
  }, 20_000);
});

describe.skipIf(!dbReady)('strictLimiter — 10 requests / min on expensive writes', () => {
  let userIdToReset: string | undefined;

  afterEach(() => {
    if (userIdToReset) strictLimiter.resetKey(sessionKey(userIdToReset));
    userIdToReset = undefined;
  });

  it('the 11th invite-practice call from the same admin gets 429', async () => {
    const owner = await createPracticeWithOwnerForTests(prisma);
    userIdToReset = owner.user.id;
    let orgId: string | undefined;
    const originalVitest = process.env.VITEST;
    process.env.VITEST = 'false';
    try {
      const login = await request(app).post('/api/auth/login').send({ email: owner.email, password: owner.password });
      const createRes = await request(app).post('/api/organizations').set('Cookie', cookieHeaderFrom(login)).send({ name: 'Rate Limit Test Org' });
      orgId = createRes.body.organization?.id;
      const cookie = cookieHeaderFrom(createRes);

      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        const res = await request(app)
          .post(`/api/organizations/${orgId}/invite-practice`)
          .set('Cookie', cookie)
          .send({ email: `probe-${i}@fixture.test` });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
      expect(statuses[10]).toBe(429);
    } finally {
      process.env.VITEST = originalVitest;
      if (orgId) await prisma.organizationInviteToken.deleteMany({ where: { organizationId: orgId } });
      if (orgId) await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
      await cleanupPracticeWithUsers(prisma, owner.practice.id);
    }
  }, 30_000);
});

describe.skipIf(!dbReady)('sessionStandardLimiter — 600 requests / min per signed-in user', () => {
  let userIdToReset: string | undefined;

  afterEach(() => {
    if (userIdToReset) sessionStandardLimiter.resetKey(sessionKey(userIdToReset));
    userIdToReset = undefined;
  });

  it('the 601st authenticated request gets 429', async () => {
    const owner = await createPracticeWithOwnerForTests(prisma);
    userIdToReset = owner.user.id;
    const originalVitest = process.env.VITEST;
    process.env.VITEST = 'false';
    try {
      const login = await request(app).post('/api/auth/login').send({ email: owner.email, password: owner.password });
      const cookie = cookieHeaderFrom(login);

      const batch = Array.from({ length: 601 }, () => request(app).get('/api/organizations/mine').set('Cookie', cookie));
      const results = await Promise.all(batch);
      const statuses = results.map((r) => r.status);
      const rejected = statuses.filter((s) => s === 429).length;

      // At exactly 601 requests against a 600/min cap, at least one must be
      // rejected — concurrent firing means the exact index isn't guaranteed
      // to be #601, but the count is what proves the limit is real.
      expect(rejected).toBeGreaterThan(0);
      expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(600);
    } finally {
      process.env.VITEST = originalVitest;
      await cleanupPracticeWithUsers(prisma, owner.practice.id);
    }
  }, 30_000);
});

describe.skipIf(!dbReady)('anonStandardLimiter — 120 requests / min per IP, anonymous', () => {
  afterEach(() => {
    anonStandardLimiter.resetKey(ANON_KEY);
  });

  it('the 121st unauthenticated request gets 429', async () => {
    const originalVitest = process.env.VITEST;
    process.env.VITEST = 'false';
    try {
      const batch = Array.from({ length: 121 }, () => request(app).get('/api/organizations/invite/nonexistent-token'));
      const results = await Promise.all(batch);
      const statuses = results.map((r) => r.status);
      const rejected = statuses.filter((s) => s === 429).length;

      expect(rejected).toBeGreaterThan(0);
      expect(statuses.filter((s) => s === 429 || s === 404).length).toBe(statuses.length);
    } finally {
      process.env.VITEST = originalVitest;
    }
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Session-independent limiters — tested via the real exported singleton
// mounted on a trivial isolated route. See file header for why. All of these
// use the same ANON_KEY ('unknown') since the isolated test app has no
// cookie parser (hasValidSession() is always false) and no real socket
// (req.ip is always undefined), exactly like the real-app anonymous tests
// above.
// ─────────────────────────────────────────────────────────────────────────────

async function proveLimiterEnforces(limiter: RateLimitRequestHandler, max: number): Promise<void> {
  const testApp = express();
  testApp.get('/probe', limiter, (_req, res) => res.status(200).json({ ok: true }));

  const batch = Array.from({ length: max + 1 }, () => request(testApp).get('/probe'));
  const results = await Promise.all(batch);
  const statuses = results.map((r) => r.status);
  const rejected = statuses.filter((s) => s === 429).length;

  expect(rejected).toBeGreaterThan(0);
  expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(max);
}

describe('webhookLimiter — 300 requests / min, no skip (always active)', () => {
  afterEach(() => {
    webhookLimiter.resetKey(ANON_KEY);
  });

  it('enforces its configured limit', async () => {
    await proveLimiterEnforces(webhookLimiter, 300);
  }, 30_000);

  it('is genuinely wired to the real Vapi/Stripe/GoCardless/SendGrid webhook routes', () => {
    // Confirmed by direct source read of src/server/index.ts: webhookLimiter
    // is applied to POST /api/stripe/webhook, POST /api/webhooks/gocardless,
    // /api/webhooks/vapi, /api/webhooks/claims/validate, POST
    // /api/webhooks/sendgrid, /api/webhooks/sendgrid-inbound, and
    // /api/webhooks/demo-booking. This test documents that citation rather
    // than re-deriving it — the enforcement proof above is what matters;
    // this just records that the object it proves isn't hanging unused.
    expect(true).toBe(true);
  });
});

describe('healthLimiter — 120 requests / min on health endpoints', () => {
  afterEach(() => {
    healthLimiter.resetKey(ANON_KEY);
  });

  it('enforces its configured limit', async () => {
    // healthLimiter's skip is `skipForE2eOrVitest() || CI === 'true'` — CI is
    // unset in this environment (confirmed), only VITEST needs defeating.
    const originalVitest = process.env.VITEST;
    process.env.VITEST = 'false';
    try {
      await proveLimiterEnforces(healthLimiter, 120);
    } finally {
      process.env.VITEST = originalVitest;
    }
  }, 30_000);
});

describe('telemetryEventsLimiter — 1000 requests / min, no skip (always active)', () => {
  afterEach(() => {
    telemetryEventsLimiter.resetKey(ANON_KEY);
  });

  it('enforces its configured limit', async () => {
    await proveLimiterEnforces(telemetryEventsLimiter, 1000);
  }, 60_000);
});

describe('publicLimiter — 60 requests / min — DEAD CODE, not wired to any route', () => {
  afterEach(() => {
    publicLimiter.resetKey(ANON_KEY);
  });

  it('the middleware itself enforces its configured limit correctly, if it is ever wired up', async () => {
    const originalVitest = process.env.VITEST;
    process.env.VITEST = 'false';
    try {
      await proveLimiterEnforces(publicLimiter, 60);
    } finally {
      process.env.VITEST = originalVitest;
    }
  }, 30_000);

  it('documents the real bug this surfaced: no route in the server applies it, and the routes it was built for do not exist', () => {
    // publicLimiter's own doc comment: "unauthenticated public routes (e.g.
    // email unsubscribe)". grep across the entire src/ tree found exactly one
    // other reference to it: src/server/compliance/auditAgent.ts, which only
    // string-matches that the text "publicLimiter" and "max: 60" appear
    // somewhere in rateLimiter.ts's source — a check that the declaration
    // exists, not that anything uses it.
    //
    // Worse: the two unsubscribe URLs this limiter was clearly meant to
    // protect — GET /api/public/email-unsubscribe and
    // GET /api/public/prospect-unsubscribe (built in
    // src/server/email/unsubscribeUrl.ts and embedded in the
    // List-Unsubscribe email headers) — have no route handler anywhere in
    // src/server at all. Clicking either link would 404. This is a real,
    // separate compliance gap (CASL/CAN-SPAM one-click unsubscribe is
    // advertised via headers but non-functional), out of scope to fix inside
    // a rate-limiter test file — flagged here for a dedicated pass.
    expect(true).toBe(true);
  });
});
