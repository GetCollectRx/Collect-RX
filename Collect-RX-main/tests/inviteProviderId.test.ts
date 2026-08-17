/**
 * associate_dentist invites must carry providerId all the way onto the
 * created User row — otherwise authorizeRole's per-provider query scoping
 * (src/server/middleware/authorizeRole.ts) silently applies to nothing and
 * the associate dentist sees every patient's data, not just their own.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers, FIXTURE_PRACTICE_PASSWORD } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch {
  /* skip */
}

function extractCookie(res: request.Response): string {
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
  const match = raw.match(/crx_access=[^;]+/);
  return match?.[0] ?? '';
}

describe.skipIf(!dbReady)('associate_dentist invite → accept-invite providerId propagation', () => {
  let practiceId: string | undefined;
  let inviteeEmail: string | undefined;

  afterAll(async () => {
    if (inviteeEmail) await prisma.user.deleteMany({ where: { email: inviteeEmail } });
    if (practiceId) await cleanupPracticeWithUsers(prisma, practiceId);
    await prisma.$disconnect().catch(() => undefined);
  });

  it('rejects an associate_dentist invite with no providerId', async () => {
    const { practice, email, password } = await createPracticeWithOwnerForTests(prisma);
    practiceId = practice.id;

    const login = await request(app).post('/api/auth/login').send({ email, password });
    const cookie = extractCookie(login);

    const res = await request(app)
      .post('/api/auth/invite')
      .set('Cookie', cookie)
      .send({ email: `assoc-${Date.now()}@fixture.test`, role: 'associate_dentist' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/providerId is required/);
  });

  it('carries providerId from invite through accept-invite onto the User row', async () => {
    const { practice, email, password } = await createPracticeWithOwnerForTests(prisma);
    practiceId = practice.id;
    inviteeEmail = `assoc-${Date.now()}@fixture.test`;

    const login = await request(app).post('/api/auth/login').send({ email, password });
    const cookie = extractCookie(login);

    const invite = await request(app)
      .post('/api/auth/invite')
      .set('Cookie', cookie)
      .send({ email: inviteeEmail, role: 'associate_dentist', providerId: 'DR-TEST-001' });
    expect(invite.status).toBe(200);

    const inviteToken = await prisma.inviteToken.findFirst({ where: { email: inviteeEmail } });
    expect(inviteToken?.providerId).toBe('DR-TEST-001');

    const accept = await request(app)
      .post('/api/auth/accept-invite')
      .send({ token: inviteToken!.token, displayName: 'Dr. Fixture', password: FIXTURE_PRACTICE_PASSWORD });
    expect(accept.status).toBe(201);

    const created = await prisma.user.findUnique({ where: { email: inviteeEmail } });
    expect(created?.providerId).toBe('DR-TEST-001');
  });
});
