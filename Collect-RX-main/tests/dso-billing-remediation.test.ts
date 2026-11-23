import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { handlePlatformBillingWebhook } from '../src/server/stripe/billing.js';

vi.hoisted(() => {
  process.env.STRIPE_PRICE_GROWTH = 'price_growth';
});

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_org_1',
    customer: 'cus_org_1',
    status: 'active',
    metadata: { organization_id: 'org_1', collectrx_plan_id: 'growth' },
    items: { data: [{ current_period_start: 2_000, current_period_end: 3_000, price: { id: 'price_growth' } }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function event(id: string, type: Stripe.Event.Type, object: unknown): Stripe.Event {
  return { id, type, data: { object } } as unknown as Stripe.Event;
}

function mockDb(options: { failUpdate?: boolean; billingPeriodStart?: Date | null } = {}) {
  const processed = new Set<string>();
  const tx = {
    organization: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async ({ select }: { select: Record<string, boolean> }) =>
        'billingPeriodStart' in select
          ? { billingPeriodStart: options.billingPeriodStart ?? null }
          : { stripeSubscriptionId: 'sub_org_1', callsPaused: true, callsPausedReason: 'payment_failed' }),
      update: vi.fn(async () => {
        if (options.failUpdate) throw new Error('organization update failed');
        return {};
      }),
      updateMany: vi.fn(async () => ({
        count: !options.billingPeriodStart || options.billingPeriodStart < new Date(2_000 * 1000) ? 1 : 0,
      })),
    },
    organizationPractice: { findMany: vi.fn(async () => [{ practiceId: 'p1' }, { practiceId: 'p2' }]) },
    usagePeriod: { create: vi.fn(async () => ({})) },
    processedStripeEvent: {
      create: vi.fn(async ({ data }: { data: { id: string } }) => {
        if (processed.has(data.id)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        processed.add(data.id);
        return data;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        processed.has(where.id) ? { id: where.id } : null),
    },
  };
  const db = {
    ...tx,
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { db: db as never, tx, processed };
}

describe('DSO billing remediation', () => {
  it('updates org plan and payment health before marking the event processed', async () => {
    const { db, tx } = mockDb();
    const sub = subscription();
    const stripe = { subscriptions: { retrieve: vi.fn(async () => sub) } } as unknown as Stripe;

    const result = await handlePlatformBillingWebhook(
      event('evt_update', 'customer.subscription.updated', sub), db, stripe,
    );

    expect(result).toEqual({ handled: true });
    expect(tx.organization.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        stripeSubscriptionId: 'sub_org_1',
        subscriptionStatus: 'active',
        subscriptionPlanId: 'growth',
        callsPaused: false,
      }),
    }));
    expect(tx.organization.update.mock.invocationCallOrder[0])
      .toBeLessThan(tx.processedStripeEvent.create.mock.invocationCallOrder[0]);
  });

  it('uses current Stripe state when a stale update is delivered', async () => {
    const { db, tx } = mockDb();
    const stale = subscription({ status: 'past_due' });
    const current = subscription({ status: 'active' });
    const stripe = { subscriptions: { retrieve: vi.fn(async () => current) } } as unknown as Stripe;

    await handlePlatformBillingWebhook(event('evt_stale', 'customer.subscription.updated', stale), db, stripe);

    expect(tx.organization.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ subscriptionStatus: 'active', callsPaused: false }),
    }));
  });

  it('converges to canceled state when a stale update arrives after deletion', async () => {
    const { db, tx } = mockDb();
    const staleActive = subscription({ status: 'active' });
    const canonicalCanceled = subscription({ status: 'canceled' });
    const stripe = { subscriptions: { retrieve: vi.fn(async () => canonicalCanceled) } } as unknown as Stripe;

    await handlePlatformBillingWebhook(
      event('evt_update_after_delete', 'customer.subscription.updated', staleActive), db, stripe,
    );

    expect(tx.organization.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        stripeSubscriptionId: null,
        subscriptionStatus: 'canceled',
        subscriptionPriceId: null,
        callsPausedReason: 'subscription_cancelled',
      }),
    }));
  });

  it('records an old deletion without canceling a replacement subscription', async () => {
    const { db, tx } = mockDb();
    tx.organization.findFirst = vi.fn(async () => null) as never;
    tx.organization.findUnique.mockResolvedValueOnce({
      stripeSubscriptionId: 'sub_replacement',
      callsPaused: false,
      callsPausedReason: null,
    });
    const deleted = subscription({ id: 'sub_old' });

    const result = await handlePlatformBillingWebhook(
      event('evt_old_delete', 'customer.subscription.deleted', deleted), db, {} as Stripe,
    );

    expect(result).toEqual({ handled: true });
    expect(tx.organization.update).not.toHaveBeenCalled();
    expect(tx.processedStripeEvent.create).toHaveBeenCalledWith({ data: { id: 'evt_old_delete' } });
  });

  it('resets every org member exactly once for a newer invoice period', async () => {
    const { db, tx } = mockDb({ billingPeriodStart: new Date(1_000 * 1000) });
    tx.organization.findFirst = vi.fn(async () => ({ id: 'org_1' })) as never;
    const invoice = { id: 'in_1', subscription: 'sub_org_1', period_start: 2_000, period_end: 3_000 };

    const result = await handlePlatformBillingWebhook(
      event('evt_invoice', 'invoice.paid', invoice), db, {} as Stripe,
    );

    expect(result).toEqual({ handled: true });
    expect(tx.usagePeriod.create).toHaveBeenCalledTimes(2);
    expect(tx.organization.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ billingPeriodStart: new Date(2_000 * 1000), callsPaused: false }),
    }));
  });

  it('resolves an invoice to its organization when it arrives before checkout linkage', async () => {
    const { db, tx } = mockDb({ billingPeriodStart: new Date(1_000 * 1000) });
    tx.organization.findUnique.mockResolvedValueOnce({ id: 'org_1' });
    const stripe = {
      subscriptions: { retrieve: vi.fn(async () => subscription()) },
    } as unknown as Stripe;
    const invoice = { id: 'in_early', subscription: 'sub_org_1', period_start: 2_000, period_end: 3_000 };

    const result = await handlePlatformBillingWebhook(
      event('evt_early_invoice', 'invoice.paid', invoice), db, stripe,
    );

    expect(result).toEqual({ handled: true });
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_org_1', { expand: ['items.data'] });
    expect(tx.usagePeriod.create).toHaveBeenCalledTimes(2);
    expect(tx.processedStripeEvent.create).toHaveBeenCalledWith({ data: { id: 'evt_early_invoice' } });
  });

  it('records but does not reset an older reordered invoice period', async () => {
    const { db, tx } = mockDb({ billingPeriodStart: new Date(4_000 * 1000) });
    tx.organization.findFirst = vi.fn(async () => ({ id: 'org_1' })) as never;
    const invoice = { id: 'in_old', subscription: 'sub_org_1', period_start: 2_000, period_end: 3_000 };

    await handlePlatformBillingWebhook(event('evt_old', 'invoice.paid', invoice), db, {} as Stripe);

    expect(tx.usagePeriod.create).not.toHaveBeenCalled();
    expect(tx.organization.update).not.toHaveBeenCalled();
    expect(tx.processedStripeEvent.create).toHaveBeenCalledWith({ data: { id: 'evt_old' } });
  });

  it('does not mark incomplete organization processing as complete', async () => {
    const { db, tx, processed } = mockDb({ failUpdate: true });
    const sub = subscription();
    const stripe = { subscriptions: { retrieve: vi.fn(async () => sub) } } as unknown as Stripe;

    await expect(handlePlatformBillingWebhook(
      event('evt_retry', 'customer.subscription.updated', sub), db, stripe,
    )).rejects.toThrow('organization update failed');
    expect(tx.processedStripeEvent.create).not.toHaveBeenCalled();
    expect(processed.has('evt_retry')).toBe(false);
  });

  it('only treats a P2002 as duplicate when this event ID is already processed', async () => {
    const { db, tx } = mockDb();
    tx.organization.update.mockRejectedValueOnce(Object.assign(new Error('other unique violation'), { code: 'P2002' }));
    const sub = subscription();
    const stripe = { subscriptions: { retrieve: vi.fn(async () => sub) } } as unknown as Stripe;

    await expect(handlePlatformBillingWebhook(
      event('evt_not_duplicate', 'customer.subscription.updated', sub), db, stripe,
    )).rejects.toMatchObject({ code: 'P2002' });
  });
});
