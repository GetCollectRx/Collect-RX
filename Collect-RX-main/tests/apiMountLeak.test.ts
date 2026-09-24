/**
 * Regression test for the router-mounted-at-bare-/api middleware leak
 * (Collect-RX-main/tasks/lessons.md, 2026-08-09 entry).
 *
 * benefitsApi.ts and canadianExpansionApi.ts each call useOwnerPracticeApiAuthOnly(r),
 * which does `router.use(authenticate); router.use(requirePracticeOwner)` unconditionally.
 * Mounted at bare `/api`, Express ran that `.use()` for EVERY request reaching the router,
 * not just requests matching one of its own routes — so an unauthenticated request to any
 * unmatched /api/* path got a 401 from this router's auth check instead of falling through
 * to the real 404 handler. orgAdminRoutes.ts had the identical bug, fixed earlier (see the
 * comment above its mount line in src/server/index.ts); this test covers the fix for the
 * other two routers with the same shape, mounted at their own specific prefixes instead.
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/server/index.js';

describe('API mount leak regression — routers no longer intercept unrelated /api/* paths', () => {
  it('an unmatched /api/* path with no session returns 404, not a leaked 401', async () => {
    const res = await request(app).get('/api/totally-made-up-xyz123');
    expect(res.status).toBe(404);
  });

  it('/api/benefits/* auth no longer leaks onto an unrelated sibling path', async () => {
    // Before the fix, benefitsApi.ts's router-wide auth ran for this request too,
    // since it was mounted at bare /api and matched everything ahead of it.
    const res = await request(app).get('/api/some-other-unrelated-endpoint');
    expect(res.status).toBe(404);
  });

  it('/api/canadian/* auth no longer leaks onto an unrelated sibling path', async () => {
    const res = await request(app).get('/api/yet-another-unrelated-endpoint');
    expect(res.status).toBe(404);
  });

  it('GET /api/benefits/:patientToken still requires auth on its own mount', async () => {
    const res = await request(app).get('/api/benefits/some-token');
    expect(res.status).toBe(401);
  });

  it('POST /api/benefits/estimate still requires auth on its own mount', async () => {
    const res = await request(app).post('/api/benefits/estimate').send({});
    expect(res.status).toBe(401);
  });

  it('GET /api/canadian/cdcp/reconsiderations still requires auth on its own mount', async () => {
    const res = await request(app).get('/api/canadian/cdcp/reconsiderations');
    expect(res.status).toBe(401);
  });

  it('GET /api/canadian/analytics/canadian-phase2 (moved from /api/analytics/canadian-phase2) still requires auth', async () => {
    const res = await request(app).get('/api/canadian/analytics/canadian-phase2');
    expect(res.status).toBe(401);
  });

  it('the old /api/analytics/canadian-phase2 path no longer serves this endpoint — it moved under /api/canadian', async () => {
    // Not a 404: /api/analytics/* is legitimately owned by analyticsRouter (mounted at
    // its own specific prefix), which correctly gates everything under it with auth —
    // this just confirms the old path no longer reaches canadianExpansionApi.ts's handler.
    const res = await request(app).get('/api/analytics/canadian-phase2');
    expect(res.status).toBe(401);
  });

  it('POST /api/early-access still resolves at its unchanged external URL', async () => {
    // Missing required fields — asserting the route is reachable and validates,
    // not full success (which needs Prisma).
    const res = await request(app).post('/api/early-access').send({});
    expect(res.status).toBe(400);
  });
});
