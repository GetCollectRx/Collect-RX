import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { app, prisma } from '../src/server/index.js';
import { runWithRlsBypass, runWithPracticeRls } from '../src/server/db/rlsContext.js';
import { CSV_AR_FEATURES, isCsvArFeatureEnabled } from '../src/server/featureFlags/csvArFeatures.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch {
  /* DB-backed tests are skipped when no database is reachable; CI always has one */
}

const PW = 'test-password-1234';
const adminEmails: string[] = [];

function extractCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

async function platformAdminCookie(): Promise<string> {
  const email = `pause-admin-${randomUUID()}@test.local`;
  adminEmails.push(email);
  const passwordHash = await bcrypt.hash(PW, 4);
  await prisma.platformUser.create({ data: { id: randomUUID(), email, passwordHash, userRole: 'platform_admin' } });
  const login = await request(app).post('/api/auth/login').send({ email, password: PW });
  expect(login.status).toBe(200);
  return extractCookie(login);
}

async function clearRows() {
  await runWithRlsBypass(() =>
    prisma.featureFlag.deleteMany({
      where: { OR: [{ feature: { startsWith: 'dispatch_pause.' } }, { feature: { startsWith: 'csv_ar.' } }] },
    }),
  );
}

afterEach(async () => {
  if (dbReady) await clearRows();
});

