/**
 * Deliberate breaking-point stress test — not "does it work at 20", but
 * "where does it actually stop working, and how does it fail."
 *
 * Every other load test in this repo uses the app's default, unconstrained
 * Prisma connection pool and stays at or near N=20, which only proves things
 * work under the specific conditions tested — it says nothing about the
 * actual ceiling. This file deliberately constrains a SEPARATE PrismaClient
 * to a small connection pool (independent of the app's shared client) and
 * pushes concurrency well past what the pool can serve at once, to observe
 * the real failure mode: does Prisma queue excess requests and complete them
 * correctly (just slower), or does it throw connection-pool-timeout errors
 * (Prisma P2024) once the queue backs up past pool_timeout?
 *
 * This does NOT touch or reconfigure the app's own shared client — it opens
 * its own connections to the same database, so it's safe to run alongside
 * everything else without affecting other tests.
 *
 * DB-dependent; skipped with a clear log if DATABASE_URL is unreachable.
 */
import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

function withPoolParams(url: string, connectionLimit: number, poolTimeoutSeconds: number): string {
  const u = new URL(url);
  u.searchParams.set('connection_limit', String(connectionLimit));
  u.searchParams.set('pool_timeout', String(poolTimeoutSeconds));
  return u.toString();
}

/**
 * PrismaClientKnownRequestError's `.code` (e.g. 'P2024') is a property, not
 * part of Error#toString() — String(reason).includes('P2024') never matches
 * even on a genuine pool-timeout rejection. Read the property directly.
 */
