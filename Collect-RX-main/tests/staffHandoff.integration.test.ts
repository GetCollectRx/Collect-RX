import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { runWithRlsBypass } from '../src/server/db/rlsContext.js';
import { recordDispatchedCallAttempt } from '../src/server/frontDesk/callAttemptRecording.js';
import {
  HANDOFF_RESULT,
  createPrismaStaffHandoffStore,
  handleStaffHandoff,
  markStaleStaffHandoffsUnknown,
  STALE_HANDOFF_AFTER_MS,
  type StaffHandoffDeps,
} from '../src/webhooks/staffHandoff.js';
import { createPracticeForTests } from './factories/practice.js';

/**
 * Real Prisma against real PostgreSQL. In CI (CI=true) an unreachable database
 * is a hard failure, never a skip: the first test below fails and every other
 * test fails on its first query. Locally, with no database, the suite skips.
 */
let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch {
  // handled by the CI gate test below
}

const inCi = Boolean(process.env.CI);

interface Fixture {
  practiceId: string;
  claimId: string;
  vapiCallId: string;
}

const practiceIds: string[] = [];
const claimIds: string[] = [];

async function createFixture(): Promise<Fixture> {
  const practice = await createPracticeForTests(prisma);
  practiceIds.push(practice.id);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const claim = await prisma.insuranceClaim.create({
    data: {
      practiceId: practice.id,
      carrierId: 'sun_life',
      claimNumber: `SH-${suffix}`,
      patientToken: `token-${suffix}`,
      billedAmount: 100,
      outstandingAmount: 100,
      daysOutstanding: 30,
      status: 'CALLING',
    },
  });
  claimIds.push(claim.id);
  return { practiceId: practice.id, claimId: claim.id, vapiCallId: `vapi-sh-${suffix}` };
}

async function stateOf(vapiCallId: string) {
  return prisma.callAttempt.findUniqueOrThrow({
    where: { vapiCallId },
    select: { staffHandoffState: true, staffHandoffReason: true, staffHandoffAt: true, isHumanAssisted: true },
  });
}

function makeDeps(overrides: Partial<StaffHandoffDeps> = {}) {
  const transfers: Array<{ vapiCallId: string; phone: string }> = [];
  const deps: StaffHandoffDeps = {
    store: createPrismaStaffHandoffStore(prisma),
    findCallAuthorization: async (id) => {
      const row = await runWithRlsBypass(() =>
        prisma.callAttempt.findUnique({
          where: { vapiCallId: id },
          select: { isHumanAssisted: true, claim: { select: { practiceId: true } } },
        }),
      );
      return row ? { isHumanAssisted: row.isHumanAssisted, practiceId: row.claim.practiceId } : null;
    },
    getEscalationPhone: async () => '+14165550100',
    transfer: async (vapiCallId, phone) => {
      // Yield so concurrent invocations genuinely overlap.
      await new Promise((r) => setTimeout(r, 25));
      transfers.push({ vapiCallId, phone });
    },
    isAmbiguousTransferError: (err) => (err as { ambiguous?: boolean })?.ambiguous === true,
    notifyStaff: async () => undefined,
    missedHandoffScript: async () => 'MISSED HANDOFF SCRIPT',
    logError: () => undefined,
    lookupAttempts: 1,
    lookupDelayMs: 0,
    sleep: async () => undefined,
    ...overrides,
  };
  return { deps, transfers };
}

