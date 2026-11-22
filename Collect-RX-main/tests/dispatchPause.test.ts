import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../src/server/index.js';
import { validateDispatch } from '../src/carriers/adapter.js';
import {
  checkDispatchPause,
  setDispatchPause,
  listActiveDispatchPauses,
} from '../src/server/pauseControls/dispatchPause.js';
import { runWithRlsBypass } from '../src/server/db/rlsContext.js';
import { createPracticeForTests } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch {
  /* DB-backed tests are skipped when no database is reachable; CI always has one */
}

const practiceIds: string[] = [];

async function clearPauseRows() {
  await runWithRlsBypass(() => prisma.featureFlag.deleteMany({ where: { feature: { startsWith: 'dispatch_pause.' } } }));
}

afterEach(async () => {
  if (dbReady) await clearPauseRows();
});

afterAll(async () => {
  if (dbReady) {
    await clearPauseRows();
    await runWithRlsBypass(async () => {
      await prisma.carrierBlockEvent.deleteMany({ where: { practiceId: { in: practiceIds } } });
      await prisma.practice.deleteMany({ where: { id: { in: practiceIds } } });
    });
  }
  await prisma.$disconnect().catch(() => undefined);
});

async function newPractice(): Promise<string> {
  const practice = await createPracticeForTests(prisma);
  practiceIds.push(practice.id);
  return practice.id;
}

describe.skipIf(!dbReady)('dispatch pause scopes', () => {
  it('allows a dial when nothing is paused', async () => {
    const practiceId = await newPractice();
    expect(await checkDispatchPause(prisma, { practiceId, carrierId: 'sun_life' })).toEqual({ allowed: true });
  });

  it('system pause stops every practice and every carrier, and resumes', async () => {
    const a = await newPractice();
    const b = await newPractice();
    await setDispatchPause(prisma, { scope: 'system', practiceId: null }, true, 'test pause');
    for (const practiceId of [a, b]) {
      const guard = await checkDispatchPause(prisma, { practiceId, carrierId: 'manulife' });
      expect(guard).toMatchObject({ allowed: false, code: 'PAUSED_SYSTEM' });
    }
    await setDispatchPause(prisma, { scope: 'system', practiceId: null }, false, null);
    expect(await checkDispatchPause(prisma, { practiceId: a, carrierId: 'manulife' })).toEqual({ allowed: true });
  });

  it('practice pause stops only that practice', async () => {
    const paused = await newPractice();
    const other = await newPractice();
    await setDispatchPause(prisma, { scope: 'practice', practiceId: paused }, true, 'test pause');
    expect(await checkDispatchPause(prisma, { practiceId: paused, carrierId: 'rbc_insurance' })).toMatchObject({
      allowed: false,
      code: 'PAUSED_PRACTICE',
    });
    expect(await checkDispatchPause(prisma, { practiceId: other, carrierId: 'rbc_insurance' })).toEqual({ allowed: true });
  });

  it('carrier pause stops only that carrier, for every practice', async () => {
    const a = await newPractice();
    const b = await newPractice();
    await setDispatchPause(prisma, { scope: 'carrier', practiceId: null, carrierId: 'sun_life' }, true, 'test pause');
    for (const practiceId of [a, b]) {
      expect(await checkDispatchPause(prisma, { practiceId, carrierId: 'sun_life' })).toMatchObject({
        allowed: false,
        code: 'PAUSED_CARRIER',
      });
      expect(await checkDispatchPause(prisma, { practiceId, carrierId: 'canada_life' })).toEqual({ allowed: true });
    }
  });

  it('a carrier pause scoped to one practice leaves other practices dialing', async () => {
    const paused = await newPractice();
    const other = await newPractice();
    await setDispatchPause(prisma, { scope: 'carrier', practiceId: paused, carrierId: 'green_shield' }, true, 'test pause');
    expect(await checkDispatchPause(prisma, { practiceId: paused, carrierId: 'green_shield' })).toMatchObject({
      allowed: false,
      code: 'PAUSED_CARRIER',
    });
    expect(await checkDispatchPause(prisma, { practiceId: other, carrierId: 'green_shield' })).toEqual({ allowed: true });
  });

  it('system pause takes precedence over practice and carrier pauses', async () => {
    const practiceId = await newPractice();
    await setDispatchPause(prisma, { scope: 'carrier', practiceId: null, carrierId: 'rbc_insurance' }, true, 'c');
    await setDispatchPause(prisma, { scope: 'practice', practiceId }, true, 'p');
    await setDispatchPause(prisma, { scope: 'system', practiceId: null }, true, 's');
    expect(await checkDispatchPause(prisma, { practiceId, carrierId: 'rbc_insurance' })).toMatchObject({ code: 'PAUSED_SYSTEM' });
  });

  it('resume clears duplicate global rows, since NULL practice ids are not unique in the table', async () => {
    const practiceId = await newPractice();
    await runWithRlsBypass(async () => {
      await prisma.featureFlag.create({ data: { practiceId: null, feature: 'dispatch_pause.system', paused: true } });
      await prisma.featureFlag.create({ data: { practiceId: null, feature: 'dispatch_pause.system', paused: true } });
    });
    await setDispatchPause(prisma, { scope: 'system', practiceId: null }, false, null);
    expect(await checkDispatchPause(prisma, { practiceId, carrierId: 'sun_life' })).toEqual({ allowed: true });
  });

  it('lists the pauses in force', async () => {
    const practiceId = await newPractice();
    await setDispatchPause(prisma, { scope: 'practice', practiceId }, true, 'listed');
    await setDispatchPause(prisma, { scope: 'carrier', practiceId: null, carrierId: 'telus_adjudicare' }, true, 'listed');
    const active = await listActiveDispatchPauses(prisma);
    expect(active).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: 'practice', practiceId, reason: 'listed' }),
        expect.objectContaining({ scope: 'carrier', carrierId: 'telus_adjudicare', practiceId: null }),
      ]),
    );
  });

  it('fails closed when the pause state cannot be read', async () => {
    const broken = {
      featureFlag: { findMany: vi.fn().mockRejectedValue(new Error('db unavailable')) },
    } as unknown as PrismaClient;
    const guard = await checkDispatchPause(broken, { practiceId: 'p', carrierId: 'sun_life' });
    expect(guard).toMatchObject({ allowed: false, code: 'PAUSE_STATE_UNAVAILABLE' });
  });
});