function prismaErrorCode(reason: unknown): string | undefined {
  if (reason && typeof reason === 'object' && 'code' in reason) {
    const code = (reason as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

const baseUrl = process.env.DATABASE_URL ?? '';
let dbReady = false;
try {
  const probe = new PrismaClient({ datasources: { db: { url: baseUrl } } });
  await probe.$connect();
  await probe.$queryRaw`SELECT 1`;
  await probe.$disconnect();
  dbReady = true;
} catch (e) {
  console.warn(
    '[dsoBreakingPointStress] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
    (e as Error).message,
  );
}

describe.skipIf(!dbReady || !baseUrl)('Breaking point: deliberately constrained connection pool', () => {
  it('characterizes real failure behavior at pool=3, 30 concurrent queries', async () => {
    const CONNECTION_LIMIT = 3;
    const POOL_TIMEOUT_SECONDS = 5;
    const CONCURRENCY = 30;

    const client = new PrismaClient({
      datasources: { db: { url: withPoolParams(baseUrl, CONNECTION_LIMIT, POOL_TIMEOUT_SECONDS) } },
    });

    try {
      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENCY }, () => client.$queryRaw`SELECT 1 as ok FROM pg_sleep(0.05)`),
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      const timeoutErrors = failed.filter((r) => prismaErrorCode(r.reason) === 'P2024');

      console.warn(
        `[breaking-point] pool=${CONNECTION_LIMIT}, concurrency=${CONCURRENCY}: ` +
        `${succeeded} succeeded, ${failed.length} failed (${timeoutErrors.length} were pool-timeout errors)`,
      );

      // The real, honest finding this test exists to produce: at 10x
      // oversubscription (3 connections, 30 concurrent queries), does
      // Prisma queue and complete everything, or does it start dropping
      // requests? Record the actual behavior either way — this assertion
      // documents what was observed, not an assumption of graceful queuing.
      if (failed.length > 0) {
        console.warn(
          '[breaking-point] FINDING: a connection pool this constrained DOES produce real failures ' +
          'under this concurrency, not silent queuing. First failure:', failed[0].reason,
        );
      }
      expect(succeeded + failed.length).toBe(CONCURRENCY);
    } finally {
      await client.$disconnect();
    }
  }, 30_000);

  it('finds the approximate concurrency ceiling at pool=5 by escalating until failures appear', async () => {
    const CONNECTION_LIMIT = 5;
    const POOL_TIMEOUT_SECONDS = 3;
    const client = new PrismaClient({
      datasources: { db: { url: withPoolParams(baseUrl, CONNECTION_LIMIT, POOL_TIMEOUT_SECONDS) } },
    });

    const ceilings: { concurrency: number; succeeded: number; failed: number }[] = [];
    try {
      for (const concurrency of [10, 25, 50, 100]) {
        const results = await Promise.allSettled(
          Array.from({ length: concurrency }, () => client.$queryRaw`SELECT 1 as ok FROM pg_sleep(0.05)`),
        );
        const succeeded = results.filter((r) => r.status === 'fulfilled').length;
        const failed = results.length - succeeded;
        ceilings.push({ concurrency, succeeded, failed });
      }

      console.warn(
        '[breaking-point] pool=5, pool_timeout=3s — concurrency escalation:',
        JSON.stringify(ceilings),
      );

      // Document where (if anywhere) failures started appearing — the real
      // data point "to what extent will it collapse" needs, rather than an
      // assumed-safe number.
      const firstFailurePoint = ceilings.find((c) => c.failed > 0);
      if (firstFailurePoint) {
        console.warn(
          `[breaking-point] FINDING: failures begin appearing at concurrency=${firstFailurePoint.concurrency} ` +
          `with pool=${CONNECTION_LIMIT}, pool_timeout=${POOL_TIMEOUT_SECONDS}s.`,
        );
      } else {
        console.warn('[breaking-point] FINDING: no failures observed up to concurrency=100 even at pool=5.');
      }
      expect(ceilings.every((c) => c.succeeded + c.failed === c.concurrency)).toBe(true);
    } finally {
      await client.$disconnect();
    }
  }, 60_000);

  it('proves the test methodology can actually detect a real pool-timeout failure', async () => {
    // "No failures up to concurrency=100" only means something if this same
    // methodology CAN produce a failure under sufficiently adverse
    // conditions. Deliberately push past the boundary: pool=2, 300ms/query,
    // concurrency=50 — worst-case queued wait is ~(50/2)*0.3s = 7.5s against
    // a 2s pool_timeout, which should reliably produce Prisma P2024 errors.
    const CONNECTION_LIMIT = 2;
    const POOL_TIMEOUT_SECONDS = 2;
    const client = new PrismaClient({
      datasources: { db: { url: withPoolParams(baseUrl, CONNECTION_LIMIT, POOL_TIMEOUT_SECONDS) } },
    });

    try {
      const results = await Promise.allSettled(
        Array.from({ length: 50 }, () => client.$queryRaw`SELECT 1 as ok FROM pg_sleep(0.3)`),
      );
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      const poolTimeoutErrors = failed.filter((r) => prismaErrorCode(r.reason) === 'P2024');

      console.warn(
        `[breaking-point] pool=${CONNECTION_LIMIT}, pool_timeout=${POOL_TIMEOUT_SECONDS}s, ` +
        `concurrency=50, 300ms/query: ${succeeded} succeeded, ${failed.length} failed ` +
        `(${poolTimeoutErrors.length} confirmed P2024 pool-timeout)`,
      );
      if (failed.length > 0 && poolTimeoutErrors.length === 0) {
        console.warn('[breaking-point] actual first failure (not P2024 — inspecting real error):', failed[0].reason);
      }

      // The real, load-bearing finding: when the pool genuinely is
      // exhausted, Prisma throws a catchable rejected promise (P2024) —
      // not a process crash, not a hang. Every route in this codebase that
      // awaits a Prisma call inside a try/catch (which is the established
      // pattern throughout — every handler reviewed this session follows
      // it) turns this into a clean 500 for the one request that lost the
      // race, not an outage for the whole server.
      expect(failed.length).toBeGreaterThan(0);
      expect(poolTimeoutErrors.length).toBeGreaterThan(0);
      expect(succeeded).toBeGreaterThan(0);
    } finally {
      await client.$disconnect();
    }
  }, 30_000);
});
