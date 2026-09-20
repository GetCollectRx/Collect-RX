/**
 * docs/operations/HUMAN-DECISIONS-PENDING.md #3 (Option B — standing runtime
 * check). Verifies the check correctly reads the connecting role's actual
 * rolsuper/rolbypassrls attributes from Postgres and computes `safe`
 * consistently with them — not that any particular environment's role is
 * safe or unsafe (that's environment-specific and not this test's job).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { app } from '../index.js';
import {
  checkRlsRoleSafety,
  getCachedRlsRoleSafety,
  resetRlsRoleSafetyCacheForTests,
} from './rlsRoleSafety.js';

const prisma = new PrismaClient();

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[rlsRoleSafety] DATABASE_URL unreachable — skipping:',
    (e as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!dbReady)('checkRlsRoleSafety', () => {
  it('reads the real connecting role and computes safe consistently with rolsuper/rolbypassrls', async () => {
    const result = await checkRlsRoleSafety(prisma);
    expect(result.checked).toBe(true);
    expect(result.error).toBeNull();
    expect(typeof result.rolname).toBe('string');
    expect(typeof result.rolsuper).toBe('boolean');
    expect(typeof result.rolbypassrls).toBe('boolean');
    // The one invariant that actually matters: safe is exactly "neither flag set."
    expect(result.safe).toBe(!result.rolsuper && !result.rolbypassrls);
  });

  it('caches the result for getCachedRlsRoleSafety() without re-querying', async () => {
    resetRlsRoleSafetyCacheForTests();
    expect(getCachedRlsRoleSafety().checked).toBe(false);

    const result = await checkRlsRoleSafety(prisma);
    expect(getCachedRlsRoleSafety()).toEqual(result);
  });

  it('defaults to safe:true before any check has run, so unrelated boot paths never see a false alarm', () => {
    resetRlsRoleSafetyCacheForTests();
    const cached = getCachedRlsRoleSafety();
    expect(cached.checked).toBe(false);
    expect(cached.safe).toBe(true);
  });
});

describe('checkRlsRoleSafety — actually wired into index.ts boot + /api/health/ready', () => {
  it('src/server/index.ts calls checkRlsRoleSafety() at boot and getCachedRlsRoleSafety() in the readiness route', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(dir, '..', 'index.ts'), 'utf8');
    expect(source).toMatch(/\bcheckRlsRoleSafety\(prisma\)/);
    expect(source).toMatch(/\bgetCachedRlsRoleSafety\(\)/);
  });

  it.skipIf(!dbReady)(
    'GET /api/health/ready returns 503 in production once the cache holds an unsafe result',
    async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      try {
        await checkRlsRoleSafety(prisma); // populate the cache from the real (unrestricted test) role
        process.env.NODE_ENV = 'production';
        const res = await request(app).get('/api/health/ready');
        if (getCachedRlsRoleSafety().safe) {
          // This environment's connecting role happens to already be
          // NOSUPERUSER/NOBYPASSRLS (e.g. a CI role built for rls.strict) —
          // the endpoint correctly reports ready; nothing to assert against.
          expect(res.status).toBe(200);
        } else {
          expect(res.status).toBe(503);
          expect(res.body.error).toMatch(/RLS safety check/);
        }
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        resetRlsRoleSafetyCacheForTests();
      }
    },
  );
});
