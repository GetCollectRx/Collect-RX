import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';

let dbReady = false;
let practiceId = '';
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch {
  dbReady = false;
}

describe.skipIf(!dbReady)('InsuranceClaim soft delete', () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  it('keeps history while excluding deleted claims from operational reads and queues', async () => {
    const practice = await prisma.practice.create({
      data: {
        name: `Soft Delete Fixture ${suffix}`,
        timezone: 'America/Toronto',
        passwordHash: 'soft-delete-test-password-hash',
      },
    });
    practiceId = practice.id;
    const [activeClaim, deletedClaim] = await Promise.all(
      ['active', 'deleted'].map((kind) =>
        prisma.insuranceClaim.create({
          data: {
            practiceId,
            carrierId: 'sun_life',
            claimNumber: `SOFT-${kind}-${suffix}`,
            patientToken: crypto.randomUUID(),
            billedAmount: 100,
            outstandingAmount: 100,
            daysOutstanding: 45,
          },
        }),
      ),
    );
    await prisma.callQueue.create({
      data: {
        practiceId,
        claimId: deletedClaim.id,
        scheduledFor: new Date(),
      },
    });
    await prisma.insuranceClaim.update({
      where: { id: deletedClaim.id },
      data: { deletedAt: new Date() },
    });

    const visibleClaims = await prisma.insuranceClaim.findMany({
      where: { practiceId, deletedAt: null },
      select: { id: true },
    });
    expect(visibleClaims.map((claim) => claim.id)).toEqual([activeClaim.id]);

    const dispatchableQueue = await prisma.callQueue.findMany({
      where: { practiceId, status: 'PENDING', claim: { deletedAt: null } },
      select: { claimId: true },
    });
    expect(dispatchableQueue).toHaveLength(0);

    const retained = await prisma.insuranceClaim.findUnique({
      where: { id: deletedClaim.id },
      select: { deletedAt: true },
    });
    expect(retained?.deletedAt).not.toBeNull();
  });
});

afterAll(async () => {
  if (practiceId) {
    await prisma.callQueue.deleteMany({ where: { practiceId } });
    await prisma.insuranceClaim.deleteMany({ where: { practiceId } });
    await prisma.practice.delete({ where: { id: practiceId } });
  }
  await prisma.$disconnect().catch(() => undefined);
});
