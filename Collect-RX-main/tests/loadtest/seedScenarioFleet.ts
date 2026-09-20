// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Scenario Fleet Seeder (load-test only)
//
// Builds a realistic ~50-practice fleet for tests/loadtest/queueEngine.scale.test.ts:
// mostly standalone practices, plus a few multi-location Organizations (the
// shape that actually stresses CARRIER_BLOCK's sibling-lookup and the
// per-carrier concurrency ceiling — a single-practice pilot never surfaces
// either). Not a general-purpose seed script; lives under tests/ because it
// creates and tears down real rows in the local test database, same as
// tests/factories/practice.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { CarrierId, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { FIXTURE_PRACTICE_PASSWORD } from '../factories/practice.js';
import { defaultPracticeSettings, updatePracticeSettings } from '../../src/server/services/practiceSettingsService.js';
import { piiVault, type PatientPHI } from '../../src/pii-vault.js';

/** Synthetic but complete PHI — real piiVault tokens so dispatch's PHI-resolution
 * guard actually passes, instead of every claim deferring on a fake string that
 * was never registered with the vault. Values are fixture data, not real patients. */
function fixturePhi(seed: string): PatientPHI {
  return {
    patientName: `LoadTest Patient ${seed}`,
    dateOfBirth: '1980-01-01',
    subscriberId: `SUB-${seed}`,
    groupPolicyNumber: `GRP-${seed}`,
  };
}

// Skewed toward 2 dominant carriers — the exact concentration a real
// multi-location group creates, and the scenario CARRIER_CONCURRENCY_LIMITS
// exists to protect against.
const CARRIER_WEIGHTS: Array<{ carrierId: CarrierId; weight: number }> = [
  { carrierId: 'sun_life', weight: 35 },
  { carrierId: 'canada_life', weight: 25 },
  { carrierId: 'manulife', weight: 15 },
  { carrierId: 'green_shield', weight: 10 },
  { carrierId: 'rbc', weight: 10 },
  { carrierId: 'telus_adjudicare', weight: 5 },
];

function pickCarrier(rand: () => number): CarrierId {
  const total = CARRIER_WEIGHTS.reduce((sum, c) => sum + c.weight, 0);
  let roll = rand() * total;
  for (const c of CARRIER_WEIGHTS) {
    roll -= c.weight;
    if (roll <= 0) return c.carrierId;
  }
  return CARRIER_WEIGHTS[0].carrierId;
}

// Deterministic PRNG so a failing run is reproducible — Math.random() would
// make "why did this fail" a fresh mystery every re-run.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type ScenarioFleet = {
  standalonePracticeIds: string[];
  sixLocationOrgId: string;
  sixLocationPracticeIds: string[];
  smallOrgIds: string[];
  smallOrgPracticeIds: string[][];
  blockedPracticeId: string; // one of sixLocationPracticeIds — pre-seeded CarrierBlockEvent
  blockedCarrierId: CarrierId;
  cogsThrottledPracticeId: string; // standalone, seeded near the throttle threshold
  cogsPausedPracticeId: string; // standalone, seeded past the pause threshold
  edgeCasePracticeIds: string[]; // empty backlog, and an all-too-young backlog
  allPracticeIds: string[];
};

/** Fully authorized: voice agent on, every carrier enabled with BAAL + provider number.
 * Without this, checkCarrierAuthorizationGate rejects every dispatch with VOICE_AGENT_DISABLED
 * — a practice-wide "stop" code that (correctly, by design) never records a per-entry deferral
 * reason, which is indistinguishable from real starvation unless the fixture is set up right. */
async function createFixturePractice(
  prisma: PrismaClient,
  name: string,
  billingTier: 'core' | 'growth' | 'scale' = 'core',
): Promise<string> {
  const passwordHash = await bcrypt.hash(FIXTURE_PRACTICE_PASSWORD, 4);
  const practice = await prisma.practice.create({
    data: {
      name,
      timezone: 'America/Toronto',
      passwordHash,
      billingTier,
      subscriptionStatus: 'active',
    },
  });

  const settings = defaultPracticeSettings();
  settings.voiceAgentEnabled = true;
  settings.carrierConfigs = settings.carrierConfigs.map((c) => ({
    ...c,
    authorizationSubmitted: true,
    providerNumber: `PN-LOADTEST-${practice.id.slice(0, 8)}`,
  }));
  await updatePracticeSettings(prisma, practice.id, settings);

  return practice.id;
}

