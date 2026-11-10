/**
 * The SQL in docs/runbooks/manual-dispatch-rollback.md is extracted and run
 * against Postgres, so the runbook cannot drift from what the flag does. Checks
 * that no statement removes or changes another practice's row, and that the
 * staged-release order works end to end.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPracticeForTests } from '../factories/practice.js';
import { DISPATCH_FEATURES, isDispatchFeatureEnabled } from '../../src/server/featureFlags/dispatchFeatures.js';

const FEATURE = DISPATCH_FEATURES.MANUAL_SHARED_BUILDER;
const RUNBOOK = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'runbooks', 'manual-dispatch-rollback.md'), 'utf8');

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
  console.warn('[manualDispatchRunbook] DATABASE_URL unreachable, skipping:', (e as Error).message);
}

async function run(id: string, practiceId?: string) {
  const sql = block(id).replace(/<practice id>/g, practiceId ?? '');
  for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(statement);
  }
}

const rows = () =>
  prisma.featureFlag.findMany({ where: { feature: FEATURE }, select: { practiceId: true, paused: true } });

describe.skipIf(!dbReady)('manual dispatch runbook SQL (real Postgres)', () => {
  let a: string;
  let b: string;
  let c: string;

  beforeAll(async () => {
    a = (await createPracticeForTests(prisma)).id;
    b = (await createPracticeForTests(prisma)).id;
    c = (await createPracticeForTests(prisma)).id;
  });

  beforeEach(async () => {
    await prisma.featureFlag.deleteMany({ where: { feature: FEATURE } });
  });

  afterAll(async () => {
    await prisma.featureFlag.deleteMany({ where: { feature: FEATURE } });
    for (const id of [a, b, c]) await prisma.practice.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  const on = (id: string) => isDispatchFeatureEnabled(prisma, id, FEATURE);

  it('default-on: with no rows every practice is on', async () => {
    expect(await on(a)).toBe(true);
    expect(await on(b)).toBe(true);
  });

  it('pause-global is repeatable and leaves exactly one global row', async () => {
    await run('pause-global');
    await run('pause-global');
    expect(await rows()).toEqual([{ practiceId: null, paused: true }]);
    expect(await on(a)).toBe(false);
  });

  it('staged release: global pause, enable one practice, widen, then remove only the global row', async () => {
    await run('pause-global');
    expect(await on(a)).toBe(false);
    await run('enable-practice', a);
    expect(await on(a)).toBe(true);
    expect(await on(b)).toBe(false);
    await run('enable-practice', a); // repeat is safe
    await run('enable-practice', b);
    expect(await on(b)).toBe(true);
    expect(await on(c)).toBe(false);
    await run('resume-global');
    expect((await rows()).every((r) => r.practiceId !== null)).toBe(true);
    expect(await on(a)).toBe(true);
    expect(await on(b)).toBe(true);
    expect(await on(c)).toBe(true);
  });

  it('resume-global cannot delete an unrelated practice pause', async () => {
    await run('pause-practice', a);
    await run('pause-global');
    await run('resume-global');
    expect(await rows()).toEqual([{ practiceId: a, paused: true }]);
    expect(await on(a)).toBe(false);
    expect(await on(b)).toBe(true);
  });

  it('clear-practice removes only that practice row, leaving another practice pause and the global pause', async () => {
    await run('pause-practice', a);
    await run('pause-practice', b);
    await run('pause-global');
    await run('clear-practice', a);
    const remaining = await rows();
    expect(remaining).toHaveLength(2);
    expect(remaining).toContainEqual({ practiceId: b, paused: true });
    expect(remaining).toContainEqual({ practiceId: null, paused: true });
    expect(await on(a)).toBe(false); // follows the global pause now
    expect(await on(b)).toBe(false);
  });

  it('pause-practice then clear-practice returns a practice to the default without touching others', async () => {
    await run('pause-practice', a);
    await run('pause-practice', b);
    expect(await on(a)).toBe(false);
    await run('clear-practice', a);
    expect(await on(a)).toBe(true);
    expect(await on(b)).toBe(false);
  });

  it('rollback-all pauses every enabled practice and the global row, even when no global row existed', async () => {
    await run('enable-practice', a);
    await run('enable-practice', b);
    await run('rollback-all');
    expect(await on(a)).toBe(false);
    expect(await on(b)).toBe(false);
    expect(await on(c)).toBe(false);
    const all = await rows();
    expect(all.every((r) => r.paused)).toBe(true);
    expect(all.filter((r) => r.practiceId === null)).toHaveLength(1);
  });
});
