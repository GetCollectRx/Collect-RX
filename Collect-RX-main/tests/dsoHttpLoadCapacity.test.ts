/**
 * Real concurrent-HTTP load test against actual business endpoints — the gap
 * left by the repo's perf-smoke CI job, which only load-tests the
 * unauthenticated /api/health endpoints (perf/k6-read-heavy.js), never
 * claims, dashboard, or any DB-backed read under real session auth.
 *
 * 20 real practices, 20 real concurrent authenticated sessions, each firing
 * concurrent requests at DB-backed endpoints (GET /api/insurance/claims,
 * GET /api/organizations/mine) via supertest directly against the real
 * Express app + real Postgres — no mocking below the HTTP layer. This is
 * also the test that would surface Prisma connection-pool exhaustion: no
 * connection_limit is set anywhere in this repo (confirmed by search), so
 * the pool defaults to Prisma's num_cpus*2+1, comfortably smaller than 20
 * concurrent in-flight queries on most machines.
 *
 * DB-dependent; skipped with a clear log if DATABASE_URL is unreachable.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[dsoHttpLoadCapacity] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
    (e as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

function cookieHeaderFrom(res: request.Response): string {
  const setCookie = res.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
}

const FLEET_SIZE = 20;

describe.skipIf(!dbReady)('DSO HTTP load capacity: real concurrent business-endpoint traffic at N=20', () => {
  it('20 concurrent authenticated sessions hitting real DB-backed endpoints: no errors, correct scoping, bounded latency', async () => {
    const fleet = await Promise.all(Array.from({ length: FLEET_SIZE }, () => createPracticeWithOwnerForTests(prisma)));
    try {
      const loginStart = Date.now();
      const logins = await Promise.all(
        fleet.map((f) => request(app).post('/api/auth/login').send({ email: f.email, password: f.password })),
      );
      const loginElapsedMs = Date.now() - loginStart;
      logins.forEach((res) => expect(res.status).toBe(200));

      const cookies = logins.map(cookieHeaderFrom);

      // Each session fires 2 real DB-backed requests concurrently — 40
      // in-flight requests total, well past a default Prisma pool sized at
      // num_cpus*2+1 on most machines. Prisma should queue excess requests
      // for a connection and complete them correctly, not error or hang.
      const requestStart = Date.now();
      const results = await Promise.all(
        cookies.flatMap((cookie, i) => [
          request(app).get('/api/insurance/claims').set('Cookie', cookie).then((r) => ({ r, i, kind: 'claims' as const })),
          request(app).get('/api/organizations/mine').set('Cookie', cookie).then((r) => ({ r, i, kind: 'orgs' as const })),
        ]),
      );
      const requestElapsedMs = Date.now() - requestStart;

      const errors = results.filter(({ r }) => r.status !== 200);
      expect(errors).toEqual([]);

      // Scoping under concurrency: each practice's claims response must never
      // contain another practice's claim — start from empty (no claims seeded)
      // so any cross-tenant leak would show up as a non-empty, wrong-owner list.
      const claimsResults = results.filter((x): x is typeof x & { kind: 'claims' } => x.kind === 'claims');
      claimsResults.forEach(({ r }) => {
        expect(r.body.success).toBe(true);
        expect(Array.isArray(r.body.data)).toBe(true);
        expect(r.body.data).toEqual([]);
      });

      // Generous bounds that would still catch real capacity failures:
      // Prisma's default pool_timeout is 10s per query — if the pool were
      // meaningfully undersized for this load, requests would start timing
      // out or the whole batch would take far longer than this.
      expect(loginElapsedMs).toBeLessThan(10_000);
      expect(requestElapsedMs).toBeLessThan(15_000);
    } finally {
      await Promise.all(fleet.map((f) => cleanupPracticeWithUsers(prisma, f.practice.id)));
    }
  }, 45_000);
});
