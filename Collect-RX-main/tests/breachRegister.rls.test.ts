import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { PrismaClient as PrismaClientCtor } from '@prisma/client';

/**
 * Tenant isolation for the breach register. Runs only under
 * COLLECTRX_RLS_TEST_STRICT=1 against a NOSUPERUSER NOBYPASSRLS role (CI
 * rls-strict job). A superuser or BYPASSRLS role would make these checks meaningless.
 */
const setupUrl =
  process.env.RLS_SETUP_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://prisma:prisma@127.0.0.1:5432/prisma?schema=public';
const strictUrl = process.env.DATABASE_URL ?? setupUrl;

const adminPrisma = new PrismaClientCtor({ datasources: { db: { url: setupUrl } } });
const strictPrisma = new PrismaClientCtor({ datasources: { db: { url: strictUrl } } });

const strictRls = process.env.COLLECTRX_RLS_TEST_STRICT === '1';

let practiceAId = '';
let practiceBId = '';

async function createPractice(name: string): Promise<string> {
  const practice = await adminPrisma.practice.create({
    data: { name, timezone: 'America/Toronto', passwordHash: 'breach-rls-test-password-hash' },
  });
  return practice.id;
}

async function withPracticeRlsSession<T>(
  practiceId: string,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return strictPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.practice_id', ${practiceId}, true)`;
    return fn(tx as PrismaClient);
  });
}

describe.skipIf(!strictRls)('breach register tenant isolation (strict RLS)', () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await adminPrisma.$connect();
    await strictPrisma.$connect();
    practiceAId = await createPractice(`Breach RLS A ${suffix}`);
    practiceBId = await createPractice(`Breach RLS B ${suffix}`);
    const now = new Date();
    const retainUntil = new Date(now.getTime() + 2 * 365 * 86_400_000);
    await adminPrisma.breachRegisterEntry.create({
      data: {
        practiceId: practiceAId,
        category: 'LOSS',
        province: 'ON',
        circumstances: 'Synthetic loss of a removable drive.',
        periodStart: now,
        discoveredAt: now,
        dataElements: 'synthetic category only',
        individualsCount: 1,
        affectedTokens: [],
        stepsToReduceHarm: 'Drive recovered and wiped.',
        notificationSteps: 'Custodian notified.',
        contactRole: 'Practice privacy contact',
        retainUntil,
        updatedAt: now,
      },
    });
  });

  afterAll(async () => {
    await adminPrisma.breachRegisterEntry.deleteMany({
      where: { practiceId: { in: [practiceAId, practiceBId] } },
    });
    await adminPrisma.practice.deleteMany({ where: { id: { in: [practiceAId, practiceBId] } } });
    await adminPrisma.$disconnect();
    await strictPrisma.$disconnect();
  });

  it('shows practice A its own entries and hides them from practice B', async () => {
    const seenByA = await withPracticeRlsSession(practiceAId, (tx) =>
      tx.breachRegisterEntry.findMany({ select: { practiceId: true } }),
    );
    expect(seenByA.length).toBeGreaterThan(0);
    expect(seenByA.every((row) => row.practiceId === practiceAId)).toBe(true);

    const seenByB = await withPracticeRlsSession(practiceBId, (tx) =>
      tx.breachRegisterEntry.findMany({ select: { practiceId: true } }),
    );
    expect(seenByB).toHaveLength(0);
  });

  it('refuses to write a breach entry for another practice (WITH CHECK)', async () => {
    await expect(
      withPracticeRlsSession(practiceBId, (tx) =>
        tx.breachRegisterEntry.create({
          data: {
            practiceId: practiceAId,
            category: 'LOSS',
            province: 'ON',
            circumstances: 'Synthetic intrusion attempt.',
            periodStart: new Date(),
            discoveredAt: new Date(),
            dataElements: 'synthetic',
            individualsCount: 0,
            affectedTokens: [],
            stepsToReduceHarm: 'none',
            notificationSteps: 'none',
            contactRole: 'role',
            retainUntil: new Date(),
            updatedAt: new Date(),
          },
        }),
      ),
    ).rejects.toThrow();
  });
});
