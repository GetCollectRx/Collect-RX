import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { extendPrismaWithRls } from '../src/lib/prismaRls.js';
import { runWithPracticeRls, runWithRlsBypass } from '../src/server/db/rlsContext.js';

/** Superuser / migration role — seeds data; bypasses RLS as PG superuser. */
const setupUrl =
  process.env.RLS_SETUP_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://prisma:prisma@127.0.0.1:5432/prisma?schema=public';

/** Restricted app role under test — must respect FORCE RLS policies. */
const strictUrl = process.env.DATABASE_URL ?? setupUrl;

const adminPrisma = new PrismaClient({ datasources: { db: { url: setupUrl } } });
const strictBase = new PrismaClient({ datasources: { db: { url: strictUrl } } });
const strictPrisma = extendPrismaWithRls(strictBase);

let dbReady = false;
let practiceAId = '';
let practiceBId = '';
let claimAId = '';
let claimBId = '';

try {
  await adminPrisma.$connect();
  await strictBase.$connect();
  await adminPrisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch {
  dbReady = false;
}

async function createPractice(name: string): Promise<string> {
  const practice = await adminPrisma.practice.create({
    data: {
      name,
      timezone: 'America/Toronto',
      passwordHash: 'rls-strict-test-password-hash',
    },
  });
  return practice.id;
}

const strictRls = process.env.COLLECTRX_RLS_TEST_STRICT === '1';

describe.skipIf(!dbReady || !strictRls)('strict PostgreSQL RLS', () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  it('allows only the current practice to read and mutate claims', async () => {
    practiceAId = await createPractice(`RLS Strict A ${suffix}`);
    practiceBId = await createPractice(`RLS Strict B ${suffix}`);

    const [claimA, claimB] = await Promise.all([
      adminPrisma.insuranceClaim.create({
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
      adminPrisma.insuranceClaim.create({
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
    ]);
    claimAId = claimA.id;
    claimBId = claimB.id;

    const visibleToA = await runWithPracticeRls(practiceAId, () =>
      strictPrisma.insuranceClaim.findMany({ select: { id: true } }),
    );
    expect(visibleToA.map((claim) => claim.id)).toContain(claimAId);
    expect(visibleToA.map((claim) => claim.id)).not.toContain(claimBId);

    const crossTenantUpdate = await runWithPracticeRls(practiceAId, () =>
      strictPrisma.insuranceClaim.updateMany({
        where: { id: claimBId },
        data: { status: 'RESOLVED' },
      }),
    );
    expect(crossTenantUpdate.count).toBe(0);

    const ownClaim = await runWithPracticeRls(practiceAId, () =>
      strictPrisma.insuranceClaim.update({
        where: { id: claimAId },
        data: { status: 'RESOLVED' },
      }),
    );
    expect(ownClaim.status).toBe('RESOLVED');
  });
});

afterAll(async () => {
  if (!dbReady) {
    await adminPrisma.$disconnect().catch(() => undefined);
    await strictBase.$disconnect().catch(() => undefined);
    return;
  }
  await runWithRlsBypass(async () => {
    if (practiceAId || practiceBId) {
      await adminPrisma.insuranceClaim.deleteMany({
        where: { practiceId: { in: [practiceAId, practiceBId].filter(Boolean) } },
      });
      await adminPrisma.practice.deleteMany({
        where: { id: { in: [practiceAId, practiceBId].filter(Boolean) } },
      });
    }
  });
  await adminPrisma.$disconnect();
  await strictBase.$disconnect();
});
