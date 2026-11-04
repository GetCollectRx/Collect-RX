import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../../src/server/index.js';
import {
  cleanupPracticeWithUsers,
  createPracticeWithOwnerForTests,
} from '../factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (error) {
  console.warn(
    '[cm-7-2-persona-journeys] DATABASE_URL unreachable — skipping:',
    (error as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

function cookieHeaderFrom(response: request.Response): string {
  const setCookie = response.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
}

async function login(email: string, password: string): Promise<string> {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password });
  expect(response.status).toBe(200);
  return cookieHeaderFrom(response);
}

async function seedSyntheticClaim(practiceId: string, suffix: string) {
  return prisma.insuranceClaim.create({
    data: {
      practiceId,
      carrierId: 'sun_life',
      claimNumber: `CM72-${suffix}-${Date.now()}`,
      patientToken: `synthetic-patient-token-${suffix}`,
      billedAmount: 500,
      outstandingAmount: 500,
      daysOutstanding: 45,
      status: 'PENDING',
    },
  });
}

(dbReady ? describe : describe.skip)('CM-7.2 focused persona journeys', () => {
  it('practice_owner: reads own synthetic claims, is rejected cross-practice, and cannot use admin writes', async () => {
    const owner = await createPracticeWithOwnerForTests(prisma, { role: 'practice_owner' });
    const other = await createPracticeWithOwnerForTests(prisma, { role: 'practice_owner' });

    try {
      const ownClaim = await seedSyntheticClaim(owner.practice.id, 'owner-own');
      await seedSyntheticClaim(other.practice.id, 'owner-other');
      const cookie = await login(owner.email, owner.password);

      // Precondition: an authenticated practice_owner session for owner.practice.
      // Action: read the canonical claims route without a conflicting practice hint.
      // Expected result: the owner can read only its own synthetic claim set.
      const ownClaims = await request(app)
        .get('/api/insurance/claims')
        .set('Cookie', cookie);
      expect(ownClaims.status).toBe(200);
      expect(ownClaims.body.data.map((claim: { id: string }) => claim.id)).toContain(ownClaim.id);
      expect(ownClaims.body.data.every((claim: { practiceId: string }) => claim.practiceId === owner.practice.id)).toBe(true);

      // Precondition: the same authenticated owner session and a different practice ID.
      // Action: request claims with a cross-practice practiceId hint.
      // Forbidden result: the request is rejected before another tenant is read.
      const crossPracticeClaims = await request(app)
        .get(`/api/insurance/claims?practiceId=${other.practice.id}`)
        .set('Cookie', cookie);
      expect(crossPracticeClaims.status).toBe(403);

      const beforeAdminSettings = await prisma.practice.findUniqueOrThrow({
        where: { id: owner.practice.id },
        select: { settings: true },
      });

      // Precondition: the owner session and its current practice settings.
      // Action: attempt the admin-only settings write route.
      // Forbidden result: the existing admin write guard rejects it and state is unchanged.
      const forbiddenAdminWrite = await request(app)
        .put('/api/admin/settings')
        .set('Cookie', cookie)
        .send({ settings: { cm72OwnerForbiddenWrite: true } });
      expect(forbiddenAdminWrite.status).toBe(403);

      const afterAdminSettings = await prisma.practice.findUniqueOrThrow({
        where: { id: owner.practice.id },
        select: { settings: true },
      });
      expect(afterAdminSettings.settings).toEqual(beforeAdminSettings.settings);
    } finally {
      await cleanupPracticeWithUsers(prisma, owner.practice.id);
      await cleanupPracticeWithUsers(prisma, other.practice.id);
    }
  });

  it('office_manager: reads own synthetic claims, updates allowed admin settings, and is rejected cross-practice', async () => {
    const manager = await createPracticeWithOwnerForTests(prisma, { role: 'office_manager' });
    const other = await createPracticeWithOwnerForTests(prisma, { role: 'office_manager' });

    try {
      const ownClaim = await seedSyntheticClaim(manager.practice.id, 'manager-own');
      await seedSyntheticClaim(other.practice.id, 'manager-other');
      const cookie = await login(manager.email, manager.password);

      // Precondition: an authenticated office_manager session for manager.practice.
      // Action: read the canonical claims route without a conflicting practice hint.
      // Expected result: the manager can read its own synthetic claim set.
      const ownClaims = await request(app)
        .get('/api/insurance/claims')
        .set('Cookie', cookie);
      expect(ownClaims.status).toBe(200);
      expect(ownClaims.body.data.map((claim: { id: string }) => claim.id)).toContain(ownClaim.id);
      expect(ownClaims.body.data.every((claim: { practiceId: string }) => claim.practiceId === manager.practice.id)).toBe(true);

      const beforeSettings = await prisma.practice.findUniqueOrThrow({
        where: { id: manager.practice.id },
        select: { settings: true },
      });

      // Precondition: the office_manager session and its current practice settings.
      // Action: use the existing office-manager admin settings write route.
      // Expected result: the allowed mutation succeeds and persists only in that practice.
      const allowedAdminWrite = await request(app)
        .put('/api/admin/settings')
        .set('Cookie', cookie)
        .send({ settings: { ...(beforeSettings.settings as object | null), cm72ManagerWrite: true } });
      expect(allowedAdminWrite.status).toBe(200);
      expect(allowedAdminWrite.body).toEqual({ ok: true });

      const afterSettings = await prisma.practice.findUniqueOrThrow({
        where: { id: manager.practice.id },
        select: { settings: true },
      });
      expect(afterSettings.settings).toMatchObject({ cm72ManagerWrite: true });

      // Precondition: the same authenticated office_manager session and a different practice ID.
      // Action: request claims with a cross-practice practiceId hint.
      // Forbidden result: the request is rejected before another tenant is read.
      const crossPracticeClaims = await request(app)
        .get(`/api/insurance/claims?practiceId=${other.practice.id}`)
        .set('Cookie', cookie);
      expect(crossPracticeClaims.status).toBe(403);
    } finally {
      await cleanupPracticeWithUsers(prisma, manager.practice.id);
      await cleanupPracticeWithUsers(prisma, other.practice.id);
    }
  });
});
