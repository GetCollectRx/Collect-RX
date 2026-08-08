/**
 * End-to-end workflow: the safety-critical rules that gate every carrier dial
 * (src/carriers/adapter.ts `validateDispatch`) — CARRIER_BLOCK, claim-age gating,
 * max attempts, and the Mon–Fri 08:00–17:00 Eastern call window.
 *
 * `scheduledFor` is always passed explicitly (never the real "now") so these tests
 * are deterministic regardless of when/where they run. 2026-04-14 is a Tuesday and
 * 2026-04-18 is a Saturday (verified against America/New_York via Intl.DateTimeFormat).
 *
 * DB-dependent — this suite gates the most safety-critical rules in the codebase (CARRIER_BLOCK,
 * claim-age gating, max attempts, call-window enforcement), so it must NEVER silently no-op. If
 * DATABASE_URL is unreachable, this file throws instead of skipping — see the top-level `await`
 * below — so CI fails loud rather than reporting a false "0 failures" pass.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CarrierId } from '@prisma/client';
import { prisma } from '../src/server/index.js';
import { createPracticeForTests } from './factories/practice.js';
import { validateDispatch } from '../src/carriers/adapter.js';
import { applyCarrierBlock, clearCarrierBlock } from '../src/server/frontDesk/carrierBlockService.js';
import { defaultPracticeSettings, updatePracticeSettings } from '../src/server/services/practiceSettingsService.js';

try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
} catch (e) {
  throw new Error(
    'workflowDispatchSafetyRules requires a live DATABASE_URL — this safety-critical suite ' +
      '(CARRIER_BLOCK, claim-age gating, max-attempts, call-window enforcement) must not ' +
      `silently skip. Original error: ${(e as Error).message}`,
  );
}

// All fixed to Eastern time, verified: Tue 10:00 (in-window), Sat 10:00 (weekend),
// Tue 05:00 (before window), Tue 19:00 (after window).
const TUESDAY_10AM_ET = new Date('2026-04-14T14:00:00Z');
const SATURDAY_10AM_ET = new Date('2026-04-18T14:00:00Z');
const TUESDAY_5AM_ET = new Date('2026-04-14T09:00:00Z');
const TUESDAY_7PM_ET = new Date('2026-04-14T23:00:00Z');

describe('Safety-critical dispatch gating — validateDispatch()', () => {
  let practiceId: string;
  let sunLifeClaimId: string;
  let canadaLifeClaimId: string;
  let telusClaimId: string;

  beforeAll(async () => {
    const practice = await createPracticeForTests(prisma);
    practiceId = practice.id;

    // Authorize sun_life, canada_life, and telus_adjudicare (BAAL + provider number) so
    // the authorization gate doesn't shadow the rules under test.
    const settings = defaultPracticeSettings();
    settings.voiceAgentEnabled = true;
    const authorized: CarrierId[] = ['sun_life', 'canada_life', 'telus_adjudicare'];
    settings.carrierConfigs = settings.carrierConfigs.map((c) =>
      authorized.includes(c.carrierId)
        ? { ...c, authorizationSubmitted: true, providerNumber: 'PN-TEST-001' }
        : c,
    );
    await updatePracticeSettings(prisma, practiceId, settings);

    const claim = await prisma.insuranceClaim.create({
      data: {
        practiceId,
        carrierId: 'sun_life',
        claimNumber: 'CLM-GATE-SUN',
        patientToken: 'tok-gate-sun',
        billedAmount: 500,
        outstandingAmount: 500,
        daysOutstanding: 45,
        status: 'PENDING',
      },
    });
    sunLifeClaimId = claim.id;

    const claimCl = await prisma.insuranceClaim.create({
      data: {
        practiceId,
        carrierId: 'canada_life',
        claimNumber: 'CLM-GATE-CL',
        patientToken: 'tok-gate-cl',
        billedAmount: 500,
        outstandingAmount: 500,
        daysOutstanding: 45,
        status: 'PENDING',
      },
    });
    canadaLifeClaimId = claimCl.id;

    const claimTelus = await prisma.insuranceClaim.create({
      data: {
        practiceId,
        carrierId: 'telus_adjudicare',
        claimNumber: 'CLM-GATE-TELUS',
        patientToken: 'tok-gate-telus',
        billedAmount: 500,
        outstandingAmount: 500,
        daysOutstanding: 25,
        status: 'PENDING',
      },
    });
    telusClaimId = claimTelus.id;
  }, 30_000);

  afterAll(async () => {
    await prisma.carrierBlockEvent.deleteMany({ where: { practiceId } });
    await prisma.callAttempt.deleteMany({ where: { claim: { practiceId } } });
    await prisma.insuranceClaim.deleteMany({ where: { practiceId } });
    await prisma.practice.delete({ where: { id: practiceId } }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  });

  it('allows dispatch when every rule is satisfied (happy path)', async () => {
    const result = await validateDispatch(prisma, {
      practiceId,
      claimId: sunLifeClaimId,
      carrierId: 'sun_life',
      daysOutstanding: 45,
      attemptsSoFar: 0,
      scheduledFor: TUESDAY_10AM_ET,
      claimStatus: 'PENDING',
    });
    expect(result.allowed).toBe(true);
  });

  it('rejects a claim under the carrier minimum days outstanding — too early to call', async () => {
    const result = await validateDispatch(prisma, {
      practiceId,
      claimId: sunLifeClaimId,
      carrierId: 'sun_life',
      daysOutstanding: 15,
      attemptsSoFar: 0,
      scheduledFor: TUESDAY_10AM_ET,
      claimStatus: 'PENDING',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/32 days/);
  });

  it('rejects a claim over 90 days outstanding — escalate to a human instead of the AI', async () => {
    const result = await validateDispatch(prisma, {
      practiceId,
      claimId: sunLifeClaimId,
      carrierId: 'sun_life',
      daysOutstanding: 95,
      attemptsSoFar: 0,
      scheduledFor: TUESDAY_10AM_ET,
      claimStatus: 'PENDING',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/escalate to human/);
  });

  it('rejects once the 3-attempt cap has been reached', async () => {
    const result = await validateDispatch(prisma, {
      practiceId,
      claimId: sunLifeClaimId,
      carrierId: 'sun_life',
      daysOutstanding: 45,
      attemptsSoFar: 3,
      scheduledFor: TUESDAY_10AM_ET,
      claimStatus: 'PENDING',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Maximum 3 call attempts/);
  });

  it('rejects a call scheduled on a weekend', async () => {
    const result = await validateDispatch(prisma, {
      practiceId,
      claimId: sunLifeClaimId,
      carrierId: 'sun_life',
      daysOutstanding: 45,
      attemptsSoFar: 0,
      scheduledFor: SATURDAY_10AM_ET,
      claimStatus: 'PENDING',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Mon–Fri/);
  });

  it('rejects a call scheduled before 08:00 Eastern', async () => {
    const result = await validateDispatch(prisma, {
      practiceId,
      claimId: sunLifeClaimId,
      carrierId: 'sun_life',
      daysOutstanding: 45,
      attemptsSoFar: 0,
      scheduledFor: TUESDAY_5AM_ET,
      claimStatus: 'PENDING',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/08:00–17:00/);
  });

  it('rejects a call scheduled after 17:00 Eastern', async () => {
    const result = await validateDispatch(prisma, {
      practiceId,
      claimId: sunLifeClaimId,
      carrierId: 'sun_life',
      daysOutstanding: 45,
      attemptsSoFar: 0,
      scheduledFor: TUESDAY_7PM_ET,
      claimStatus: 'PENDING',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/08:00–17:00/);
  });

  it(
    'CARRIER_BLOCK: a detected block immediately suspends ALL calls to that carrier, and clearing it restores dispatch',
    async () => {
      const before = await validateDispatch(prisma, {
        practiceId,
        claimId: canadaLifeClaimId,
        carrierId: 'canada_life',
        daysOutstanding: 45,
        attemptsSoFar: 0,
        scheduledFor: TUESDAY_10AM_ET,
        claimStatus: 'PENDING',
      });
      expect(before.allowed).toBe(true);

      // hangVapi: false — this is a unit-scoped test with no live Vapi call to hang up.
      await applyCarrierBlock(prisma, {
        practiceId,
        carrierId: 'canada_life',
        vapiCallId: 'vapi-test-call-id',
        reason: 'IVR detected automation and hung up',
        hangVapi: false,
      });

      const blocked = await validateDispatch(prisma, {
        practiceId,
        claimId: canadaLifeClaimId,
        carrierId: 'canada_life',
        daysOutstanding: 45,
        attemptsSoFar: 0,
        scheduledFor: TUESDAY_10AM_ET,
        claimStatus: 'PENDING',
      });
      expect(blocked.allowed).toBe(false);
      expect(blocked.reason).toMatch(/CARRIER_BLOCK active/);

      const claimAfterBlock = await prisma.insuranceClaim.findUnique({
        where: { id: canadaLifeClaimId },
      });
      expect(claimAfterBlock?.status).toBe('BLOCKED');

      const cleared = await clearCarrierBlock(
        prisma,
        practiceId,
        'canada_life',
        'staff-e2e-test',
        'False alarm — resumed after review',
      );
      expect(cleared).toBe(true);

      const afterClear = await validateDispatch(prisma, {
        practiceId,
        claimId: canadaLifeClaimId,
        carrierId: 'canada_life',
        daysOutstanding: 45,
        attemptsSoFar: 0,
        scheduledFor: TUESDAY_10AM_ET,
        claimStatus: 'PENDING',
      });
      expect(afterClear.allowed).toBe(true);
    },
    30_000,
  );

  it('a claim already APPROVED_PENDING_PAYMENT is never re-dialed to the carrier', async () => {
    const result = await validateDispatch(prisma, {
      practiceId,
      claimId: sunLifeClaimId,
      carrierId: 'sun_life',
      daysOutstanding: 45,
      attemptsSoFar: 0,
      scheduledFor: TUESDAY_10AM_ET,
      claimStatus: 'APPROVED_PENDING_PAYMENT',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/practice AR, not another carrier call/);
  });

  it('TELUS claims dispatch at day 21, per CARRIER_CONFIGS\' TELUS-specific minimum', async () => {
    // validateDispatch now gates on config.minWaitDays per carrier instead of a
    // hardcoded global floor, so a 25-day-old TELUS claim clears TELUS's 21-day
    // minimum even though it would still be too young for every other carrier.
    const result = await validateDispatch(prisma, {
      practiceId,
      claimId: telusClaimId,
      carrierId: 'telus_adjudicare',
      daysOutstanding: 25,
      attemptsSoFar: 0,
      scheduledFor: TUESDAY_10AM_ET,
      claimStatus: 'PENDING',
    });
    expect(result.allowed).toBe(true);
  });

  it('rejects a TELUS claim under the TELUS-specific 21-day minimum', async () => {
    const result = await validateDispatch(prisma, {
      practiceId,
      claimId: telusClaimId,
      carrierId: 'telus_adjudicare',
      daysOutstanding: 15,
      attemptsSoFar: 0,
      scheduledFor: TUESDAY_10AM_ET,
      claimStatus: 'PENDING',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/TELUS AdjudiCare requires minimum 21 days/);
  });

  it('rejects a standard (non-TELUS) claim at day 30 — under this carrier\'s 32-day minimum', async () => {
    const result = await validateDispatch(prisma, {
      practiceId,
      claimId: sunLifeClaimId,
      carrierId: 'sun_life',
      daysOutstanding: 30,
      attemptsSoFar: 0,
      scheduledFor: TUESDAY_10AM_ET,
      claimStatus: 'PENDING',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Sun Life Financial requires minimum 32 days/);
  });

  it('allows a standard (non-TELUS) claim at exactly its 32-day minimum', async () => {
    const result = await validateDispatch(prisma, {
      practiceId,
      claimId: sunLifeClaimId,
      carrierId: 'sun_life',
      daysOutstanding: 32,
      attemptsSoFar: 0,
      scheduledFor: TUESDAY_10AM_ET,
      claimStatus: 'PENDING',
    });
    expect(result.allowed).toBe(true);
  });
});