afterAll(async () => {
  if (dbReady) {
    await clearRows();
    await prisma.platformUser.deleteMany({ where: { email: { in: adminEmails } } }).catch(() => undefined);
  }
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!dbReady)('pause admin routes', () => {
  it('rejects an unauthenticated caller', async () => {
    const res = await request(app).put('/api/admin/pauses/system').send({ paused: true, reason: 'x' });
    expect(res.status).toBe(401);
  });

  it('does not let a practice owner pause anything', async () => {
    const owner = await createPracticeWithOwnerForTests(prisma);
    const login = await request(app).post('/api/auth/login').send({ email: owner.email, password: owner.password });
    const cookie = extractCookie(login);
    const res = await request(app).put('/api/admin/pauses/system').set('Cookie', cookie).send({ paused: true, reason: 'x' });
    expect([403, 404]).toContain(res.status);
    const list = await request(app).get('/api/admin/pauses').set('Cookie', cookie);
    expect([403, 404]).toContain(list.status);
    await cleanupPracticeWithUsers(prisma, owner.practice.id);
  });

  it('requires a reason to pause but not to resume', async () => {
    const cookie = await platformAdminCookie();
    const noReason = await request(app).put('/api/admin/pauses/system').set('Cookie', cookie).send({ paused: true });
    expect(noReason.status).toBe(400);
    const tooLong = await request(app)
      .put('/api/admin/pauses/system')
      .set('Cookie', cookie)
      .send({ paused: true, reason: 'x'.repeat(201) });
    expect(tooLong.status).toBe(400);
    const resume = await request(app).put('/api/admin/pauses/system').set('Cookie', cookie).send({ paused: false });
    expect(resume.status).toBe(200);
  });

  it('pauses and resumes the whole system and reflects it in the list', async () => {
    const cookie = await platformAdminCookie();
    const pause = await request(app).put('/api/admin/pauses/system').set('Cookie', cookie).send({ paused: true, reason: 'pilot check' });
    expect(pause.status).toBe(200);
    const during = await request(app).get('/api/admin/pauses').set('Cookie', cookie);
    expect(during.body.data.pauses).toEqual(expect.arrayContaining([expect.objectContaining({ scope: 'system', reason: 'pilot check' })]));
    expect(during.body.data.carriers).toContain('sun_life');
    await request(app).put('/api/admin/pauses/system').set('Cookie', cookie).send({ paused: false });
    const after = await request(app).get('/api/admin/pauses').set('Cookie', cookie);
    expect(after.body.data.pauses.some((p: { scope: string }) => p.scope === 'system')).toBe(false);
  });

  it('pauses one practice, validating the id and that the practice exists', async () => {
    const cookie = await platformAdminCookie();
    const owner = await createPracticeWithOwnerForTests(prisma);
    const bad = await request(app).put('/api/admin/pauses/practices/not-a-uuid').set('Cookie', cookie).send({ paused: true, reason: 'x' });
    expect(bad.status).toBe(400);
    const missing = await request(app).put(`/api/admin/pauses/practices/${randomUUID()}`).set('Cookie', cookie).send({ paused: true, reason: 'x' });
    expect(missing.status).toBe(404);
    const ok = await request(app).put(`/api/admin/pauses/practices/${owner.practice.id}`).set('Cookie', cookie).send({ paused: true, reason: 'x' });
    expect(ok.status).toBe(200);
    const list = await request(app).get('/api/admin/pauses').set('Cookie', cookie);
    expect(list.body.data.pauses).toEqual(expect.arrayContaining([expect.objectContaining({ scope: 'practice', practiceId: owner.practice.id })]));
    await cleanupPracticeWithUsers(prisma, owner.practice.id);
  });

  it('pauses one carrier and rejects an unknown carrier', async () => {
    const cookie = await platformAdminCookie();
    const unknown = await request(app).put('/api/admin/pauses/carriers/not_a_carrier').set('Cookie', cookie).send({ paused: true, reason: 'x' });
    expect(unknown.status).toBe(400);
    const ok = await request(app).put('/api/admin/pauses/carriers/sun_life').set('Cookie', cookie).send({ paused: true, reason: 'x' });
    expect(ok.status).toBe(200);
    const list = await request(app).get('/api/admin/pauses').set('Cookie', cookie);
    expect(list.body.data.pauses).toEqual(expect.arrayContaining([expect.objectContaining({ scope: 'carrier', carrierId: 'sun_life', practiceId: null })]));
  });
});

describe.skipIf(!dbReady)('feature flag admin routes (G3 fix)', () => {
  it('lists every staged flag as live by default', async () => {
    const cookie = await platformAdminCookie();
    const res = await request(app).get('/api/admin/feature-flags').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(Object.values(CSV_AR_FEATURES).length);
    expect(res.body.data.every((f: { paused: boolean }) => f.paused === false)).toBe(true);
  });

  it('pausing a flag platform-wide turns the feature off for a practice, and resuming turns it back on', async () => {
    const cookie = await platformAdminCookie();
    const owner = await createPracticeWithOwnerForTests(prisma);
    const feature = CSV_AR_FEATURES.DENIAL_HUB;
    const pause = await request(app).patch(`/api/admin/feature-flags/${feature}`).set('Cookie', cookie).send({ paused: true, reason: 'kill switch test' });
    expect(pause.status).toBe(200);
    const during = await runWithPracticeRls(owner.practice.id, () => isCsvArFeatureEnabled(prisma, owner.practice.id, feature));
    expect(during).toBe(false);
    const list = await request(app).get('/api/admin/feature-flags').set('Cookie', cookie);
    expect(list.body.data.find((f: { feature: string }) => f.feature === feature).paused).toBe(true);
    await request(app).patch(`/api/admin/feature-flags/${feature}`).set('Cookie', cookie).send({ paused: false });
    const after = await runWithPracticeRls(owner.practice.id, () => isCsvArFeatureEnabled(prisma, owner.practice.id, feature));
    expect(after).toBe(true);
    await cleanupPracticeWithUsers(prisma, owner.practice.id);
  });

  it('a practice-level pause wins even when the platform-wide row is live', async () => {
    const owner = await createPracticeWithOwnerForTests(prisma);
    const feature = CSV_AR_FEATURES.EOB_RECONCILIATION;
    await runWithRlsBypass(async () => {
      await prisma.featureFlag.create({ data: { practiceId: null, feature, paused: false } });
      await prisma.featureFlag.create({ data: { practiceId: owner.practice.id, feature, paused: true } });
    });
    expect(await isCsvArFeatureEnabled(prisma, owner.practice.id, feature)).toBe(false);
    await cleanupPracticeWithUsers(prisma, owner.practice.id);
  });

  it('rejects an unknown flag and a malformed body', async () => {
    const cookie = await platformAdminCookie();
    const unknown = await request(app).patch('/api/admin/feature-flags/not.a.flag').set('Cookie', cookie).send({ paused: true });
    expect(unknown.status).toBe(404);
    const bad = await request(app).patch(`/api/admin/feature-flags/${CSV_AR_FEATURES.DENIAL_HUB}`).set('Cookie', cookie).send({ paused: 'yes' });
    expect(bad.status).toBe(400);
  });
});
