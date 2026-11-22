import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { authState, loadMedians } = vi.hoisted(() => ({
  authState: { role: 'platform_dev' as string, platformUserSession: false },
  loadMedians: vi.fn(),
}));

vi.mock('../src/lib/prisma', () => ({ prisma: {} }));
vi.mock('../src/server/middleware/authenticate', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { auth: unknown }).auth = {
      role: authState.role,
      platformUserSession: authState.platformUserSession,
      userId: 'user-1',
    };
    next();
  },
}));
vi.mock('../src/server/middleware/requirePracticeSession', () => ({
  practiceIdFromSession: () => null,
  queryPracticeConflictsSession: () => false,
  requirePracticeContext: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock('../src/server/middleware/requirePracticeOwner.js', () => ({
  requirePracticeOwner: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireCanEditPracticeAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock('../src/server/audit/auditLog.js', () => ({ appendAuditLog: vi.fn() }));
vi.mock('../src/server/frontDesk/callSegmentStats.js', () => ({ loadCarrierSegmentMedians: loadMedians }));

import adminRoutes from '../src/server/routes/adminRoutes.js';

function get(query = '') {
  const a = express();
  a.use('/admin', adminRoutes);
  return request(a).get(`/admin/call-segments/medians${query}`);
}

const REPORT = { windowDays: 90, truncated: false, carriers: [] };

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  authState.role = 'platform_dev';
  authState.platformUserSession = false;
  loadMedians.mockResolvedValue(REPORT);
});

describe('GET /admin/call-segments/medians', () => {
  it('returns the report to a platform developer with a 90 day default window', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual(REPORT);
    expect(loadMedians).toHaveBeenCalledWith(expect.anything(), 90);
  });

  it('passes a valid days value through', async () => {
    await get('?days=30');
    expect(loadMedians).toHaveBeenCalledWith(expect.anything(), 30);
  });

  it.each(['practice_owner', 'front_desk', 'platform_admin'])('refuses %s', async (role) => {
    authState.role = role;
    const res = await get();
    expect(res.status).toBe(403);
    expect(loadMedians).not.toHaveBeenCalled();
  });

  it('refuses a platform user session even with the platform_dev role', async () => {
    authState.platformUserSession = true;
    const res = await get();
    expect(res.status).toBe(403);
    expect(loadMedians).not.toHaveBeenCalled();
  });

  it.each(['0', '366', 'abc', '1.5', '-3'])('rejects days=%s with 400', async (days) => {
    const res = await get(`?days=${days}`);
    expect(res.status).toBe(400);
    expect(loadMedians).not.toHaveBeenCalled();
  });

  it('answers 500 without leaking internals in production when the loader fails', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    loadMedians.mockRejectedValue(new Error('connection string postgres://secret'));
    const res = await get();
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('postgres://');
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});