describe.skipIf(!dbReady && !inCi)('staff handoff - real PostgreSQL', () => {
  it('has a reachable database (hard failure in CI)', () => {
    expect(dbReady).toBe(true);
  });

  afterEach(async () => {
    await prisma.callAttempt.deleteMany({ where: { claimId: { in: claimIds.splice(0) } } });
    await prisma.practice.deleteMany({ where: { id: { in: practiceIds.splice(0) } } });
  });

  describe('recordDispatchedCallAttempt', () => {
    it('keeps isHumanAssisted when call.started created the row first', async () => {
      const f = await createFixture();
      // What vapiDeskEvents does on call.started: no isHumanAssisted.
      const early = await prisma.callAttempt.create({
        data: { claimId: f.claimId, vapiCallId: f.vapiCallId, initiatedAt: new Date(), liveState: 'dialing' },
      });
      expect(early.isHumanAssisted).toBe(false);

      const recorded = await recordDispatchedCallAttempt(prisma, {
        claimId: f.claimId,
        vapiCallId: f.vapiCallId,
        isHumanAssisted: true,
      });

      expect(recorded.id).toBe(early.id);
      expect(recorded.isHumanAssisted).toBe(true);
      expect(await prisma.callAttempt.count({ where: { vapiCallId: f.vapiCallId } })).toBe(1);

      const { deps, transfers } = makeDeps();
      const result = await handleStaffHandoff(deps, { vapiCallId: f.vapiCallId, practiceId: f.practiceId });
      expect(result).toBe(HANDOFF_RESULT.INITIATED);
      expect(transfers).toHaveLength(1);
    });

    it('creates the row with the flag when it arrives first, and is idempotent', async () => {
      const f = await createFixture();
      for (let i = 0; i < 2; i++) {
        await recordDispatchedCallAttempt(prisma, {
          claimId: f.claimId,
          vapiCallId: f.vapiCallId,
          isHumanAssisted: true,
        });
      }
      expect(await prisma.callAttempt.count({ where: { vapiCallId: f.vapiCallId } })).toBe(1);
      expect((await stateOf(f.vapiCallId)).isHumanAssisted).toBe(true);
    });

    it('records an autonomous call as not human-assisted', async () => {
      const f = await createFixture();
      await recordDispatchedCallAttempt(prisma, {
        claimId: f.claimId,
        vapiCallId: f.vapiCallId,
        isHumanAssisted: false,
      });
      expect((await stateOf(f.vapiCallId)).isHumanAssisted).toBe(false);
    });

    it('does not throw or duplicate under concurrent recording of one call', async () => {
      const f = await createFixture();
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          recordDispatchedCallAttempt(prisma, {
            claimId: f.claimId,
            vapiCallId: f.vapiCallId,
            isHumanAssisted: true,
          }),
        ),
      );
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0);
      expect(await prisma.callAttempt.count({ where: { vapiCallId: f.vapiCallId } })).toBe(1);
    });
  });

  describe('authorization from the server-side CallAttempt', () => {
    it('refuses an autonomous call: no transfer, no state written', async () => {
      const f = await createFixture();
      await recordDispatchedCallAttempt(prisma, { claimId: f.claimId, vapiCallId: f.vapiCallId, isHumanAssisted: false });
      const { deps, transfers } = makeDeps();

      const result = await handleStaffHandoff(deps, { vapiCallId: f.vapiCallId, practiceId: f.practiceId });

      expect(result).toBe(HANDOFF_RESULT.REFUSED);
      expect(transfers).toHaveLength(0);
      expect((await stateOf(f.vapiCallId)).staffHandoffState).toBeNull();
    });

    it('refuses when no CallAttempt exists for the call', async () => {
      const f = await createFixture();
      const { deps, transfers } = makeDeps();
      const result = await handleStaffHandoff(deps, { vapiCallId: f.vapiCallId, practiceId: f.practiceId });
      expect(result).toBe(HANDOFF_RESULT.REFUSED);
      expect(transfers).toHaveLength(0);
    });

    it('refuses a request that names a different practice than the call belongs to', async () => {
      const owner = await createFixture();
      const other = await createFixture();
      await recordDispatchedCallAttempt(prisma, { claimId: owner.claimId, vapiCallId: owner.vapiCallId, isHumanAssisted: true });
      const { deps, transfers } = makeDeps();

      const result = await handleStaffHandoff(deps, { vapiCallId: owner.vapiCallId, practiceId: other.practiceId });

      expect(result).toBe(HANDOFF_RESULT.REFUSED);
      expect(transfers).toHaveLength(0);
      expect((await stateOf(owner.vapiCallId)).staffHandoffState).toBeNull();
    });

    it('writes no state and does not transfer when the practice has no escalation phone', async () => {
      const f = await createFixture();
      await recordDispatchedCallAttempt(prisma, { claimId: f.claimId, vapiCallId: f.vapiCallId, isHumanAssisted: true });
      const { deps, transfers } = makeDeps({ getEscalationPhone: async () => null });

      const result = await handleStaffHandoff(deps, { vapiCallId: f.vapiCallId, practiceId: f.practiceId });

      expect(result).toBe('MISSED HANDOFF SCRIPT');
      expect(transfers).toHaveLength(0);
      expect((await stateOf(f.vapiCallId)).staffHandoffState).toBeNull();
    });
  });

  describe('atomic claim and idempotency', () => {
    it('performs exactly one transfer across 12 concurrent requests', async () => {
      const f = await createFixture();
      await recordDispatchedCallAttempt(prisma, { claimId: f.claimId, vapiCallId: f.vapiCallId, isHumanAssisted: true });
      const { deps, transfers } = makeDeps();

      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          handleStaffHandoff(deps, { vapiCallId: f.vapiCallId, practiceId: f.practiceId }),
        ),
      );

      expect(transfers).toHaveLength(1);
      expect(results.filter((r) => r === HANDOFF_RESULT.INITIATED)).toHaveLength(1);
      for (const r of results.filter((r) => r !== HANDOFF_RESULT.INITIATED)) {
        expect([HANDOFF_RESULT.ALREADY_INITIATED, HANDOFF_RESULT.UNKNOWN_DO_NOT_RETRY]).toContain(r);
      }
      const row = await stateOf(f.vapiCallId);
      expect(row.staffHandoffState).toBe('PROVIDER_ACCEPTED');
      expect(row.staffHandoffAt).toBeInstanceOf(Date);
    });

    it('does not transfer again after acceptance', async () => {
      const f = await createFixture();
      await recordDispatchedCallAttempt(prisma, { claimId: f.claimId, vapiCallId: f.vapiCallId, isHumanAssisted: true });
      const { deps, transfers } = makeDeps();

      expect(await handleStaffHandoff(deps, { vapiCallId: f.vapiCallId, practiceId: f.practiceId })).toBe(HANDOFF_RESULT.INITIATED);
      expect(await handleStaffHandoff(deps, { vapiCallId: f.vapiCallId, practiceId: f.practiceId })).toBe(HANDOFF_RESULT.ALREADY_INITIATED);
      expect(transfers).toHaveLength(1);
    });
  });

  describe('provider outcomes', () => {
    it('settles OUTCOME_UNKNOWN on an ambiguous response and never retries', async () => {
      const f = await createFixture();
      await recordDispatchedCallAttempt(prisma, { claimId: f.claimId, vapiCallId: f.vapiCallId, isHumanAssisted: true });
      let attempts = 0;
      const { deps } = makeDeps({
        transfer: async () => {
          attempts += 1;
          throw Object.assign(new Error('timeout'), { ambiguous: true });
        },
      });

      expect(await handleStaffHandoff(deps, { vapiCallId: f.vapiCallId, practiceId: f.practiceId })).toBe(HANDOFF_RESULT.UNKNOWN_DO_NOT_RETRY);
      expect(await handleStaffHandoff(deps, { vapiCallId: f.vapiCallId, practiceId: f.practiceId })).toBe(HANDOFF_RESULT.UNKNOWN_DO_NOT_RETRY);

      expect(attempts).toBe(1);
      const row = await stateOf(f.vapiCallId);
      expect(row.staffHandoffState).toBe('OUTCOME_UNKNOWN');
      expect(row.staffHandoffReason).toBe('PROVIDER_OUTCOME_UNKNOWN');
    });

    it('settles FAILED on a definitive rejection and allows one later retry to succeed', async () => {
      const f = await createFixture();
      await recordDispatchedCallAttempt(prisma, { claimId: f.claimId, vapiCallId: f.vapiCallId, isHumanAssisted: true });
      const rejecting = makeDeps({
        transfer: async () => {
          throw new Error('400 bad request');
        },
      });

      expect(await handleStaffHandoff(rejecting.deps, { vapiCallId: f.vapiCallId, practiceId: f.practiceId })).toBe('MISSED HANDOFF SCRIPT');
      const failed = await stateOf(f.vapiCallId);
      expect(failed.staffHandoffState).toBe('FAILED');
      expect(failed.staffHandoffReason).toBe('PROVIDER_REJECTED');

      const working = makeDeps();
      expect(await handleStaffHandoff(working.deps, { vapiCallId: f.vapiCallId, practiceId: f.practiceId })).toBe(HANDOFF_RESULT.INITIATED);
      expect(working.transfers).toHaveLength(1);
      expect((await stateOf(f.vapiCallId)).staffHandoffState).toBe('PROVIDER_ACCEPTED');
    });

    it('keeps the accepted result when staff notification fails afterwards', async () => {
      const f = await createFixture();
      await recordDispatchedCallAttempt(prisma, { claimId: f.claimId, vapiCallId: f.vapiCallId, isHumanAssisted: true });
      const { deps, transfers } = makeDeps({
        notifyStaff: async () => {
          throw new Error('notification down');
        },
      });

      expect(await handleStaffHandoff(deps, { vapiCallId: f.vapiCallId, practiceId: f.practiceId })).toBe(HANDOFF_RESULT.INITIATED);
      expect(transfers).toHaveLength(1);
      expect((await stateOf(f.vapiCallId)).staffHandoffState).toBe('PROVIDER_ACCEPTED');
    });
  });

  describe('stale REQUESTED sweep', () => {
    it('marks only stale REQUESTED rows OUTCOME_UNKNOWN and never re-dials', async () => {
      const stale = await createFixture();
      const fresh = await createFixture();
      const accepted = await createFixture();
      const now = new Date();
      const old = new Date(now.getTime() - STALE_HANDOFF_AFTER_MS - 60_000);
      const recent = new Date(now.getTime() - 60_000);
      for (const f of [stale, fresh, accepted]) {
        await recordDispatchedCallAttempt(prisma, { claimId: f.claimId, vapiCallId: f.vapiCallId, isHumanAssisted: true });
      }
      await prisma.callAttempt.update({ where: { vapiCallId: stale.vapiCallId }, data: { staffHandoffState: 'REQUESTED', staffHandoffAt: old } });
      await prisma.callAttempt.update({ where: { vapiCallId: fresh.vapiCallId }, data: { staffHandoffState: 'REQUESTED', staffHandoffAt: recent } });
      await prisma.callAttempt.update({ where: { vapiCallId: accepted.vapiCallId }, data: { staffHandoffState: 'PROVIDER_ACCEPTED', staffHandoffAt: old } });

      const swept = await markStaleStaffHandoffsUnknown(prisma, now, STALE_HANDOFF_AFTER_MS);

      expect(swept).toBeGreaterThanOrEqual(1);
      const staleRow = await stateOf(stale.vapiCallId);
      expect(staleRow.staffHandoffState).toBe('OUTCOME_UNKNOWN');
      expect(staleRow.staffHandoffReason).toBe('STALE_REQUESTED_NO_SETTLEMENT');
      expect((await stateOf(fresh.vapiCallId)).staffHandoffState).toBe('REQUESTED');
      expect((await stateOf(accepted.vapiCallId)).staffHandoffState).toBe('PROVIDER_ACCEPTED');

      // A swept row is never re-dialed by a later request.
      const { deps, transfers } = makeDeps();
      expect(await handleStaffHandoff(deps, { vapiCallId: stale.vapiCallId, practiceId: stale.practiceId })).toBe(HANDOFF_RESULT.UNKNOWN_DO_NOT_RETRY);
      expect(transfers).toHaveLength(0);
    });
  });
});

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});
