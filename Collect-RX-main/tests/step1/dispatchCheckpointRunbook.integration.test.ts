/**
 * The SQL in docs/runbooks/dispatch-approval-checkpoint.md is extracted and run
 * against Postgres, so the runbook cannot drift from what the flag does. Checks
 * the default-off behaviour and that no statement changes another practice's row.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPracticeForTests } from '../factories/practice.js';
import { DISPATCH_FEATURES, isDispatchFeatureEnabled } from '../../src/server/featureFlags/dispatchFeatures.js';

const FEATURE = DISPATCH_FEATURES.APPROVAL_CHECKPOINT;
const RUNBOOK = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'runbooks', 'dispatch-approval-checkpoint.md'), 'utf8');

function block(id: string): string {
  const match = RUNBOOK.match(new RegExp('```sql\\n-- runbook:' + id + '\\n([\\s\\S]*?)```'));
  if (!match) throw new Error(`runbook block ${id} not found`);
  return match[1];
}

const prisma = new PrismaClient();
let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn('[dispatchCheckpointRunbook] DATABASE_URL unreachable, skipping:', (e as Error).message);
}

async function run(id: string, practiceId?: string) {
  const sql = block(id).replace(/<practice id>/g, practiceId ?? '');
  // Split on statement-ending semicolons only; the blocks contain no semicolons inside strings.
  for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(statement);
  }
}

describe.skipIf(!dbReady)('approval checkpoint runbook SQL (real Postgres)', () => {
  let a: string;
  let b: string;

  beforeAll(async () => {
    a = (await createPracticeForTests(prisma)).id;
    b = (await createPracticeForTests(prisma)).id;
  });

  beforeEach(async () => {
    await prisma.featureFlag.deleteMany({ where: { feature: FEATURE } });
  });

  afterAll(async () => {
    await prisma.featureFlag.deleteMany({ where: { feature: FEATURE } });
    for (const id of [a, b]) await prisma.practice.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  const on = (id: string) => isDispatchFeatureEnabled(prisma, id, FEATURE);

  it('is off for everyone before any row exists', async () => {
    expect(await on(a)).toBe(false);
    expect(await on(b)).toBe(false);
  });

  it('enable-practice turns it on for that practice only, and is safe to run twice', async () => {
    await run('enable-practice', a);
    await run('enable-practice', a);
    expect(await on(a)).toBe(true);
    expect(await on(b)).toBe(false);
    expect(await prisma.featureFlag.count({ where: { feature: FEATURE, practiceId: a } })).toBe(1);
  });

  it('enable-global turns it on for practices without their own row, and is safe to run twice', async () => {
    await run('enable-global');
    await run('enable-global');
    expect(await on(a)).toBe(true);
    expect(await on(b)).toBe(true);
    expect(await prisma.featureFlag.count({ where: { feature: FEATURE, practiceId: null } })).toBe(1);
  });

  it('disable-practice stops enforcement for that practice and leaves the other alone', async () => {
    await run('enable-practice', a);
    await run('enable-practice', b);
    await run('disable-practice', a);
    expect(await on(a)).toBe(false);
    expect(await on(b)).toBe(true);
  });

  it('disable-global touches only the global row: a practice with its own enabled row stays enforced', async () => {
    await run('enable-global');
    await run('enable-practice', a);
    await run('disable-global');
    expect(await on(a)).toBe(true);
    expect(await on(b)).toBe(false);
  });
});