describe.skipIf(!dbReady)('validateDispatch honors pauses without weakening CARRIER_BLOCK', () => {
  const base = {
    claimId: 'claim-not-reached',
    daysOutstanding: 45,
    attemptsSoFar: 0,
    claimStatus: 'PENDING' as const,
    scheduledFor: new Date('2026-11-17T15:00:00Z'),
  };

  it('returns the pause code for a paused practice', async () => {
    const practiceId = await newPractice();
    await setDispatchPause(prisma, { scope: 'practice', practiceId }, true, 'validate');
    const guard = await validateDispatch(prisma, { ...base, practiceId, carrierId: 'sun_life' });
    expect(guard).toMatchObject({ allowed: false, code: 'PAUSED_PRACTICE' });
  });

  it('reports CARRIER_BLOCK first when a block and a pause are both active', async () => {
    const practiceId = await newPractice();
    await runWithRlsBypass(() =>
      prisma.carrierBlockEvent.create({ data: { practiceId, carrierId: 'sun_life', notes: 'test block' } }),
    );
    await setDispatchPause(prisma, { scope: 'system', practiceId: null }, true, 'validate');
    const guard = await validateDispatch(prisma, { ...base, practiceId, carrierId: 'sun_life' });
    expect(guard).toMatchObject({ allowed: false, code: 'CARRIER_BLOCK' });
  });

  it('refuses the dial when pause state is unreadable (fail closed through validateDispatch)', async () => {
    const practiceId = await newPractice();
    const failing = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop === 'featureFlag') return { findMany: () => Promise.reject(new Error('db unavailable')) };
        return Reflect.get(target, prop, receiver);
      },
    });
    const guard = await validateDispatch(failing, { ...base, practiceId, carrierId: 'sun_life' });
    expect(guard).toMatchObject({ allowed: false, code: 'PAUSE_STATE_UNAVAILABLE' });
  });
});
