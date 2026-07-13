import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { extendPrismaWithRls } from '../src/lib/prismaRls.js';
import { runWithPracticeRls, runWithRlsBypass } from '../src/server/db/rlsContext.js';

const basePrisma = new PrismaClient();
const prisma = extendPrismaWithRls(basePrisma);
let dbReady = false;
let practiceAId = '';
let practiceBId = '';
let claimAId = '';
let claimBId = '';

try {
  await basePrisma.$connect();
  await basePrisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch {
  dbReady = false;
}

async function createPractice(name: string): Promise<string> {
  const practice = await basePrisma.practice.create({
    data: {
      name,
      timezone: 'America/Toronto',
      passwordHash: 'rls-strict-test-password-hash',
    },
  });
  return practice.id;
}

describe.skipIf(!dbReady)('strict PostgreSQL RLS', () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  it('allows only the current practice to read and mutate claims', async () => {
    practiceAId = await createPractice(`RLS Strict A ${suffix}`);
    practiceBId = await createPractice(`RLS Strict B ${suffix}`);

    const [claimA, claimB] = await Promise.all([
      runWithPracticeRls(practiceAId, () =>
        prisma.insuranceClaim.create({
          data: {
            practiceId: practiceAId,
            carrierId: 'sun_life',
            claimNumber: `RLS-A-${suffix}`,
            patientToken: crypto.randomUUID(),
            billedAmount: 100,
            outstandingAmount: 100,
            daysOutstanding: 45,
          },
        }),
      ),
      runWithPracticeRls(practiceBId, () =>
        prisma.insuranceClaim.create({
          data: {
            practiceId: practiceBId,
            carrierId: 'canada_life',
            claimNumber: `RLS-B-${suffix}`,
            patientToken: crypto.randomUUID(),
            billedAmount: 100,
            outstandingAmount: 100,
            daysOutstanding: 45,
          },
        }),
      ),
    ]);
    claimAId = claimA.id;
    claimBId = claimB.id;

    const visibleToA = await runWithPracticeRls(practiceAId, () =>
      prisma.insuranceClaim.findMany({ select: { id: true } }),
    );
    expect(visibleToA.map((claim) => claim.id)).toContain(claimAId);
    expect(visibleToA.map((claim) => claim.id)).not.toContain(claimBId);

    const crossTenantUpdate = await runWithPracticeRls(practiceAId, () =>
      prisma.insuranceClaim.updateMany({
        where: { id: claimBId },
        data: { status: 'RESOLVED' },
      }),
    );
    expect(crossTenantUpdate.count).toBe(0);

    const ownClaim = await runWithPracticeRls(practiceAId, () =>
      prisma.insuranceClaim.update({
        where: { id: claimAId },
        data: { status: 'RESOLVED' },
      }),
    );
    expect(ownClaim.status).toBe('RESOLVED');
  });
});

afterAll(async () => {
  if (!dbReady) {
    await basePrisma.$disconnect().catch(() => undefined);
    return;
  }
  await runWithRlsBypass(async () => {
    if (practiceAId || practiceBId) {
      await prisma.insuranceClaim.deleteMany({
        where: { practiceId: { in: [practiceAId, practiceBId].filter(Boolean) } },
      });
      await basePrisma.practice.deleteMany({
        where: { id: { in: [practiceAId, practiceBId].filter(Boolean) } },
      });
    }
  });
  await basePrisma.$disconnect();
});
