/**
 * P0.4 acceptance criteria: "DLQ has admin-only REST endpoint: GET
 * /api/admin/dlq, POST /api/admin/dlq/:id/retry" and "verify DLQ retry
 * endpoint successfully reprocesses job." Uses the real platform-dev login
 * flow (see tests/platformDevAccess.test.ts) rather than hand-building a
 * JWT, so this also proves the route is actually wired into the real app
 * with the real auth middleware, not just unit-tested in isolation.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import { insertDeadLetter } from '../src/server/jobs/deadLetterQueue.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';

const DEV_PW = process.env.PLATFORM_DEV_PASSWORD || 'collectrx-dev-platform-only';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn('[dlqAdminRoutes] DATABASE_URL unreachable — DB-dependent tests will be skipped:', (e as Error).message);
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

function extractCookie(res: request.Response): string {
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
  const match = raw.match(/crx_access=[^;]+/);
  return match?.[0] ?? '';
}

async function platformDevCookie(): Promise<string> {
  const prev = process.env.PLATFORM_DEV_PASSWORD;
  process.env.PLATFORM_DEV_PASSWORD = DEV_PW;
  const login = await request(app).post('/api/auth/login/platform-dev').send({ password: DEV_PW });
  process.env.PLATFORM_DEV_PASSWORD = prev;
  return extractCookie(login);
}

describe.skipIf(!dbReady)('DLQ admin routes', () => {
  afterEach(async () => {
    await prisma.workerDeadLetter.deleteMany({ where: { queueName: 'test-dlq-route-queue' } });
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/admin/dlq');
    expect(res.status).toBe(401);
  });

  it('rejects a non-platform-admin practice owner', async () => {
    const { practice, email, password } = await createPracticeWithOwnerForTests(prisma);
    try {
      const login = await request(app).post('/api/auth/login').send({ email, password });
      const cookie = extractCookie(login);

      const res = await request(app).get('/api/admin/dlq').set('Cookie', cookie);
      expect(res.status).toBe(403);
    } finally {
      await cleanupPracticeWithUsers(prisma, practice.id);
    }
  });

  it('lists dead letters for a platform admin, newest first', async () => {
    const cookie = await platformDevCookie();
    expect(cookie).toMatch(/crx_access=/);

    const first = await insertDeadLetter(prisma, {
      queueName: 'test-dlq-route-queue',
      jobName: 'RULES_TICK',
      bullJobId: 'job-a',
      payload: {},
      stacktrace: undefined,
      finalErrorMessage: 'boom',
      attemptsMade: 3,
    });
    await new Promise((r) => setTimeout(r, 5));
    const second = await insertDeadLetter(prisma, {
      queueName: 'test-dlq-route-queue',
      jobName: 'TRIAGE_CREDENTIAL_HEALTH',
      bullJobId: 'job-b',
      payload: {},
      stacktrace: undefined,
      finalErrorMessage: 'boom',
      attemptsMade: 3,
    });

    const res = await request(app).get('/api/admin/dlq').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const ids = (res.body.deadLetters as Array<{ id: string }>).map((d) => d.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
  });

  it('returns 404 retrying a nonexistent dead letter, and 409 retrying twice', async () => {
    const cookie = await platformDevCookie();
    const { id } = await insertDeadLetter(prisma, {
      queueName: 'test-dlq-route-queue',
      jobName: 'RULES_TICK',
      bullJobId: 'job-c',
      payload: {},
      stacktrace: undefined,
      finalErrorMessage: 'boom',
      attemptsMade: 3,
    });

    const notFound = await request(app).post('/api/admin/dlq/does-not-exist/retry').set('Cookie', cookie);
    expect(notFound.status).toBe(404);

    // First retry attempts a real Bull enqueue — skip cleanly if Redis isn't
    // reachable in this environment rather than failing on an unrelated dep.
    const firstRetry = await request(app).post(`/api/admin/dlq/${id}/retry`).set('Cookie', cookie);
    if (firstRetry.status === 500 && !process.env.REDIS_URL) {
      console.warn('[dlqAdminRoutes] REDIS_URL unreachable — skipping retry-success assertions');
      return;
    }
    expect(firstRetry.status).toBe(200);
    expect(firstRetry.body.success).toBe(true);

    const secondRetry = await request(app).post(`/api/admin/dlq/${id}/retry`).set('Cookie', cookie);
    expect(secondRetry.status).toBe(409);
  });
});
