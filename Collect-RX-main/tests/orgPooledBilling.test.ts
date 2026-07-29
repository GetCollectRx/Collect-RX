/**
 * Org-level pooled billing (DSO/enterprise deals — "charge the parent
 * company"): evaluateCallGate must sum minutesConsumed across every member
 * practice and gate on the ORG's tier, not any single practice's own usage.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { evaluateCallGate } from '../src/server/plans/usagePeriodService.js';
import { resolveBillingEntity } from '../src/server/stripe/billingEntity.js';

const ORG_ID = 'org-1';
const PRACTICE_A = 'practice-a';
const PRACTICE_B = 'practice-b';

function orgRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: ORG_ID,
    stripeCustomerId: 'cus_org_1',
    stripeSubscriptionId: 'sub_org_1',
    subscriptionStatus: 'active',
    billingTier: 'scale',
    cogsPoolingEnabled: true,
    callsPaused: false,
    callsPausedReason: null,
    callsPausedAt: null,
    overageConfirmed: false,
    overageConfirmedAt: null,
    subscriptionCurrentPeriodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    billingPeriodStart: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

/** minutesByPractice: per-practice current-cycle minutesConsumed used to prove pooling sums across practices. */
function orgPrisma(minutesByPractice: Record<string, number>, orgOverrides: Record<string, unknown> = {}) {
  const pauseOrgSpy = vi.fn(async () => ({ count: 1 }));
  const org = orgRecord(orgOverrides);
  const prisma = {
    practice: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => ({ id: args.where.id })),
    },
    organizationPractice: {
      findFirst: vi.fn(async () => ({ organizationId: ORG_ID })),
      findMany: vi.fn(async () => Object.keys(minutesByPractice).map((practiceId) => ({ practiceId }))),
    },
    organization: {
      findUnique: vi.fn(async () => org),
      updateMany: pauseOrgSpy,
    },
    usagePeriod: {
      findFirst: vi.fn(async (args: { where: { practiceId: string } }) => ({
        id: `usage-${args.where.practiceId}`,
        practiceId: args.where.practiceId,
        periodStart: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        periodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        minutesConsumed: minutesByPractice[args.where.practiceId] ?? 0,
        callsCompleted: 1,
        warning80Sent: true,
      })),
    },
    callAttempt: {
      aggregate: vi.fn(async () => ({ _sum: { minutesBilled: 0 } })),
    },
  } as unknown as PrismaClient;
  return { prisma, pauseOrgSpy };
}

describe('resolveBillingEntity', () => {
  it('falls back to practice billing when the practice has no org', async () => {
    const prisma = {
      organizationPractice: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaClient;
    const entity = await resolveBillingEntity(prisma, PRACTICE_A);
    expect(entity).toEqual({ kind: 'practice', practiceId: PRACTICE_A });
  });

  it('falls back to practice billing when the org exists but has never checked out (no Stripe customer)', async () => {
    const prisma = {
      organizationPractice: { findFirst: vi.fn(async () => ({ organizationId: ORG_ID })) },
      organization: { findUnique: vi.fn(async () => ({ id: ORG_ID, stripeCustomerId: null })) },
    } as unknown as PrismaClient;
    const entity = await resolveBillingEntity(prisma, PRACTICE_A);
    expect(entity).toEqual({ kind: 'practice', practiceId: PRACTICE_A });
  });

  it('resolves to the organization once it has a Stripe customer, listing every member practice', async () => {
    const { prisma } = orgPrisma({ [PRACTICE_A]: 0, [PRACTICE_B]: 0 });
    const entity = await resolveBillingEntity(prisma, PRACTICE_A);
    expect(entity.kind).toBe('organization');
    if (entity.kind === 'organization') {
      expect(entity.organizationId).toBe(ORG_ID);
      expect(entity.memberPracticeIds.sort()).toEqual([PRACTICE_A, PRACTICE_B]);
    }
  });
});

describe('evaluateCallGate — org-pooled minutes (scale tier, includedMinutes=4000)', () => {
  it('allows dispatch when pooled minutes stay under the org tier allowance, even though this is only one of two practices', async () => {
    const { prisma } = orgPrisma({ [PRACTICE_A]: 1500, [PRACTICE_B]: 1500 });
    const gate = await evaluateCallGate(prisma, PRACTICE_A);
    expect(gate.allowed).toBe(true);
  });

  it('pools minutes across BOTH practices — pauses once the sum crosses the org allowance, even though neither practice alone is close', async () => {
    // 2400 + 2400 = 4800 > 4000 included, but each individual practice (2400) is nowhere close.
    const { prisma, pauseOrgSpy } = orgPrisma({ [PRACTICE_A]: 2400, [PRACTICE_B]: 2400 });
    const gate = await evaluateCallGate(prisma, PRACTICE_A);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('OVERAGE_PENDING');
    expect(pauseOrgSpy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: ORG_ID }) }),
    );
  });

  it('a practice whose OWN usage is tiny is still blocked once its org sibling exhausts the pool', async () => {
    const { prisma } = orgPrisma({ [PRACTICE_A]: 50, [PRACTICE_B]: 4200 });
    const gate = await evaluateCallGate(prisma, PRACTICE_A);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('OVERAGE_PENDING');
  });

  it('does not pool when cogsPoolingEnabled is false — falls back to practice-level gating', async () => {
    const { prisma } = orgPrisma({ [PRACTICE_A]: 100, [PRACTICE_B]: 100 }, { cogsPoolingEnabled: false });
    // With pooling off, evaluateCallGate falls through to the practice-level
    // path, which needs its own Practice fields (not just { id }).
    (prisma.practice.findUnique as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      id: PRACTICE_A,
      billingTier: 'trial',
      subscriptionStatus: null,
      trialEndsAt: null,
      callsPaused: false,
      callsPausedReason: null,
      callsPausedAt: null,
      overageConfirmed: false,
      overageConfirmedAt: null,
      subscriptionCurrentPeriodEnd: null,
      billingPeriodStart: null,
    }));
    const gate = await evaluateCallGate(prisma, PRACTICE_A);
    // Practice-level trial gate with 100 minutes consumed, well under trial's cap — allowed.
    expect(gate.allowed).toBe(true);
  });

  it('BILLING_MISCONFIGURED when the org has a Stripe customer but no billingTier yet (checkout started, webhook not landed)', async () => {
    const { prisma } = orgPrisma({ [PRACTICE_A]: 0, [PRACTICE_B]: 0 }, { billingTier: null });
    const gate = await evaluateCallGate(prisma, PRACTICE_A);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('BILLING_MISCONFIGURED');
  });

  it('SUBSCRIPTION_CANCELED when the org subscription is canceled', async () => {
    const { prisma } = orgPrisma({ [PRACTICE_A]: 0, [PRACTICE_B]: 0 }, { subscriptionStatus: 'canceled' });
    const gate = await evaluateCallGate(prisma, PRACTICE_A);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('SUBSCRIPTION_CANCELED');
  });
});
