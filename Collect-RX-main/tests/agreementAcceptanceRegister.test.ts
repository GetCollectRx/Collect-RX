import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import { CURRENT_AGREEMENTS } from '../src/server/agreements/agreementRegistry.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch {
  /* DB-backed tests are skipped when no database is reachable; CI always has one */
}

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const accepted = CURRENT_AGREEMENTS.map((a) => ({ kind: a.kind, version: a.version }));
const createdUserIds: string[] = [];
const createdPracticeIds: string[] = [];

afterAll(async () => {
  if (dbReady) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => undefined);
    await prisma.practice.deleteMany({ where: { id: { in: createdPracticeIds } } }).catch(() => undefined);
  }
  await prisma.$disconnect().catch(() => undefined);
});

function body(label: string, extra: Record<string, unknown>) {
  return {
    practiceName: `Fixture Agreements ${label} ${suffix}`,
    displayName: 'Fixture Owner',
    email: `agreements-${label}-${suffix}@fixture.test`,
    password: 'fixture-agreements-pw',
    ...extra,
  };
}

describe.skipIf(!dbReady)('signup agreement acceptance', () => {
  it('lists the current agreements publicly', async () => {
    const res = await request(app).get('/api/auth/agreements');
    expect(res.status).toBe(200);
    expect(res.body.agreements).toHaveLength(CURRENT_AGREEMENTS.length);
  });

  it('rejects signup with no agreements and creates no account', async () => {
    const payload = body('none', { acceptedAgreements: [] });
    const res = await request(app).post('/api/auth/register').send(payload);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AGREEMENTS_REQUIRED');
    expect(await prisma.user.findUnique({ where: { email: payload.email } })).toBeNull();
  });

  it('rejects signup missing the call-listening consent', async () => {
    const payload = body('partial', {
      acceptedAgreements: accepted.filter((a) => a.kind !== 'call_listening_consent'),
    });
    const res = await request(app).post('/api/auth/register').send(payload);
    expect(res.status).toBe(400);
    expect(res.body.missing).toEqual(['call_listening_consent']);
    expect(await prisma.user.findUnique({ where: { email: payload.email } })).toBeNull();
  });

  it('rejects a stale version', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(
        body('stale', {
          acceptedAgreements: accepted.map((a) => (a.kind === 'terms_of_service' ? { ...a, version: '1999-01-01' } : a)),
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.stale).toEqual(['terms_of_service']);
  });

  it('rejects a request that omits the field entirely', async () => {
    const res = await request(app).post('/api/auth/register').send(body('omitted', {}));
    expect(res.status).toBe(400);
  });

  it('stores one row per agreement with user, practice, version and time', async () => {
    const res = await request(app).post('/api/auth/register').send(body('ok', { acceptedAgreements: accepted }));
    expect(res.status).toBe(201);
    createdUserIds.push(res.body.user.id);
    createdPracticeIds.push(res.body.practiceId);

    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return tx.agreementAcceptance.findMany({ where: { userId: res.body.user.id } });
    });
    expect(rows).toHaveLength(CURRENT_AGREEMENTS.length);
    for (const row of rows) {
      expect(row.practiceId).toBe(res.body.practiceId);
      expect(row.source).toBe('signup');
      expect(row.acceptedAt).toBeInstanceOf(Date);
      expect(CURRENT_AGREEMENTS.find((a) => a.kind === row.kind)?.version).toBe(row.version);
    }
  });

  it('refuses to rewrite a stored acceptance', async () => {
    const user = await prisma.user.findUnique({ where: { email: `agreements-ok-${suffix}@fixture.test` } });
    if (!user) throw new Error('fixture user missing: the signup test must run first');
    const userId = user.id;
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
        await tx.agreementAcceptance.updateMany({ where: { userId }, data: { version: 'tampered' } });
      }),
    ).rejects.toThrow(/append-only/);
  });
});
