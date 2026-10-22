import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { PrismaClient as PrismaClientCtor } from '@prisma/client';

/**
 * Tenant isolation for the consent attestation and agent permission tables.
 * Runs only under COLLECTRX_RLS_TEST_STRICT=1, against a NOSUPERUSER
 * NOBYPASSRLS role (CI rls-strict job). A superuser or BYPASSRLS role would
 * make these assertions meaningless, so this file does not run elsewhere.
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
    data: { name, timezone: 'America/Toronto', passwordHash: 'consent-rls-test-password-hash' },
  });
  return practice.id;
}

/** Mirror production RLS session variables inside one transaction, as the app role. */
async function withPracticeRlsSession<T>(
  practiceId: string,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return strictPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.practice_id', ${practiceId}, true)`;
    return fn(tx as PrismaClient);
  });
}

describe.skipIf(!strictRls)('consent attestation tenant isolation (strict RLS)', () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await adminPrisma.$connect();
    await strictPrisma.$connect();
    practiceAId = await createPractice(`Consent RLS A ${suffix}`);
    practiceBId = await createPractice(`Consent RLS B ${suffix}`);
    await adminPrisma.practiceConsentAttestation.create({
      data: {
        practiceId: practiceAId,
        textVersion: 'rls-test-version',
        signerName: 'Synthetic Signer A',
        signerRole: 'Practice Owner',
      },
    });
    await adminPrisma.practiceAgentPermission.create({
      data: { practiceId: practiceAId, purpose: 'CLAIM_STATUS_INQUIRY' },
    });
  });

  afterAll(async () => {
    await adminPrisma.practiceAgentPermission.deleteMany({
      where: { practiceId: { in: [practiceAId, practiceBId] } },
    });
    await adminPrisma.practiceConsentAttestation.deleteMany({
      where: { practiceId: { in: [practiceAId, practiceBId] } },
    });
    await adminPrisma.practice.deleteMany({ where: { id: { in: [practiceAId, practiceBId] } } });
    await adminPrisma.$disconnect();
    await strictPrisma.$disconnect();
  });

  it('shows practice A its own attestation and hides it from practice B', async () => {
    const seenByA = await withPracticeRlsSession(practiceAId, (tx) =>
      tx.practiceConsentAttestation.findMany({ select: { practiceId: true } }),
    );
    expect(seenByA.length).toBeGreaterThan(0);
    expect(seenByA.every((row) => row.practiceId === practiceAId)).toBe(true);

    const seenByB = await withPracticeRlsSession(practiceBId, (tx) =>
      tx.practiceConsentAttestation.findMany({ select: { practiceId: true } }),
    );
    expect(seenByB).toHaveLength(0);
  });

  it('hides practice A agent permission from practice B', async () => {
    const seenByB = await withPracticeRlsSession(practiceBId, (tx) =>
      tx.practiceAgentPermission.findMany({ select: { practiceId: true } }),
    );
    expect(seenByB).toHaveLength(0);
  });

  it('refuses to write an attestation for another practice (WITH CHECK)', async () => {
    await expect(
      withPracticeRlsSession(practiceBId, (tx) =>
        tx.practiceConsentAttestation.create({
          data: {
            practiceId: practiceAId,
            textVersion: 'rls-test-version',
            signerName: 'Synthetic Intruder',
            signerRole: 'Practice Owner',
          },
        }),
      ),
    ).rejects.toThrow();
  });
});
