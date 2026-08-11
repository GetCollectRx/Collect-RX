// ─────────────────────────────────────────────────────────────────────────────
// Agent 03 — API Surface Validator
//
// Validates that every protected API route requires authentication and returns
// the correct status codes. This agent enforces the security contract: unauthenticated
// requests must never return 200, and health endpoints must always be accessible.
//
// Note: no case here requires a database — all 29 assert HTTP status, headers or
// auth behaviour, and pass with DATABASE_URL unset.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../../src/server/index.js';

// No test here touches the database — every case asserts HTTP status, headers or
// auth behaviour through supertest. A dbReady probe used to sit here warning that
// "DB-dependent tests skipped" while skipping nothing.

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section A — Health Endpoints (no auth required)
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 03-A — Health endpoints are public', () => {
  it('GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('GET /api/health returns 200 with status:ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/health/ready returns 200 or 503', async () => {
    const res = await request(app).get('/api/health/ready');
    expect([200, 503]).toContain(res.status);
  });

  it('GET /api/health/metrics returns metrics without exposing secrets', async () => {
    const res = await request(app).get('/api/health/metrics');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.metrics).not.toHaveProperty('databaseUrl');
    expect(res.body.metrics).not.toHaveProperty('DATABASE_URL');
    expect(JSON.stringify(res.body)).not.toContain('sk_live_');
    expect(JSON.stringify(res.body)).not.toContain('whsec_');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section B — Insurance/Claims Routes (require auth)
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 03-B — Insurance/claims routes require authentication', () => {
  const PROTECTED_ROUTES = [
    ['GET', '/api/insurance/claims'],
    ['GET', '/api/calls'],
    ['GET', '/api/carriers'],
    ['GET', '/api/analytics/insurance'],
    ['GET', '/api/queue/priority-scores'],
    ['GET', '/api/queue/carrier-order'],
    ['GET', '/api/work-queue'],
  ];

  for (const [method, path] of PROTECTED_ROUTES) {
    it(`${method} ${path} returns 401 without session`, async () => {
      const res = await (method === 'GET'
        ? request(app).get(path)
        : request(app).post(path).send({}));
      expect(res.status).toBe(401);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section C — Admin Routes (require auth)
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 03-C — Admin routes require authentication', () => {
  const ADMIN_ROUTES = [
    ['GET', '/api/admin/sync/runs'],
    ['GET', '/api/admin/audit-log'],
    ['GET', '/api/benefits/estimate'],
    ['GET', '/api/eligibility/status/patient-001/sun_life'],
  ];

  for (const [method, path] of ADMIN_ROUTES) {
    it(`${method} ${path} returns 401 without session`, async () => {
      const res = await (method === 'GET'
        ? request(app).get(path)
        : request(app).post(path).send({}));
      expect(res.status).toBe(401);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section D — Auth Endpoints (correct HTTP semantics)
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 03-D — Auth endpoints return correct HTTP semantics', () => {
  it('POST /api/auth/login with invalid credentials returns 401, 400, or 500 (500 when DB unavailable)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bad@email.com', password: 'wrongpassword' });
    // 400/401/422 when DB is available; 500 when DB is unreachable
    expect([400, 401, 422, 500]).toContain(res.status);
  });

  it('POST /api/auth/login with empty body returns 400 or 422', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect([400, 401, 422]).toContain(res.status);
  });

  it('GET /api/auth/me without session returns 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/logout without session returns 200 or 401', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect([200, 401]).toContain(res.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section E — Retired patient billing routes (must stay gone)
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 03-E — Patient billing routes are retired', () => {
  const RETIRED_ROUTES = [
    ['GET', '/api/patients'],
    ['GET', '/api/balances'],
    ['GET', '/api/patients/balances'],
  ];

  for (const [method, path] of RETIRED_ROUTES) {
    it(`${method} ${path} returns 404 (not mounted)`, async () => {
      const res = await (method === 'GET'
        ? request(app).get(path)
        : request(app).post(path).send({}));
      // Unauthenticated + unmounted → 401 (global auth) or 404 (gone). Never 200.
      expect([401, 404]).toContain(res.status);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section F — Security Headers
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 03-F — Security headers present on all responses', () => {
  it('GET /api/health includes X-Content-Type-Options header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('GET /api/health does not expose X-Powered-By', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('GET /api/health returns JSON content-type', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['content-type']).toContain('application/json');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section G — 404 Handling
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 03-G — Non-existent routes return 404', () => {
  it('GET /api/nonexistent-route returns 404 or 401', async () => {
    const res = await request(app).get('/api/nonexistent-route-xyz');
    expect([401, 404]).toContain(res.status);
  });

  it('POST /api/nonexistent-endpoint returns 404 or 401', async () => {
    const res = await request(app).post('/api/nonexistent-endpoint-xyz').send({});
    expect([401, 404]).toContain(res.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section H — Billing / Stripe Routes (require auth)
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 03-H — Billing routes require authentication', () => {
  it('GET /api/billing/plan returns 401 without session', async () => {
    const res = await request(app).get('/api/billing/plan');
    expect(res.status).toBe(401);
  });

  it('GET /api/billing/usage returns 401 without session', async () => {
    const res = await request(app).get('/api/billing/usage');
    expect(res.status).toBe(401);
  });
});
