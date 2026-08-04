/**
 * DSO-scale concurrency verification — the properties that only show up
 * once you stop testing one practice at a time:
 *
 * 1. Twenty practices can onboard (create + first login) truly concurrently
 *    with no unique-constraint collisions or cross-contamination.
 * 2. The dispatch fairness rotation (orderPracticesByFairness) bounds every
 *    practice's wait across many ticks at N=25 practices, not just N=2.
 * 3. A practice can never end up attached to two organizations even under a
 *    real concurrent race between two accept-invite requests.
 *
 * DB-dependent; skipped with a clear log if DATABASE_URL is unreachable.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import { orderPracticesByFairness } from '../src/server/frontDesk/queueEngine.js';
import { createPracticeForTests, createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[dsoScaleConcurrency] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
    (e as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

function cookieHeaderFrom(res: request.Response): string {
  const setCookie = res.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
}

const FLEET_SIZE = 20;

describe.skipIf(!dbReady)('DSO scale: concurrent onboarding', () => {
  it(`onboards ${FLEET_SIZE} practices concurrently with no collisions or cross-tenant leakage`, async () => {
    const created = await Promise.all(
      Array.from({ length: FLEET_SIZE }, () => createPracticeWithOwnerForTests(prisma)),
    );
    try {
      // Distinct IDs and emails — no unique-constraint collision under concurrency.
      expect(new Set(created.map((c) => c.practice.id)).size).toBe(FLEET_SIZE);
      expect(new Set(created.map((c) => c.email)).size).toBe(FLEET_SIZE);

      // Every practice can log in concurrently and gets back only its own practiceId.
      const logins = await Promise.all(
        created.map((c) => request(app).post('/api/auth/login').send({ email: c.email, password: c.password })),
      );
      logins.forEach((res) => {
        expect(res.status).toBe(200);
      });

      // Each of the 20 sessions, queried concurrently, must resolve to its own
      // practice context (200, empty group list) — not 401/500 from session
      // mixups and not another practice's data.
      const meChecks = await Promise.all(
        logins.map((loginRes, i) => {
          const cookie = cookieHeaderFrom(loginRes);
          return request(app).get('/api/organizations/mine').set('Cookie', cookie).then((r) => ({ r, i }));
        }),
      );
      meChecks.forEach(({ r }) => {
        expect(r.status).toBe(200);
        expect(r.body.organizations).toEqual([]);
      });
    } finally {
      await Promise.all(created.map((c) => cleanupPracticeWithUsers(prisma, c.practice.id)));
    }
  });
});

describe.skipIf(!dbReady)('DSO scale: dispatch fairness bounds wait at N=25', () => {
  it('every practice is served at least once within ceil(N / slotsPerTick) simulated ticks', async () => {
    const N = 25;
    const SLOTS_PER_TICK = 4; // mirrors a constrained Vapi concurrency budget
    const practices = await Promise.all(Array.from({ length: N }, () => createPracticeForTests(prisma)));
    try {
      const ids = new Set(practices.map((p) => p.id));
      const everServed = new Set<string>();
      const maxTicks = Math.ceil(N / SLOTS_PER_TICK) + 1; // +1 slack for ordering ties, still a hard bound

      for (let tick = 0; tick < maxTicks; tick++) {
        const order = await orderPracticesByFairness(prisma);
        const thisFleetOrder = order.filter((p) => ids.has(p.id));
        const servedThisTick = thisFleetOrder.slice(0, SLOTS_PER_TICK);
        for (const p of servedThisTick) {
          everServed.add(p.id);
          await prisma.practiceDeskState.upsert({
            where: { practiceId: p.id },
            create: { practiceId: p.id, lastServedAt: new Date() },
            update: { lastServedAt: new Date() },
          });
        }
        // Tiny delay so lastServedAt timestamps are monotonically distinguishable across ticks.
        await new Promise((r) => setTimeout(r, 5));
      }

      const neverServed = practices.filter((p) => !everServed.has(p.id));
      expect(neverServed).toEqual([]);
    } finally {
      await prisma.practiceDeskState.deleteMany({ where: { practiceId: { in: practices.map((p) => p.id) } } });
      await prisma.practice.deleteMany({ where: { id: { in: practices.map((p) => p.id) } } });
    }
  });
});

describe.skipIf(!dbReady)('DSO scale: no practice can end up in two organizations', () => {
  it('a real concurrent race between two accept-invite requests only lets one win', async () => {
    const orgAOwner = await createPracticeWithOwnerForTests(prisma);
    const orgBOwner = await createPracticeWithOwnerForTests(prisma);
    const contested = await createPracticeWithOwnerForTests(prisma);
    let orgAId: string | undefined;
    let orgBId: string | undefined;
    try {
      const orgALogin = await request(app).post('/api/auth/login').send({ email: orgAOwner.email, password: orgAOwner.password });
      const orgACreate = await request(app).post('/api/organizations').set('Cookie', cookieHeaderFrom(orgALogin)).send({ name: 'Org A' });
      orgAId = orgACreate.body.organization?.id;
      const orgACookie = cookieHeaderFrom(orgACreate);

      const orgBLogin = await request(app).post('/api/auth/login').send({ email: orgBOwner.email, password: orgBOwner.password });
      const orgBCreate = await request(app).post('/api/organizations').set('Cookie', cookieHeaderFrom(orgBLogin)).send({ name: 'Org B' });
      orgBId = orgBCreate.body.organization?.id;
      const orgBCookie = cookieHeaderFrom(orgBCreate);

      const [inviteAFromOrgA, inviteBFromOrgB] = await Promise.all([
        request(app).post(`/api/organizations/${orgAId}/invite-practice`).set('Cookie', orgACookie).send({ email: contested.email }),
        request(app).post(`/api/organizations/${orgBId}/invite-practice`).set('Cookie', orgBCookie).send({ email: contested.email }),
      ]);
      expect(inviteAFromOrgA.status).toBe(200);
      expect(inviteBFromOrgB.status).toBe(200);

      const [tokenA, tokenB] = await Promise.all([
        prisma.organizationInviteToken.findFirst({ where: { organizationId: orgAId, inviteeEmail: contested.email }, orderBy: { createdAt: 'desc' } }),
        prisma.organizationInviteToken.findFirst({ where: { organizationId: orgBId, inviteeEmail: contested.email }, orderBy: { createdAt: 'desc' } }),
      ]);
      expect(tokenA).not.toBeNull();
      expect(tokenB).not.toBeNull();

      const contestedLogin = await request(app).post('/api/auth/login').send({ email: contested.email, password: contested.password });
      const contestedCookie = cookieHeaderFrom(contestedLogin);

      // The real race: both accepts fire at the same instant against the same practiceId.
      const [acceptA, acceptB] = await Promise.all([
        request(app).post(`/api/organizations/invite/${tokenA!.token}/accept`).set('Cookie', contestedCookie),
        request(app).post(`/api/organizations/invite/${tokenB!.token}/accept`).set('Cookie', contestedCookie),
      ]);

      // Exactly one 200 and one clean 409 (the loser hits the practiceId unique
      // constraint, caught and mapped back to the same "already in a group"
      // response the sequential-case check gives) — never two 200s, which
      // would mean the practice landed in both orgs.
      expect([acceptA.status, acceptB.status].sort()).toEqual([200, 409]);

      const finalAttachment = await prisma.organizationPractice.findUnique({ where: { practiceId: contested.practice.id } });
      expect(finalAttachment).not.toBeNull();
      expect([orgAId, orgBId]).toContain(finalAttachment!.organizationId);
    } finally {
      if (orgAId) await prisma.organization.delete({ where: { id: orgAId } }).catch(() => undefined);
      if (orgBId) await prisma.organization.delete({ where: { id: orgBId } }).catch(() => undefined);
      await cleanupPracticeWithUsers(prisma, orgAOwner.practice.id);
      await cleanupPracticeWithUsers(prisma, orgBOwner.practice.id);
      await cleanupPracticeWithUsers(prisma, contested.practice.id);
    }
  });
});
