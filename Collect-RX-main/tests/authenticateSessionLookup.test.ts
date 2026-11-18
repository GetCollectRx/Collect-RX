import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { getRlsContext } from '../src/server/db/rlsContext.js';

const seen: Array<{ bypass?: boolean; practiceId?: string } | undefined> = [];

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => {
        seen.push(getRlsContext());
        return { practiceId: 'p1', tokenExpiresAt: null, isActive: true };
      }),
    },
  },
}));

vi.mock('../src/server/authToken', () => ({
  COOKIE_NAME: 'crx_session',
  verifyAuthToken: () => ({ userId: 'u1', practiceId: 'p1', role: 'practice_owner' }),
}));

const { authenticate } = await import('../src/server/middleware/authenticate.js');

function mockRes() {
  const res = { statusCode: 200, body: undefined as unknown } as Response & { statusCode: number; body: unknown };
  res.status = ((c: number) => { res.statusCode = c; return res; }) as Response['status'];
  res.json = ((b: unknown) => { res.body = b; return res; }) as Response['json'];
  return res;
}

describe('authenticate session lookup under FORCE ROW LEVEL SECURITY', () => {
  beforeEach(() => { seen.length = 0; });

  it('reads the user row under an explicit RLS bypass, then continues in the practice context', async () => {
    const req = { headers: { authorization: 'Bearer x' }, cookies: {}, method: 'GET', path: '/api/auth/me', originalUrl: '/api/auth/me', query: {}, body: {} } as unknown as Request;
    const res = mockRes();
    const nextCtx: Array<{ bypass?: boolean; practiceId?: string } | undefined> = [];
    await new Promise<void>((resolve) => {
      authenticate(req, res, () => { nextCtx.push(getRlsContext()); resolve(); });
    });
    expect(res.statusCode).toBe(200);
    expect(seen[0]?.bypass).toBe(true);
    expect(nextCtx[0]).toEqual({ practiceId: 'p1' });
  });
});