async function seedClaimsForPractice(
  prisma: PrismaClient,
  practiceId: string,
  claimCount: number,
  rand: () => number,
): Promise<void> {
  const claimsData = Array.from({ length: claimCount }, (_, i) => {
    // Spread across every dispatch-guard branch: <30 (must not queue),
    // 30-90 (normal), >90 (must escalate).
    const ageBucket = rand();
    const daysOutstanding = ageBucket < 0.15 ? Math.floor(rand() * 25) + 1
      : ageBucket < 0.9 ? Math.floor(rand() * 60) + 30
      : Math.floor(rand() * 60) + 91;
    const tag = `${practiceId.slice(0, 8)}-${i}`;
    return {
      id: `${practiceId}-claim-${i}`,
      practiceId,
      carrierId: pickCarrier(rand),
      claimNumber: `LT-${practiceId.slice(0, 8)}-${i}`,
      patientToken: piiVault.tokenize(fixturePhi(tag), 'loadtest-seed', practiceId),
      billedAmount: 250 + Math.floor(rand() * 2000),
      outstandingAmount: 250 + Math.floor(rand() * 2000),
      daysOutstanding,
      status: 'IN_QUEUE' as const,
      priority: (rand() < 0.1 ? 'HIGH' : 'NORMAL') as 'HIGH' | 'NORMAL',
    };
  });

  await prisma.insuranceClaim.createMany({ data: claimsData });

  const queueData = claimsData
    .filter((c) => c.daysOutstanding >= 30 && c.daysOutstanding <= 90) // only realistically-dispatchable claims need a queue entry
    .map((c) => ({
      practiceId,
      claimId: c.id,
      scheduledFor: new Date(Date.now() - 60_000), // already due
      priority: c.priority,
      attempts: rand() < 0.1 ? 3 : 0, // a few already at MAX_ATTEMPTS
      status: 'PENDING' as const,
    }));

  if (queueData.length > 0) {
    await prisma.callQueue.createMany({ data: queueData });
  }
}

/**
 * Guarantees exactly one dispatchable claim for a specific carrier, deterministically
 * — the random carrier weighting makes CARRIER_BLOCK propagation checks probabilistic
 * otherwise (a sibling with zero claims for the blocked carrier makes a "not blocked"
 * assertion vacuously true, not a real check).
 */
async function seedGuaranteedCarrierClaim(
  prisma: PrismaClient,
  practiceId: string,
  carrierId: CarrierId,
  tag: string,
): Promise<void> {
  const claimId = `${practiceId}-guaranteed-${tag}`;
  await prisma.insuranceClaim.create({
    data: {
      id: claimId,
      practiceId,
      carrierId,
      claimNumber: `LT-${practiceId.slice(0, 8)}-guaranteed-${tag}`,
      patientToken: piiVault.tokenize(fixturePhi(`${practiceId.slice(0, 8)}-guaranteed-${tag}`), 'loadtest-seed', practiceId),
      billedAmount: 500,
      outstandingAmount: 500,
      daysOutstanding: 45,
      status: 'IN_QUEUE',
      priority: 'NORMAL',
    },
  });
  await prisma.callQueue.create({
    data: {
      practiceId,
      claimId,
      scheduledFor: new Date(Date.now() - 60_000),
      priority: 'NORMAL',
      status: 'PENDING',
    },
  });
}

/**
 * Seed a confirmed-overage UsagePeriod landing the practice at a specific
 * fraction of revenue-collected-so-far in delivery cost — for COGS breaker
 * isolation testing. evaluateCogsBreaker only runs at all once minutesConsumed
 * passes includedMinutes AND overageConfirmed is true (see
 * usagePeriodService.ts) — in-plan usage can never reach even the throttle
 * threshold by design (100% of included minutes only costs ~20% of price on
 * every tier), so these fixtures must live in the overage zone, not below it.
 */
async function seedUsageAtCogsFraction(
  prisma: PrismaClient,
  practiceId: string,
  tier: { price: number; includedMinutes: number; overageRatePerMinute: number | null },
  costPerMinute: number,
  fractionOfRevenue: number,
): Promise<void> {
  const overageRate = tier.overageRatePerMinute ?? 0;
  const numerator = fractionOfRevenue * (tier.price - overageRate * tier.includedMinutes);
  const denominator = costPerMinute - fractionOfRevenue * overageRate;
  if (denominator <= 0) {
    throw new Error(
      `fractionOfRevenue=${fractionOfRevenue} is unreachable for this tier's overage margin (cost/revenue asymptote is ${(costPerMinute / overageRate * 100).toFixed(1)}%) — pick a tier with a thinner overage margin`,
    );
  }
  const minutesConsumed = Math.ceil(numerator / denominator) + 5;

  const now = new Date();
  await prisma.usagePeriod.create({
    data: {
      practiceId,
      periodStart: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
      periodEnd: new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000),
      minutesConsumed,
    },
  });
  await prisma.practice.update({
    where: { id: practiceId },
    data: { overageConfirmed: true, overageConfirmedAt: now },
  });
}

