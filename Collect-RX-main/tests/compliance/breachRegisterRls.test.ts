/**
 * RLS integration test for the PHIPA breach register (W4).
 *
 * Proves, against a real Postgres with the migrations applied, that:
 *   1. Practice A sees only its own breach rows.
 *   2. With no tenant context, no rows are visible.
 *   3. A write tagged with another practice's id is rejected by WITH CHECK.
 *
 * Checks run as a non-owner role (NOBYPASSRLS), because the table owner can be
 * exempt from policy depending on FORCE settings. Skipped when DATABASE_URL is
 * unreachable, so the unit suite still runs without Postgres.
 *
 * Synthetic data only. No PHI, no real practice names or emails.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { createPracticeForTests, cleanupPracticeWithUsers } from '../factories/practice.js';
import { runWithRlsBypass } from '../../src/server/db/rlsContext.js';

const ROLE = 'collectrx_rls_breach_test';
let dbReady = false;
let practiceA = '';
let practiceB = '';
let rowA = '';
let rowB = '';

async function asAppRole<T>(practiceId: string | null, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${ROLE}`);
    if (practiceId) {
      await tx.$executeRaw`SELECT set_config('app.practice_id', ${practiceId}, true)`;
    } else {
      await tx.$executeRaw`SELECT set_config('app.practice_id', '', true)`;
    }
    return fn(tx);
  });
}

async function insertBreach(practiceId: string) {
  return runWithRlsBypass(() =>
    prisma.pHIPABreachNotification.create({
      data: {
        practiceId,
        notificationType: 'POLICY_VIOLATION',
        description: 'synthetic test row',
        notificationDeadline: new Date('2026-12-31T00:00:00Z'),
        circumstances: 'synthetic circumstances',
      },
    }),
  );
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReady = true;
  } catch (e) {
    console.warn('[breachRegisterRls] DATABASE_URL unreachable, skipping:', (e as Error).message);
    return;
  }
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
        CREATE ROLE ${ROLE} NOLOGIN NOBYPASSRLS NOSUPERUSER;
      END IF;
    END $$;`);
  await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
  await prisma.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON "phipa_breach_notifications" TO ${ROLE}`,
  );
  const a = await createPracticeForTests(prisma);
  const b = await createPracticeForTests(prisma);
  practiceA = a.id;
  practiceB = b.id;
  rowA = (await insertBreach(practiceA)).id;
  rowB = (await insertBreach(practiceB)).id;
});

afterAll(async () => {
  if (!dbReady) return;
  await runWithRlsBypass(async () => {
    await prisma.pHIPABreachNotification.deleteMany({ where: { id: { in: [rowA, rowB].filter(Boolean) } } });
  });
  for (const id of [practiceA, practiceB].filter(Boolean)) {
    await cleanupPracticeWithUsers(prisma, id);
  }
  await prisma.$disconnect();
});

describe('phipa_breach_notifications RLS', () => {
  it('practice A sees its own breach row and not practice B', async () => {
    if (!dbReady) return;
    const rows = await asAppRole(practiceA, (tx) =>
      tx.$queryRaw<Array<{ id: string; practice_id: string }>>`SELECT id, practice_id FROM "phipa_breach_notifications"`,
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(rowA);
    expect(ids).not.toContain(rowB);
    expect(rows.every((r) => r.practice_id === practiceA)).toBe(true);
  });

  it('with no tenant context, no breach rows are visible', async () => {
    if (!dbReady) return;
    const rows = await asAppRole(null, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "phipa_breach_notifications"`,
    );
    expect(rows).toHaveLength(0);
  });

  it('rejects an insert tagged with another practice id (WITH CHECK)', async () => {
    if (!dbReady) return;
    await expect(
      asAppRole(practiceA, (tx) =>
        tx.$executeRaw`INSERT INTO "phipa_breach_notifications"
          ("id", "practice_id", "notificationType", "description", "notification_deadline", "created_at")
          VALUES (${randomUUID()}, ${practiceB}, 'POLICY_VIOLATION', 'cross-tenant attempt', now(), now())`,
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });

  it('rejects an update that moves a row to another practice', async () => {
    if (!dbReady) return;
    await expect(
      asAppRole(practiceA, (tx) =>
        tx.$executeRaw`UPDATE "phipa_breach_notifications" SET "practice_id" = ${practiceB} WHERE "id" = ${rowA}`,
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });
});
