/**
 * /api/health/ready must flip to 503 the instant graceful shutdown begins,
 * regardless of DB state — so Fly stops routing new traffic here before the
 * drain completes, rather than in-flight requests starting against an
 * instance that's already on its way down.
 *
 * registerGracefulShutdown() itself only runs from boot() (gated behind
 * isMainModule(), never true under vitest) and its real path calls
 * process.exit() — not safe to invoke directly in a test process. This
 * exercises the actual route handler's shutdown branch via the
 * __setShuttingDownForTests() seam instead of the real SIGTERM path.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma, __setShuttingDownForTests } from '../src/server/index.js';

afterEach(() => {
  __setShuttingDownForTests(false);
});

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

describe('/api/health/ready — shutdown gating', () => {
  it('returns 503 with reason shutting_down once shutdown has started', async () => {
    __setShuttingDownForTests(true);
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not_ready', reason: 'shutting_down' });
  });

  it('does not attempt a DB query once shutting down (fails fast, not just fails)', async () => {
    // Sanity check that the shutdown branch returns before ever reaching the
    // prisma.$queryRaw call — this test only makes sense as belt-and-suspenders
    // alongside the DB-independent status assertion above, so no DB is needed.
    __setShuttingDownForTests(true);
    const start = Date.now();
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(Date.now() - start).toBeLessThan(200);
  });
});