export async function seedScenarioFleet(
  prisma: PrismaClient,
  opts: { standaloneCount?: number; seed?: number } = {},
): Promise<ScenarioFleet> {
  const rand = mulberry32(opts.seed ?? 42);
  const standaloneCount = opts.standaloneCount ?? 44;
  const runTag = Date.now();

  // ── Standalone practices ────────────────────────────────────────────────
  const standalonePracticeIds: string[] = [];
  for (let i = 0; i < standaloneCount; i++) {
    const id = await createFixturePractice(prisma, `LoadTest Standalone ${runTag}-${i}`);
    standalonePracticeIds.push(id);
    await seedClaimsForPractice(prisma, id, 20 + Math.floor(rand() * 80), rand);
    if (i < 3) {
      // A few standalones (no Organization membership at all) with a
      // guaranteed sun_life claim — the strongest version of "does
      // propagation over-reach" check, since these share nothing with the
      // blocked practice's org structure.
      await seedGuaranteedCarrierClaim(prisma, id, 'sun_life', 'unrelated-standalone');
    }
  }

  // ── One 6-location org (mirrors the 7Dental shape) ──────────────────────
  const sixLocationOrg = await prisma.organization.create({
    data: { name: `LoadTest 6-Location Group ${runTag}` },
  });
  const sixLocationPracticeIds: string[] = [];
  for (let i = 0; i < 6; i++) {
    const id = await createFixturePractice(prisma, `LoadTest 6-Loc ${runTag}-${i}`, 'growth');
    sixLocationPracticeIds.push(id);
    await prisma.organizationPractice.create({
      data: { organizationId: sixLocationOrg.id, practiceId: id },
    });
    await seedClaimsForPractice(prisma, id, 50 + Math.floor(rand() * 50), rand);
    // Every sibling gets a guaranteed sun_life claim — the org-propagation
    // check needs a real claim to confirm gets BLOCKED, not an absence of one.
    await seedGuaranteedCarrierClaim(prisma, id, 'sun_life', 'org-propagation');
  }

  // ── 2 smaller orgs (2-3 locations each) — org-propagation must not assume exactly one multi-location org exists ──
  const smallOrgIds: string[] = [];
  const smallOrgPracticeIds: string[][] = [];
  for (const locationCount of [2, 3]) {
    const org = await prisma.organization.create({
      data: { name: `LoadTest ${locationCount}-Location Group ${runTag}` },
    });
    smallOrgIds.push(org.id);
    const practiceIds: string[] = [];
    for (let i = 0; i < locationCount; i++) {
      const id = await createFixturePractice(prisma, `LoadTest ${locationCount}-Loc ${runTag}-${i}`);
      practiceIds.push(id);
      await prisma.organizationPractice.create({ data: { organizationId: org.id, practiceId: id } });
      await seedClaimsForPractice(prisma, id, 20 + Math.floor(rand() * 40), rand);
      // Also has a sun_life claim, but is NOT in the 6-location org — must
      // stay dispatchable after the block lands there. Without this, the
      // "propagation doesn't over-block unrelated orgs" check would have
      // nothing real to verify.
      await seedGuaranteedCarrierClaim(prisma, id, 'sun_life', 'unrelated-org');
    }
    smallOrgPracticeIds.push(practiceIds);
  }

  // ── Pre-seeded CarrierBlockEvent on one of the 6-location org's practices ──
  const blockedPracticeId = sixLocationPracticeIds[0];
  const blockedCarrierId: CarrierId = 'sun_life';
  await prisma.carrierBlockEvent.create({
    data: {
      practiceId: blockedPracticeId,
      carrierId: blockedCarrierId,
      notes: 'Load-test fixture — pre-seeded block to verify org-wide propagation',
    },
  });

  // ── COGS throttle/pause fixtures (standalone, isolated from siblings) ────
  // Import lazily to avoid a hard dependency on tiers.ts's export shape at
  // module-load time in case this file is ever imported before tiers.ts.
  // Scale tier specifically: its overage margin (rate 0.20 vs cost 0.135)
  // keeps the cost/revenue asymptote at 67.5%, above both the 40% throttle
  // and 60% pause thresholds, so both are reachable at a finite minute
  // count — Core's margin asymptotes at 54%, below the pause threshold, so
  // pause is structurally unreachable there no matter the minutes consumed.
  const { TIERS, UNIT_ECONOMICS, COGS_BREAKER } = await import('../../src/billing/tiers.js');
  const cogsThrottledPracticeId = await createFixturePractice(prisma, `LoadTest COGS-Throttled ${runTag}`, 'scale');
  await seedClaimsForPractice(prisma, cogsThrottledPracticeId, 30, rand);
  await seedUsageAtCogsFraction(
    prisma,
    cogsThrottledPracticeId,
    TIERS.scale,
    UNIT_ECONOMICS.costPerMinute,
    COGS_BREAKER.throttleAtPctOfPrice + 0.02,
  );

  const cogsPausedPracticeId = await createFixturePractice(prisma, `LoadTest COGS-Paused ${runTag}`, 'scale');
  await seedClaimsForPractice(prisma, cogsPausedPracticeId, 30, rand);
  await seedUsageAtCogsFraction(
    prisma,
    cogsPausedPracticeId,
    TIERS.scale,
    UNIT_ECONOMICS.costPerMinute,
    COGS_BREAKER.pauseAtPctOfPrice + 0.02,
  );

  // ── Edge-case practices: empty backlog, and a backlog that's entirely
  // too-young to dispatch. Cheap to seed, and a practice with zero
  // candidates or zero *eligible* candidates is exactly the kind of input
  // that silently breaks a loop written assuming "there's always something
  // to do here." (Deliberately not a "throws an exception" fixture — that
  // property is already covered at small scale by
  // tests/frontDesk/queueEngine.dispatch.test.ts's "continues to the next
  // practice when one practice tick throws"; fabricating a realistic
  // exception at fleet scale added complexity without adding coverage.)
  const edgeCasePracticeIds: string[] = [];
  const emptyPracticeId = await createFixturePractice(prisma, `LoadTest Empty ${runTag}`);
  edgeCasePracticeIds.push(emptyPracticeId); // zero claims, zero queue entries

  const allTooYoungPracticeId = await createFixturePractice(prisma, `LoadTest AllTooYoung ${runTag}`);
  edgeCasePracticeIds.push(allTooYoungPracticeId);
  await prisma.insuranceClaim.createMany({
    data: Array.from({ length: 5 }, (_, i) => ({
      id: `${allTooYoungPracticeId}-claim-${i}`,
      practiceId: allTooYoungPracticeId,
      carrierId: pickCarrier(rand),
      claimNumber: `LT-${allTooYoungPracticeId.slice(0, 8)}-${i}`,
      patientToken: `tok-lt-${allTooYoungPracticeId.slice(0, 8)}-${i}`,
      billedAmount: 500,
      outstandingAmount: 500,
      daysOutstanding: 5, // under the 30-day floor — must never enter the queue
      status: 'PENDING' as const,
    })),
  });

  const allPracticeIds = [
    ...standalonePracticeIds,
    ...sixLocationPracticeIds,
    ...smallOrgPracticeIds.flat(),
    cogsThrottledPracticeId,
    cogsPausedPracticeId,
    ...edgeCasePracticeIds,
  ];

  return {
    standalonePracticeIds,
    sixLocationOrgId: sixLocationOrg.id,
    sixLocationPracticeIds,
    smallOrgIds,
    smallOrgPracticeIds,
    blockedPracticeId,
    blockedCarrierId,
    cogsThrottledPracticeId,
    cogsPausedPracticeId,
    edgeCasePracticeIds,
    allPracticeIds,
  };
}

export async function teardownScenarioFleet(prisma: PrismaClient, fleet: ScenarioFleet): Promise<void> {
  const orgIds = [fleet.sixLocationOrgId, ...fleet.smallOrgIds];
  await prisma.organizationPractice.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.carrierBlockEvent.deleteMany({ where: { practiceId: { in: fleet.allPracticeIds } } });
  await prisma.usagePeriod.deleteMany({ where: { practiceId: { in: fleet.allPracticeIds } } });
  await prisma.callQueue.deleteMany({ where: { practiceId: { in: fleet.allPracticeIds } } });
  await prisma.callAttempt.deleteMany({ where: { claim: { practiceId: { in: fleet.allPracticeIds } } } });
  await prisma.insuranceClaim.deleteMany({ where: { practiceId: { in: fleet.allPracticeIds } } });
  await prisma.practice.deleteMany({ where: { id: { in: fleet.allPracticeIds } } });
}
