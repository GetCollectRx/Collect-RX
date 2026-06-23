/**
 * Subsystem smoke map — when Vitest fails here, the describe name tells you which area broke.
 * Full report: npm run diagnose
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../../src/server/index.js';
import { buildPublicHealthMetricsBody } from '../../src/server/healthMetricsExposure.js';
import { validateGapEstimate } from '../../src/server/canadianExpansion/validators.js';
import { apiErrorMessageForResponse } from '../../src/server/apiErrorMessage.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch {
  dbReady = false;
}

describe('breakage map: platform — modules load', () => {
  it('health metrics builder returns deployment flags without secrets', () => {
    const body = buildPublicHealthMetricsBody({
      headers: {},
      get: () => undefined,
    } as Parameters<typeof buildPublicHealthMetricsBody>[0]);
    expect(body.success).toBe(true);
    expect(body.metrics.deployment).toBeDefined();
    expect(JSON.stringify(body)).not.toMatch(/DATABASE_URL|JWT_SECRET|sk_live_/);
  });

  it('API error responses hide internal details in production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(apiErrorMessageForResponse(new Error('secret internal stack'))).toBe('Internal server error');
    process.env.NODE_ENV = prev;
  });
});

describe('breakage map: canadian-expansion — validators', () => {
  it('validates gap estimate input shape', () => {
    const out = validateGapEstimate({
      province: 'ON',
      procedures: [{ cdt_code: 'D0120', office_fee_cad: 100 }],
    });
    expect(out.province).toBe('ON');
    expect(out.procedures).toHaveLength(1);
  });
});

describe('breakage map: api — HTTP surface (no DB required)', () => {
  it('GET /api/health returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/health/metrics returns success', async () => {
    const res = await request(app).get('/api/health/metrics');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('protected routes return 401 without session', async () => {
    const res = await request(app).get('/api/insurance/claims');
    expect(res.status).toBe(401);
  });
});

describe('breakage map: database — connectivity', () => {
  it.skipIf(!dbReady)('Prisma can run SELECT 1', async () => {
    const rows = await prisma.$queryRaw<{ one: number }[]>`SELECT 1 AS one`;
    expect(rows[0]?.one).toBe(1);
  });

  it.skipIf(!dbReady)('GET /api/health/ready returns ready when DB is up', async () => {
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('skips DB checks with a clear reason when DATABASE_URL is unreachable', () => {
    if (dbReady) return;
    expect(dbReady, 'Set DATABASE_URL and run db:migrate — DB checks were skipped').toBe(false);
  });
});
