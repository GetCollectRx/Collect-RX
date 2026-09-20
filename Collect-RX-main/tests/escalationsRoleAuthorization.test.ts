/**
 * PUT /api/calls/:practiceId/escalations/:id authorized off getUserRole()
 * (the brief UserRole persona), not the raw PracticeRole. practiceRoleToBrief()
 * collapses office_manager, billing_coordinator, AND associate_dentist into the
 * same brief 'practice_owner' bucket for coarse routing (see
 * src/server/accessControl/types.ts) -- so the route's
 * `['front_desk','practice_owner','billing_ops_manager'].includes(role)` check
 * let a real associate_dentist through by accident, purely because they share
 * a brief-persona bucket with office_manager/billing_coordinator (who
 * legitimately should be allowed). src/lib/useRoleAccess.ts marks
 * associate_dentist isReadOnly: true / canResolveEscalations: false /
 * canEscalateCalls: false -- a clinical role with no call-ops or billing
 * write access anywhere else in the app -- but this one endpoint let it
 * resolve escalations directly, including 'written_off', which flips the
 * claim to DENIED and drops it from the call queue.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server/index.js';
import { createPracticeWithOwnerForTests, cleanupPracticeWithUsers } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[escalationsRoleAuthorization] DATABASE_URL unreachable — skipping:',
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

async function makeOpenEscalation(practiceId: string) {
  const claim = await prisma.insuranceClaim.create({
    data: {
      practiceId,
      carrierId: 'sun_life',
      claimNumber: `ESC-TEST-${Date.now()}`,
      patientToken: 'test-token-not-real-phi',
      billedAmount: 500,
      outstandingAmount: 500,
      daysOutstanding: 40,
      status: 'PENDING',
    },
  });
  const escalation = await prisma.callEscalation.create({
    data: {
      practiceId,
      claimId: claim.id,
      claimRef: claim.claimNumber,
      carrierId: 'sun_life',
      amountClaimedCents: 50000,
      reason: 'Test escalation for role-authorization regression',
      status: 'open',
    },
  });
  return { claim, escalation };
}

(dbReady ? describe : describe.skip)('PUT /api/calls/:practiceId/escalations/:id — role enforcement', () => {
  it('associate_dentist (read-only clinical role) cannot resolve escalations', async () => {
    const owner = await createPracticeWithOwnerForTests(prisma, { role: 'associate_dentist' });
    try {
      const { claim, escalation } = await makeOpenEscalation(owner.practice.id);
      const login = await request(app).post('/api/auth/login').send({ email: owner.email, password: owner.password });
      expect(login.status).toBe(200);
      const cookie = cookieHeaderFrom(login);

      const res = await request(app)
        .put(`/api/calls/${owner.practice.id}/escalations/${escalation.id}`)
        .set('Cookie', cookie)
        .send({ resolution: 'written_off' });
      expect(res.status).toBe(403);

      const claimAfter = await prisma.insuranceClaim.findUnique({ where: { id: claim.id } });
      expect(claimAfter?.status).toBe('PENDING');
    } finally {
      await cleanupPracticeWithUsers(prisma, owner.practice.id);
    }
  });

  it('office_manager can still resolve escalations (the fix must not lock out a legitimate resolver)', async () => {
    const owner = await createPracticeWithOwnerForTests(prisma, { role: 'office_manager' });
    try {
      const { escalation } = await makeOpenEscalation(owner.practice.id);
      const login = await request(app).post('/api/auth/login').send({ email: owner.email, password: owner.password });
      expect(login.status).toBe(200);
      const cookie = cookieHeaderFrom(login);

      const res = await request(app)
        .put(`/api/calls/${owner.practice.id}/escalations/${escalation.id}`)
        .set('Cookie', cookie)
        .send({ resolution: 'resolved' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    } finally {
      await cleanupPracticeWithUsers(prisma, owner.practice.id);
    }
  });
});
