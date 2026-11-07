/**
 * Hybrid call flow phase persistence and the per-carrier segment medians,
 * against a real database. Synthetic rows only: no patient data of any kind.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CarrierId } from '@prisma/client';

const { prisma } = await import('../src/server/index.js');
const { createPracticeForTests } = await import('./factories/practice.js');
const { recordCallPhase, closeCallPhases, recordCallPhaseByVapiId } = await import(
  '../src/server/frontDesk/callPhaseStore.js'
);
const { loadCarrierSegmentMedians } = await import('../src/server/frontDesk/callSegmentStats.js');
const { parsePhaseHistory } = await import('../src/server/frontDesk/callPhase.js');

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn('[callPhaseStore] DATABASE_URL unreachable, skipping:', (e as Error).message);
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

const T0 = new Date('2026-10-01T15:00:00.000Z');
const plus = (s: number) => new Date(T0.getTime() + s * 1000);

describe.skipIf(!dbReady)('call phase store (real database)', () => {
  let practiceId: string;
  const claimIds: string[] = [];

  async function newAttempt(opts: { carrierId?: CarrierId; initiatedAt?: Date; ending?: 'staff' | 'agent' | null } = {}) {
    const claim = await prisma.insuranceClaim.create({
      data: {
        practiceId,
        carrierId: opts.carrierId ?? 'sun_life',
        claimNumber: `CLM-PH-${Math.random().toString(36).slice(2, 10)}`,
        patientToken: `tok-${Math.random().toString(36).slice(2, 12)}`,
        billedAmount: 100,
        outstandingAmount: 100,
        daysOutstanding: 40,
        status: 'PENDING',
      },
    });
    claimIds.push(claim.id);
    return prisma.callAttempt.create({
      data: {
        claimId: claim.id,
        vapiCallId: `vapi-ph-${Math.random().toString(36).slice(2, 12)}`,
        initiatedAt: opts.initiatedAt ?? T0,
        callEnding: opts.ending ?? null,
      },
    });
  }

  beforeAll(async () => {
    practiceId = (await createPracticeForTests(prisma)).id;
  }, 30_000);

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    if (!dbReady) return;
    await prisma.callAttempt.deleteMany({ where: { claimId: { in: claimIds } } });
    await prisma.insuranceClaim.deleteMany({ where: { practiceId } });
    await prisma.practice.delete({ where: { id: practiceId } }).catch(() => undefined);
  });

  it('writes nothing when HYBRID_CALL_FLOW is off', async () => {
    vi.stubEnv('HYBRID_CALL_FLOW', 'false');
    const attempt = await newAttempt();
    await recordCallPhase(prisma, attempt.id, 'hold');
    await closeCallPhases(prisma, attempt.id, plus(60));
    const row = await prisma.callAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(row.callPhase).toBeNull();
    expect(row.phaseHistory).toBeNull();
    expect(row.wrapUpSeconds).toBeNull();
  });

  it('seeds from initiatedAt, applies transitions and stores segment seconds on close', async () => {
    vi.stubEnv('HYBRID_CALL_FLOW', 'true');
    const attempt = await newAttempt({ ending: 'staff' });
    await recordCallPhase(prisma, attempt.id, 'phone_menu', { at: plus(5) });
    await recordCallPhase(prisma, attempt.id, 'hold', { at: plus(25) });
    await recordCallPhase(prisma, attempt.id, ['rep_answered', 'staff_or_agent'], { at: plus(325) });
    await closeCallPhases(prisma, attempt.id, plus(385));

    const row = await prisma.callAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(row.callPhase).toBe('wrap_up');
    const history = parsePhaseHistory(row.phaseHistory);
    expect(history?.map((h) => h.phase)).toEqual([
      'dialing',
      'phone_menu',
      'hold',
      'rep_answered',
      'staff_or_agent',
      'wrap_up',
    ]);
    expect(row.menuSeconds).toBe(20);
    expect(row.holdSeconds).toBe(300);
    expect(row.repSeconds).toBe(0);
    expect(row.staffAgentSeconds).toBe(60);
    expect(row.wrapUpSeconds).toBe(0);
  });

  it('skips an illegal late signal instead of rewinding the call', async () => {
    vi.stubEnv('HYBRID_CALL_FLOW', 'true');
    const attempt = await newAttempt();
    await recordCallPhase(prisma, attempt.id, 'rep_answered', { at: plus(10) });
    await recordCallPhase(prisma, attempt.id, 'phone_menu', { at: plus(11) });
    const row = await prisma.callAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(row.callPhase).toBe('rep_answered');
  });

  it('keeps every transition when two writers race on one call', async () => {
    vi.stubEnv('HYBRID_CALL_FLOW', 'true');
    const attempt = await newAttempt();
    await recordCallPhase(prisma, attempt.id, 'hold', { at: plus(1) });
    await Promise.all([
      recordCallPhase(prisma, attempt.id, 'rep_answered', { at: plus(2) }),
      recordCallPhase(prisma, attempt.id, 'rep_answered', { at: plus(2) }),
    ]);
    const row = await prisma.callAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    const phases = parsePhaseHistory(row.phaseHistory)?.map((h) => h.phase) ?? [];
    expect(phases.filter((p) => p === 'rep_answered')).toHaveLength(1);
    expect(phases[0]).toBe('dialing');
  });

  it('resolves the attempt by Vapi call id and ignores an unknown id', async () => {
    vi.stubEnv('HYBRID_CALL_FLOW', 'true');
    const attempt = await newAttempt();
    await recordCallPhaseByVapiId(prisma, attempt.vapiCallId, 'hold', { at: plus(3) });
    await expect(recordCallPhaseByVapiId(prisma, 'vapi-does-not-exist', 'hold')).resolves.toBeUndefined();
    const row = await prisma.callAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(row.callPhase).toBe('hold');
  });

  it('the database rejects an unknown phase or ending', async () => {
    const attempt = await newAttempt();
    await expect(
      prisma.$executeRaw`UPDATE call_attempts SET call_phase = 'bogus' WHERE id = ${attempt.id}`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE call_attempts SET call_ending = 'bogus' WHERE id = ${attempt.id}`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE call_attempts SET hold_seconds = -1 WHERE id = ${attempt.id}`,
    ).rejects.toThrow();
  });

  describe('loadCarrierSegmentMedians', () => {
    it('groups closed calls by carrier and ending, excludes open and old calls, keeps nulls out of medians', async () => {
      const now = new Date();
      const recent = new Date(now.getTime() - 2 * 24 * 3600 * 1000);
      const old = new Date(now.getTime() - 200 * 24 * 3600 * 1000);
      const base = { wrapUpSeconds: 5 };
      const make = async (
        carrierId: CarrierId,
        ending: 'staff' | 'agent',
        initiatedAt: Date,
        fields: { holdSeconds?: number | null; wrapUpSeconds?: number | null },
      ) => {
        const a = await newAttempt({ carrierId, ending, initiatedAt });
        await prisma.callAttempt.update({
          where: { id: a.id },
          data: { holdSeconds: fields.holdSeconds ?? null, wrapUpSeconds: fields.wrapUpSeconds ?? null },
        });
      };
      await make('manulife', 'staff', recent, { ...base, holdSeconds: 100 });
      await make('manulife', 'staff', recent, { ...base, holdSeconds: 300 });
      await make('manulife', 'staff', recent, { ...base, holdSeconds: null });
      await make('manulife', 'staff', recent, { holdSeconds: 9999, wrapUpSeconds: null });
      await make('manulife', 'staff', old, { ...base, holdSeconds: 9999 });
      await make('manulife', 'agent', recent, { ...base, holdSeconds: 50 });

      const report = await loadCarrierSegmentMedians(prisma, 90, now);
      const staff = report.carriers.find((c) => c.carrierId === 'manulife' && c.ending === 'staff');
      const agent = report.carriers.find((c) => c.carrierId === 'manulife' && c.ending === 'agent');
      expect(staff?.calls).toBe(3);
      expect(staff?.segments.hold).toEqual({ observed: 2, medianSeconds: 200 });
      expect(staff?.segments.menu).toEqual({ observed: 0, medianSeconds: null });
      expect(agent?.calls).toBe(1);
      expect(agent?.segments.hold.medianSeconds).toBe(50);
      expect(report.windowDays).toBe(90);
      expect(report.truncated).toBe(false);
    }, 30_000);
  });
});
