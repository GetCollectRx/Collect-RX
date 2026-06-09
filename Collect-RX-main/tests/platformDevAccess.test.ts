/**
 * Platform developer session — PHI route blocking and insurance redaction.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import {
  createPracticeForTests,
  createPracticeWithOwnerForTests,
  cleanupPracticeWithUsers,
} from './factories/practice.js';

const DEV_PW = process.env.PLATFORM_DEV_PASSWORD || 'collectrx-dev-platform-only';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch {
  /* skip */
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

describe.skipIf(!dbReady)('Platform developer access control', () => {
  it(
    'blocks PHI routes and allows redacted insurance claims',
    async () => {
      const prev = process.env.PLATFORM_DEV_PASSWORD;
      process.env.PLATFORM_DEV_PASSWORD = DEV_PW;

      const practice = await createPracticeForTests(prisma);

      const login = await request(app)
        .post('/api/auth/login/platform-dev')
        .send({ password: DEV_PW });
      expect(login.status).toBe(200);
      expect(login.body.role).toBe('platform_dev');
      expect(login.body.phiAccess).toBe(false);

      const cookie = extractCookie(login);
      expect(cookie).toMatch(/crx_access=/);

      const blocked = await request(app)
        .get(`/api/patients/balances?practiceId=${practice.id}`)
        .set('Cookie', cookie);
      expect(blocked.status).toBe(403);

      const claims = await request(app)
        .get(`/api/insurance/claims?practiceId=${practice.id}&limit=5`)
        .set('Cookie', cookie);
      expect(claims.status).toBe(200);
      if (claims.body.data?.length) {
        const row = claims.body.data[0];
        expect(row.patientToken).toBeNull();
        expect(String(row.claimNumber)).toMatch(/^\*\*\*-/);
      }

      await prisma.practice.delete({ where: { id: practice.id } });
      if (prev === undefined) delete process.env.PLATFORM_DEV_PASSWORD;
      else process.env.PLATFORM_DEV_PASSWORD = prev;
    },
    30_000,
  );

  it('practice owner login has phiAccess', async () => {
    const { practice, email, password } = await createPracticeWithOwnerForTests(prisma);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.role).toBe('practice_owner');
    expect(login.body.phiAccess).toBe(true);
    await cleanupPracticeWithUsers(prisma, practice.id);
  });
});
