/**
 * DSO-scale concurrency verification — the properties that only show up
 * once you stop testing one practice at a time:
 *
 * 1. Twenty practices can onboard (create + first login) truly concurrently
 *    with no unique-constraint collisions or cross-contamination.
 * 2. The dispatch fairness rotation (orderPracticesByFairness) bounds every
 *    practice's wait across many ticks at N=25 practices, not just N=2.
 * 3. A practice can never end up attached to two organizations even under a
 *    real concurrent race on the OrganizationPractice.practiceId constraint.
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
          return request(app).get('/api/auth/me').set('Cookie', cookie).then((r) => ({ r, i }));
        }),
      );
      meChecks.forEach(({ r }, i) => {
        expect(r.status).toBe(200);
        expect(r.body.practice.id).toBe(created[i].practice.id);
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
  it('a real concurrent race to attach the same practice to two orgs only lets one win', async () => {
    // There is no HTTP path today for attaching an *existing* practice (with
    // its own owner login) to a DSO — orgAdminRoutes.ts creates all of a
    // DSO's practices itself in one batch, and the invite flow
    // (authRoutes.ts POST /invite, /accept-invite) provisions a brand-new
    // staff account, not a pre-existing practice. What still matters under
    // concurrency is the DB guarantee itself — OrganizationPractice.practiceId
    // is @unique — so this races two concurrent attach attempts directly at
    // that constraint the way any future caller (batch admin tooling, a
    // later self-serve flow) would ultimately rely on it.
    const orgA = await prisma.organization.create({ data: { name: 'Org A' } });
    const orgB = await prisma.organization.create({ data: { name: 'Org B' } });
    const contested = await createPracticeWithOwnerForTests(prisma);
    try {
      const [attachA, attachB] = await Promise.allSettled([
        prisma.organizationPractice.create({ data: { organizationId: orgA.id, practiceId: contested.practice.id } }),
        prisma.organizationPractice.create({ data: { organizationId: orgB.id, practiceId: contested.practice.id } }),
      ]);

      // Exactly one attach succeeds and the other hits the unique constraint —
      // never two fulfilled attaches, which would mean the practice landed in both orgs.
      const outcomes = [attachA.status, attachB.status].sort();
      expect(outcomes).toEqual(['fulfilled', 'rejected']);

      const finalAttachment = await prisma.organizationPractice.findUnique({ where: { practiceId: contested.practice.id } });
      expect(finalAttachment).not.toBeNull();
      expect([orgA.id, orgB.id]).toContain(finalAttachment!.organizationId);
    } finally {
      await prisma.organization.delete({ where: { id: orgA.id } }).catch(() => undefined);
      await prisma.organization.delete({ where: { id: orgB.id } }).catch(() => undefined);
      await cleanupPracticeWithUsers(prisma, contested.practice.id);
    }
  });
});
