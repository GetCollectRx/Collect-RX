import { afterAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { PrismaClient as PrismaClientCtor } from '@prisma/client';

/** Superuser / migration role — seeds data; bypasses RLS as PG superuser. */
const setupUrl =
  process.env.RLS_SETUP_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://prisma:prisma@127.0.0.1:5432/prisma?schema=public';

/** Restricted app role under test — must respect FORCE RLS policies. */
const strictUrl = process.env.DATABASE_URL ?? setupUrl;

const adminPrisma = new PrismaClientCtor({ datasources: { db: { url: setupUrl } } });
const strictPrisma = new PrismaClientCtor({ datasources: { db: { url: strictUrl } } });

let dbReady = false;
let practiceAId = '';
let practiceBId = '';
let claimAId = '';
let claimBId = '';

try {
  await adminPrisma.$connect();
  await strictPrisma.$connect();
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

/** Mirror production RLS session vars inside one DB transaction. */
async function withPracticeRlsSession<T>(
  practiceId: string,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return strictPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.practice_id', ${practiceId}, true)`;
    return fn(tx as PrismaClient);
  });
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

    const [queueA, queueB] = await Promise.all([
      adminPrisma.callQueue.create({ data: { practiceId: practiceAId, claimId: claimAId, scheduledFor: new Date() } }),
      adminPrisma.callQueue.create({ data: { practiceId: practiceBId, claimId: claimBId, scheduledFor: new Date() } }),
    ]);
    await Promise.all([
      adminPrisma.callDispatchIntent.create({
        data: {
          practiceId: practiceAId, claimId: claimAId, queueEntryId: queueA.id,
          attemptNumber: 1, idempotencyKey: `strict:${queueA.id}:1`,
        },
      }),
      adminPrisma.callDispatchIntent.create({
        data: {
          practiceId: practiceBId, claimId: claimBId, queueEntryId: queueB.id,
          attemptNumber: 1, idempotencyKey: `strict:${queueB.id}:1`,
        },
      }),
    ]);

    const visibleToA = await withPracticeRlsSession(practiceAId, (tx) =>
      tx.insuranceClaim.findMany({ select: { id: true } }),
    );
    expect(visibleToA.map((claim) => claim.id)).toContain(claimAId);
    expect(visibleToA.map((claim) => claim.id)).not.toContain(claimBId);

    const intentsVisibleToA = await withPracticeRlsSession(practiceAId, (tx) =>
      tx.callDispatchIntent.findMany({ select: { practiceId: true } }),
    );
    expect(intentsVisibleToA).toHaveLength(1);
    expect(intentsVisibleToA[0]?.practiceId).toBe(practiceAId);

    const crossTenantUpdate = await withPracticeRlsSession(practiceAId, (tx) =>
      tx.insuranceClaim.updateMany({
        where: { id: claimBId },
        data: { status: 'RESOLVED' },
      }),
    );
    expect(crossTenantUpdate.count).toBe(0);

    const ownClaim = await withPracticeRlsSession(practiceAId, (tx) =>
      tx.insuranceClaim.update({
        where: { id: claimAId },
        data: { status: 'RESOLVED' },
      }),
    );
    expect(ownClaim.status).toBe('RESOLVED');
  });

  // One representative table per RLS pattern added by
  // 20260926200000_multi_practice_rls_coverage — not exhaustive coverage of
  // all ~40 newly-covered tables, but real proof the three distinct policy
  // shapes that migration introduces actually enforce isolation under a
  // genuinely restricted (NOSUPERUSER NOBYPASSRLS) role, not just "the
  // migration applied without erroring."
  it('straightforward practiceId table (csv_import_logs): cross-tenant read/write both blocked', async () => {
    const practiceA = await createPractice(`RLS Strict CSV-A ${suffix}`);
    const practiceB = await createPractice(`RLS Strict CSV-B ${suffix}`);
    const [userA, userB] = await Promise.all([
      adminPrisma.user.create({
        data: { practiceId: practiceA, email: `rls-strict-csv-a-${suffix}@collectrx.test`, passwordHash: 'x', role: 'practice_owner', displayName: 'A' },
      }),
      adminPrisma.user.create({
        data: { practiceId: practiceB, email: `rls-strict-csv-b-${suffix}@collectrx.test`, passwordHash: 'x', role: 'practice_owner', displayName: 'B' },
      }),
    ]);

    await adminPrisma.csvImportLog.create({
      data: {
        practiceId: practiceA, fileName: 'a.csv', fileHash: `hash-a-${suffix}`, rowCount: 1,
        errorCount: 0, status: 'success', importedBy: userA.id,
      },
    });
    await adminPrisma.csvImportLog.create({
      data: {
        practiceId: practiceB, fileName: 'b.csv', fileHash: `hash-b-${suffix}`, rowCount: 1,
        errorCount: 0, status: 'success', importedBy: userB.id,
      },
    });

    const visibleToA = await withPracticeRlsSession(practiceA, (tx) =>
      tx.csvImportLog.findMany({ where: { fileHash: { in: [`hash-a-${suffix}`, `hash-b-${suffix}`] } } }),
    );
    expect(visibleToA.map((r) => r.fileHash)).toEqual([`hash-a-${suffix}`]);

    await adminPrisma.csvImportLog.deleteMany({ where: { practiceId: { in: [practiceA, practiceB] } } });
    await adminPrisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await adminPrisma.practice.deleteMany({ where: { id: { in: [practiceA, practiceB] } } });
  });

  it('nullable-practiceId table (platform_users): global row visible only under bypass, practice-scoped row still isolated', async () => {
    const practiceA = await createPractice(`RLS Strict PU-A ${suffix}`);
    const globalEmail = `rls-strict-global-${suffix}@collectrx.test`;
    const scopedEmail = `rls-strict-scoped-${suffix}@collectrx.test`;

    await adminPrisma.platformUser.create({
      data: { email: globalEmail, passwordHash: 'x', userRole: 'platform_dev', practiceId: null },
    });
    await adminPrisma.platformUser.create({
      data: { email: scopedEmail, passwordHash: 'x', userRole: 'platform_dev', practiceId: practiceA },
    });

    const visibleToA = await withPracticeRlsSession(practiceA, (tx) =>
      tx.platformUser.findMany({ where: { email: { in: [globalEmail, scopedEmail] } } }),
    );
    // Global (practiceId: null) rows are intentionally invisible to an
    // ordinary practice session — only app.rls_bypass sees those, same as
    // the existing feature_flags policy this pattern mirrors.
    expect(visibleToA.map((u) => u.email)).toEqual([scopedEmail]);

    await adminPrisma.platformUser.deleteMany({ where: { email: { in: [globalEmail, scopedEmail] } } });
    await adminPrisma.practice.deleteMany({ where: { id: practiceA } });
  });

  it('organization-scoped table with no practiceId column (organization_members): visible only to a member practice of that org', async () => {
    const memberPractice = await createPractice(`RLS Strict Org-Member ${suffix}`);
    const outsidePractice = await createPractice(`RLS Strict Org-Outside ${suffix}`);
    const org = await adminPrisma.organization.create({
      data: { name: `RLS Strict Org ${suffix}` },
    });
    await adminPrisma.organizationPractice.create({
      data: { organizationId: org.id, practiceId: memberPractice },
    });
    const user = await adminPrisma.user.create({
      data: {
        practiceId: memberPractice, email: `rls-strict-org-user-${suffix}@collectrx.test`,
        passwordHash: 'x', role: 'practice_owner', displayName: 'RLS Strict Org User',
      },
    });
    await adminPrisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id } });

    const visibleToMember = await withPracticeRlsSession(memberPractice, (tx) =>
      tx.organizationMember.findMany({ where: { organizationId: org.id } }),
    );
    expect(visibleToMember).toHaveLength(1);

    const visibleToOutsider = await withPracticeRlsSession(outsidePractice, (tx) =>
      tx.organizationMember.findMany({ where: { organizationId: org.id } }),
    );
    expect(visibleToOutsider).toHaveLength(0);

    await adminPrisma.organizationMember.deleteMany({ where: { organizationId: org.id } });
    await adminPrisma.user.delete({ where: { id: user.id } });
    await adminPrisma.organizationPractice.deleteMany({ where: { organizationId: org.id } });
    await adminPrisma.organization.delete({ where: { id: org.id } });
    await adminPrisma.practice.deleteMany({ where: { id: { in: [memberPractice, outsidePractice] } } });
  });
});

afterAll(async () => {
  if (!dbReady) {
    await adminPrisma.$disconnect().catch(() => undefined);
    await strictPrisma.$disconnect().catch(() => undefined);
    return;
  }
  if (practiceAId || practiceBId) {
    await adminPrisma.callQueue.deleteMany({
      where: { practiceId: { in: [practiceAId, practiceBId].filter(Boolean) } },
    });
    await adminPrisma.insuranceClaim.deleteMany({
      where: { practiceId: { in: [practiceAId, practiceBId].filter(Boolean) } },
    });
    await adminPrisma.practice.deleteMany({
      where: { id: { in: [practiceAId, practiceBId].filter(Boolean) } },
    });
  }
  await adminPrisma.$disconnect();
  await strictPrisma.$disconnect();
});
