import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getSubscriptionGateState } from '../src/server/stripe/billing'

const DAY = 24 * 60 * 60 * 1000

function fakeDb(practice: Record<string, unknown>) {
  return {
    practice: { findUnique: async () => practice },
    usagePeriod: { findFirst: async () => null, findMany: async () => [], count: async () => 0 },
    insuranceClaim: { count: async () => 0 },
  } as never
}

describe('subscription gate honors the trial', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    process.env.SUBSCRIPTION_ENFORCE = '1'
    process.env.STRIPE_PRACTICE_SUBSCRIPTION_PRICE_ID = 'price_test_fake'
    delete process.env.BILLING_SKIP_PRACTICE_IDS
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  const base = {
    subscriptionStatus: null,
    subscriptionPriceId: null,
    subscriptionPlanId: null,
    subscriptionCurrentPeriodStart: null,
    subscriptionCurrentPeriodEnd: null,
  }

  it('lets a new practice in during its trial', async () => {
    const s = await getSubscriptionGateState(
      fakeDb({ ...base, billingTier: 'trial', trialEndsAt: new Date(Date.now() + 10 * DAY) }),
      'p1',
    )
    expect(s.enforce).toBe(true)
    expect(s.active).toBe(true)
  })

  it('blocks once the trial has ended', async () => {
    const s = await getSubscriptionGateState(
      fakeDb({ ...base, billingTier: 'trial', trialEndsAt: new Date(Date.now() - DAY) }),
      'p1',
    )
    expect(s.active).toBe(false)
  })

  it('blocks a cancelled customer even if trialEndsAt is still in the future', async () => {
    const s = await getSubscriptionGateState(
      fakeDb({ ...base, subscriptionStatus: 'canceled', billingTier: 'trial', trialEndsAt: new Date(Date.now() + 10 * DAY) }),
      'p1',
    )
    expect(s.active).toBe(false)
  })

  it('blocks a practice with no trial date', async () => {
    const s = await getSubscriptionGateState(fakeDb({ ...base, billingTier: 'trial', trialEndsAt: null }), 'p1')
    expect(s.active).toBe(false)
  })
})
