/**
 * CollectRx platform subscription (Stripe Billing).
 * Charges the dental practice for using CollectRx (SaaS plan).
 * Patient/client payment collection is out of product scope.
 */

import type { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { readPublicAppUrl } from '../envAliases.js';
import {
  billingSkipPracticeIds,
  defaultSubscriptionPlan,
  getSubscriptionUsageState,
  isKnownPlanId,
  resolvePracticeSubscriptionPlan,
  subscriptionEnforceEnabled,
  subscriptionPlanById,
  subscriptionPlanByPriceId,
  type SubscriptionPlanSnapshot,
  type SubscriptionUsageState,
} from './subscriptionPlans.js';
import { billingTierForStripePrice } from '../../billing/tiers.js';
import { startNewBillingCycle, syncPlanStatusFromSubscription } from '../plans/planBridge.js';
import { logger } from '../observability/logger.js';

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

/** Browser origin for Checkout / Portal return URLs (Vite dev vs production). */
export function frontendBaseUrl(): string {
  const fromEnv = readPublicAppUrl();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') return 'https://www.collectrx.ca';
  return 'http://localhost:5173';
}

export { subscriptionEnforceEnabled };

function subscriptionPriceId(): string | undefined {
  return defaultSubscriptionPlan()?.priceId ?? (process.env.STRIPE_PRACTICE_SUBSCRIPTION_PRICE_ID?.trim() || undefined);
}

export function isSubscriptionStatusActive(status: string | null | undefined): boolean {
  return status === 'active' || status === 'trialing';
}

/** Stripe API 2025+ — billing period end lives on subscription items, not the root object. */
function subscriptionPeriodEndDate(sub: Stripe.Subscription): Date | null {
  const end = sub.items?.data?.[0]?.current_period_end;
  if (typeof end === 'number' && Number.isFinite(end)) {
    return new Date(end * 1000);
  }
  return null;
}

function subscriptionPeriodStartDate(sub: Stripe.Subscription): Date | null {
  const start = sub.items?.data?.[0]?.current_period_start;
  if (typeof start === 'number' && Number.isFinite(start)) {
    return new Date(start * 1000);
  }
  return null;
}

function subscriptionPrimaryPriceId(sub: Stripe.Subscription): string | null {
  const price = sub.items?.data?.[0]?.price;
  return typeof price?.id === 'string' && price.id.length > 0 ? price.id : null;
}

function subscriptionPlanSnapshot(sub: Stripe.Subscription): SubscriptionPlanSnapshot | null {
  const priceId = subscriptionPrimaryPriceId(sub);
  const fromPrice = subscriptionPlanByPriceId(priceId);
  if (fromPrice) return fromPrice;
  const metaPlanId = sub.metadata?.collectrx_plan_id || sub.metadata?.plan_id;
  return subscriptionPlanById(metaPlanId) ?? null;
}

function organizationHealthUpdate(
  current: { callsPaused: boolean; callsPausedReason: string | null },
  status: string | null | undefined,
): Record<string, unknown> {
  if (status === 'past_due' || status === 'unpaid') {
    return current.callsPaused
      ? {}
      : { callsPaused: true, callsPausedReason: 'payment_failed', callsPausedAt: new Date() };
  }
  if (status === 'canceled') {
    return { callsPaused: true, callsPausedReason: 'subscription_cancelled', callsPausedAt: new Date() };
  }
  if (
    (status === 'active' || status === 'trialing') &&
    current.callsPaused &&
    (current.callsPausedReason === 'payment_failed' || current.callsPausedReason === 'subscription_cancelled')
  ) {
    return { callsPaused: false, callsPausedReason: null, callsPausedAt: null };
  }
  return {};
}

async function applyOrganizationSubscriptionEvent(
  db: PrismaClient,
  eventId: string,
  organizationId: string,
  sub: Stripe.Subscription,
): Promise<void> {
  const priceId = subscriptionPrimaryPriceId(sub);
  const plan = subscriptionPlanSnapshot(sub);
  const billingTier = billingTierForStripePrice(priceId);
  if (priceId && !billingTier) {
    logger.error('[billing-webhook] Stripe price does not map to any tier — organization tier left unchanged', {
      priceId,
      organizationId,
      hint: 'check STRIPE_PRICE_CORE/GROWTH/SCALE',
    });
  }

  await db.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { callsPaused: true, callsPausedReason: true },
    });
    if (!organization) throw new Error(`Organization ${organizationId} not found`);

    await tx.organization.update({
      where: { id: organizationId },
      data: {
        stripeSubscriptionId: sub.status === 'canceled' ? null : sub.id,
        stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        subscriptionStatus: sub.status,
        subscriptionPriceId: sub.status === 'canceled' ? null : priceId,
        subscriptionPlanId: sub.status === 'canceled' ? null : (plan?.id ?? null),
        subscriptionCurrentPeriodStart: sub.status === 'canceled' ? null : subscriptionPeriodStartDate(sub),
        subscriptionCurrentPeriodEnd: sub.status === 'canceled' ? null : subscriptionPeriodEndDate(sub),
        ...(billingTier ? { billingTier } : {}),
        ...organizationHealthUpdate(organization, sub.status),
      },
    });
    await tx.processedStripeEvent.create({ data: { id: eventId } });
  });
}

async function applyOrganizationBillingCycle(
  db: PrismaClient,
  eventId: string,
  organizationId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<void> {
  await db.$transaction(async (tx) => {
    // Stripe can deliver invoice events more than once or out of order. Only a
    // strictly newer period may reset usage. The conditional update is the
    // atomic claim: concurrent events for the same period cannot both win.
    const resetClaim = await tx.organization.updateMany({
      where: {
        id: organizationId,
        OR: [{ billingPeriodStart: null }, { billingPeriodStart: { lt: periodStart } }],
      },
      data: {
        billingPeriodStart: periodStart,
        callsPaused: false,
        callsPausedReason: null,
        callsPausedAt: null,
        overageConfirmed: false,
        overageConfirmedAt: null,
      },
    });
    if (resetClaim.count === 1) {
      const members = await tx.organizationPractice.findMany({
        where: { organizationId },
        select: { practiceId: true },
      });
      for (const member of members) {
        await tx.usagePeriod.create({
          data: { practiceId: member.practiceId, periodStart, periodEnd },
        });
      }
    }
    await tx.processedStripeEvent.create({ data: { id: eventId } });
  });
}

export type SubscriptionGateState = {
  enforce: boolean;
  active: boolean;
  status: string | null;
  plan: SubscriptionPlanSnapshot | null;
  usage: SubscriptionUsageState | null;
  currentPeriodEnd: string | null;
  priceConfigured: boolean;
  skipped: boolean;
};

export async function getSubscriptionGateState(
  db: PrismaClient,
  practiceId: string
): Promise<SubscriptionGateState> {
  const priceConfigured = Boolean(subscriptionPriceId());
  const enforce = subscriptionEnforceEnabled() && priceConfigured;
  const skipped = billingSkipPracticeIds().has(practiceId);

  if (!enforce) {
    const p = priceConfigured
      ? await db.practice.findUnique({
          where: { id: practiceId },
          select: {
            subscriptionStatus: true,
            subscriptionPriceId: true,
            subscriptionPlanId: true,
            subscriptionCurrentPeriodStart: true,
            subscriptionCurrentPeriodEnd: true,
          },
        })
      : null;
    const { plan, usage } = priceConfigured
      ? await getSubscriptionUsageState(db, practiceId, p)
      : { plan: defaultSubscriptionPlan(), usage: null };
    return {
      enforce: false,
      active: true,
      status: p?.subscriptionStatus ?? null,
      plan,
      usage,
      currentPeriodEnd: p?.subscriptionCurrentPeriodEnd?.toISOString() ?? null,
      priceConfigured,
      skipped: false,
    };
  }

  const p = await db.practice.findUnique({
    where: { id: practiceId },
    select: {
      subscriptionStatus: true,
      subscriptionPriceId: true,
      subscriptionPlanId: true,
      subscriptionCurrentPeriodStart: true,
      subscriptionCurrentPeriodEnd: true,
    },
  });

  const active = skipped || isSubscriptionStatusActive(p?.subscriptionStatus);
  const { plan, usage } = await getSubscriptionUsageState(db, practiceId, p);

  return {
    enforce: true,
    active,
    status: p?.subscriptionStatus ?? null,
    plan: skipped
      ? { id: 'billing-skip', displayName: 'Pilot / billing skip', priceId: null, monthlyClaimLimit: null }
      : (plan ?? resolvePracticeSubscriptionPlan(p)),
    usage: skipped ? null : usage,
    currentPeriodEnd: p?.subscriptionCurrentPeriodEnd?.toISOString() ?? null,
    priceConfigured,
    skipped,
  };
}

export async function syncPracticeFromStripeSubscription(
  db: PrismaClient,
  practiceId: string,
  sub: Stripe.Subscription
): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const priceId = subscriptionPrimaryPriceId(sub);
  const plan = subscriptionPlanSnapshot(sub);
  await db.practice.update({
    where: { id: practiceId },
    data: {
      stripeSubscriptionId: sub.id,
      stripeCustomerId: customerId,
      subscriptionStatus: sub.status,
      subscriptionPriceId: priceId,
      subscriptionPlanId: plan?.id ?? null,
      subscriptionCurrentPeriodStart: subscriptionPeriodStartDate(sub),
      subscriptionCurrentPeriodEnd: subscriptionPeriodEndDate(sub),
    },
  });
}

export async function markPracticeSubscriptionCanceled(db: PrismaClient, practiceId: string): Promise<void> {
  await db.practice.update({
    where: { id: practiceId },
    data: {
      subscriptionStatus: 'canceled',
      stripeSubscriptionId: null,
      subscriptionPriceId: null,
      subscriptionPlanId: null,
      subscriptionCurrentPeriodStart: null,
      subscriptionCurrentPeriodEnd: null,
    },
  });
}

export async function createBillingCheckoutSession(
  practiceId: string,
  db: PrismaClient,
  requestedPlanId?: string
): Promise<{ url: string }> {
  if (requestedPlanId && !isKnownPlanId(requestedPlanId)) {
    throw new Error(`Unknown plan "${requestedPlanId}" — valid plans are core, growth, scale`);
  }
  const plan = requestedPlanId ? subscriptionPlanById(requestedPlanId) : defaultSubscriptionPlan();
  const price = plan?.priceId ?? subscriptionPriceId();
  if (!price) {
    throw new Error(
      requestedPlanId
        ? `Plan "${requestedPlanId}" has no Stripe price configured — set STRIPE_PRICE_${requestedPlanId.toUpperCase()}`
        : 'Stripe subscription price is not configured',
    );
  }
  const stripe = getStripe();
  const practice = await db.practice.findUnique({ where: { id: practiceId } });
  if (!practice) {
    throw new Error('Practice not found');
  }

  let customerId = practice.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      metadata: { practice_id: practiceId },
      name: practice.name,
    });
    customerId = customer.id;
    await db.practice.update({
      where: { id: practiceId },
      data: { stripeCustomerId: customerId },
    });
  }

  const base = frontendBaseUrl();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    success_url: `${base}/billing?subscribed=1`,
    cancel_url: `${base}/billing?canceled=1`,
    metadata: { practice_id: practiceId, collectrx_plan_id: plan?.id ?? 'core' },
    subscription_data: {
      metadata: { practice_id: practiceId, collectrx_plan_id: plan?.id ?? 'core' },
    },
    allow_promotion_codes: true,
  });

  if (!session.url) {
    throw new Error('Stripe Checkout did not return a URL');
  }
  return { url: session.url };
}

export async function createBillingPortalSession(practiceId: string, db: PrismaClient): Promise<{ url: string }> {
  const stripe = getStripe();
  const practice = await db.practice.findUnique({
    where: { id: practiceId },
    select: { stripeCustomerId: true },
  });
  if (!practice?.stripeCustomerId) {
    throw new Error('No billing account yet — subscribe first');
  }
  const base = frontendBaseUrl();
  const session = await stripe.billingPortal.sessions.create({
    customer: practice.stripeCustomerId,
    return_url: `${base}/billing`,
  });
  return { url: session.url };
}

/**
 * Org-level checkout — the DSO's parent company is charged once for every
 * member practice, instead of each location subscribing individually.
 * Mirrors createBillingCheckoutSession; metadata carries organization_id so
 * the webhook routes subscription state onto the Organization, not a Practice.
 */
export async function createOrgBillingCheckoutSession(
  organizationId: string,
  db: PrismaClient,
  requestedPlanId?: string,
): Promise<{ url: string }> {
  const plan = requestedPlanId ? subscriptionPlanById(requestedPlanId) : defaultSubscriptionPlan();
  if (requestedPlanId && !plan) {
    throw new Error(`Unknown plan "${requestedPlanId}" — valid plans are core, growth, scale`);
  }
  const price = plan?.priceId ?? subscriptionPriceId();
  if (!price) {
    throw new Error('Stripe subscription price is not configured');
  }
  const stripe = getStripe();
  const organization = await db.organization.findUnique({ where: { id: organizationId } });
  if (!organization) {
    throw new Error('Organization not found');
  }

  let customerId = organization.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      metadata: { organization_id: organizationId },
      name: organization.name,
    });
    customerId = customer.id;
    await db.organization.update({
      where: { id: organizationId },
      data: { stripeCustomerId: customerId },
    });
  }

  const base = frontendBaseUrl();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    success_url: `${base}/group/billing?subscribed=1`,
    cancel_url: `${base}/group/billing?canceled=1`,
    metadata: { organization_id: organizationId, collectrx_plan_id: plan?.id ?? 'core' },
    subscription_data: {
      metadata: { organization_id: organizationId, collectrx_plan_id: plan?.id ?? 'core' },
    },
    allow_promotion_codes: true,
  });

  if (!session.url) {
    throw new Error('Stripe Checkout did not return a URL');
  }
  return { url: session.url };
}

export async function createOrgBillingPortalSession(
  organizationId: string,
  db: PrismaClient,
): Promise<{ url: string }> {
  const stripe = getStripe();
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { stripeCustomerId: true },
  });
  if (!organization?.stripeCustomerId) {
    throw new Error('No billing account yet — subscribe first');
  }
  const base = frontendBaseUrl();
  const session = await stripe.billingPortal.sessions.create({
    customer: organization.stripeCustomerId,
    return_url: `${base}/group/billing`,
  });
  return { url: session.url };
}

/**
 * Platform Billing webhook branch — call after `constructEvent`.
 * Marks the event processed when returning handled: true.
 */
export async function handlePlatformBillingWebhook(
  event: Stripe.Event,
  db: PrismaClient,
  stripe: Stripe
): Promise<{ handled: boolean; reason?: string }> {
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== 'subscription') {
        return { handled: false, reason: 'not_subscription_checkout' };
      }
      const rawOrgId = session.metadata?.organization_id;
      const organizationId = typeof rawOrgId === 'string' && rawOrgId.length > 0 ? rawOrgId : undefined;
      const rawPid = session.metadata?.practice_id;
      const practiceId = typeof rawPid === 'string' && rawPid.length > 0 ? rawPid : undefined;
      const subRef = session.subscription;
      if ((!practiceId && !organizationId) || !subRef) {
        return { handled: false, reason: 'missing_practice_or_subscription' };
      }
      const subId = typeof subRef === 'string' ? subRef : subRef.id;
      const sub = await stripe.subscriptions.retrieve(subId, { expand: ['items.data'] });
      const priceId = subscriptionPrimaryPriceId(sub);
      const plan = subscriptionPlanSnapshot(sub);
      const billingTier = billingTierForStripePrice(priceId);
      if (priceId && !billingTier) {
        // Fail closed: the entity keeps its current tier (trial for new
        // signups) rather than guessing a minute pool from an unmapped price.
        logger.error('[billing-webhook] Stripe price does not map to any tier — practice tier left unchanged', {
          priceId,
          hint: 'check STRIPE_PRICE_CORE/GROWTH/SCALE',
        });
      }
      const subscriptionFields = {
        stripeSubscriptionId: sub.id,
        stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        subscriptionStatus: sub.status,
        subscriptionPriceId: priceId,
        subscriptionPlanId: plan?.id ?? null,
        subscriptionCurrentPeriodStart: subscriptionPeriodStartDate(sub),
        subscriptionCurrentPeriodEnd: subscriptionPeriodEndDate(sub),
        ...(billingTier ? { billingTier } : {}),
      };
      if (organizationId) {
        await applyOrganizationSubscriptionEvent(db, event.id, organizationId, sub);
        return { handled: true };
      }
      await db.$transaction([
        db.practice.update({ where: { id: practiceId as string }, data: subscriptionFields }),
        db.processedStripeEvent.create({ data: { id: event.id } }),
      ]);
      await syncPlanStatusFromSubscription(practiceId as string, sub.status);
      return { handled: true };
    }

    if (event.type === 'invoice.paid') {
      const invoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };
      const subRef = invoice.subscription;
      if (!subRef) return { handled: false, reason: 'invoice_without_subscription' };
      const subId = typeof subRef === 'string' ? subRef : subRef.id;
      let org = await db.organization.findFirst({
        where: { stripeSubscriptionId: subId },
        select: { id: true },
      });
      if (!org) {
        const currentSub = await stripe.subscriptions.retrieve(subId, { expand: ['items.data'] });
        const metadataOrganizationId = currentSub.metadata?.organization_id;
        if (typeof metadataOrganizationId === 'string' && metadataOrganizationId.length > 0) {
          org = await db.organization.findUnique({
            where: { id: metadataOrganizationId },
            select: { id: true },
          });
          if (!org) throw new Error(`Organization ${metadataOrganizationId} not found`);
        }
      }
      if (org) {
        const periodStartSeconds = invoice.period_start;
        const periodEndSeconds = invoice.period_end;
        if (!Number.isFinite(periodStartSeconds) || !Number.isFinite(periodEndSeconds)) {
          throw new Error(`Stripe invoice ${invoice.id} is missing a valid billing period`);
        }
        await applyOrganizationBillingCycle(
          db,
          event.id,
          org.id,
          new Date(periodStartSeconds * 1000),
          new Date(periodEndSeconds * 1000),
        );
        return { handled: true };
      }
      const p = await db.practice.findFirst({
        where: { stripeSubscriptionId: subId },
        select: { id: true },
      });
      if (!p) return { handled: false, reason: 'practice_not_found_for_invoice' };
      await startNewBillingCycle(p.id);
      await db.processedStripeEvent.create({ data: { id: event.id } });
      return { handled: true };
    }

    if (event.type === 'customer.subscription.updated') {
      const deliveredSub = event.data.object as Stripe.Subscription;
      // Fetch current Stripe state so an older webhook delivered after a newer
      // one cannot roll the organization back to stale plan/payment state.
      const sub = await stripe.subscriptions.retrieve(deliveredSub.id, { expand: ['items.data'] });
      const metaOrgId = sub.metadata?.organization_id;
      let organizationId: string | undefined =
        typeof metaOrgId === 'string' && metaOrgId.length > 0 ? metaOrgId : undefined;
      const metaPid = sub.metadata?.practice_id;
      let practiceId: string | undefined =
        typeof metaPid === 'string' && metaPid.length > 0 ? metaPid : undefined;
      if (!organizationId && !practiceId) {
        const org = await db.organization.findFirst({
          where: { stripeSubscriptionId: sub.id },
          select: { id: true },
        });
        organizationId = org?.id;
        if (!organizationId) {
          const p = await db.practice.findFirst({
            where: { stripeSubscriptionId: sub.id },
            select: { id: true },
          });
          practiceId = p?.id;
        }
      }
      if (!organizationId && !practiceId) {
        return { handled: false, reason: 'practice_not_found_for_subscription' };
      }
      const priceId = subscriptionPrimaryPriceId(sub);
      const plan = subscriptionPlanSnapshot(sub);
      const billingTier = billingTierForStripePrice(priceId);
      if (priceId && !billingTier) {
        // Fail closed: the entity keeps its current tier (trial for new
        // signups) rather than guessing a minute pool from an unmapped price.
        logger.error('[billing-webhook] Stripe price does not map to any tier — practice tier left unchanged', {
          priceId,
          hint: 'check STRIPE_PRICE_CORE/GROWTH/SCALE',
        });
      }
      const subscriptionFields = {
        stripeSubscriptionId: sub.id,
        stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        subscriptionStatus: sub.status,
        subscriptionPriceId: priceId,
        subscriptionPlanId: plan?.id ?? null,
        subscriptionCurrentPeriodStart: subscriptionPeriodStartDate(sub),
        subscriptionCurrentPeriodEnd: subscriptionPeriodEndDate(sub),
        ...(billingTier ? { billingTier } : {}),
      };
      if (organizationId) {
        await applyOrganizationSubscriptionEvent(db, event.id, organizationId, sub);
        return { handled: true };
      }
      await db.$transaction([
        db.practice.update({ where: { id: practiceId as string }, data: subscriptionFields }),
        db.processedStripeEvent.create({ data: { id: event.id } }),
      ]);
      await syncPlanStatusFromSubscription(practiceId as string, sub.status);
      return { handled: true };
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      const canceledFields = {
        subscriptionStatus: 'canceled',
        stripeSubscriptionId: null,
        subscriptionPriceId: null,
        subscriptionPlanId: null,
        subscriptionCurrentPeriodStart: null,
        subscriptionCurrentPeriodEnd: null,
      };
      const orgBySubscription = await db.organization.findFirst({
        where: { stripeSubscriptionId: sub.id },
        select: { id: true },
      });
      const metadataOrganizationId =
        typeof sub.metadata?.organization_id === 'string' && sub.metadata.organization_id.length > 0
          ? sub.metadata.organization_id
          : undefined;
      const organizationId = orgBySubscription?.id ?? metadataOrganizationId;
      if (organizationId) {
        await db.$transaction(async (tx) => {
          const organization = await tx.organization.findUnique({
            where: { id: organizationId },
            select: { stripeSubscriptionId: true, callsPaused: true, callsPausedReason: true },
          });
          if (!organization) throw new Error(`Organization ${organizationId} not found`);
          // A deletion for an old subscription must never cancel a replacement
          // subscription that is already attached to the organization.
          if (!organization.stripeSubscriptionId || organization.stripeSubscriptionId === sub.id) {
            await tx.organization.update({
              where: { id: organizationId },
              data: {
                ...canceledFields,
                ...organizationHealthUpdate(organization, 'canceled'),
              },
            });
          }
          await tx.processedStripeEvent.create({ data: { id: event.id } });
        });
        return { handled: true };
      }
      const p = await db.practice.findFirst({
        where: { stripeSubscriptionId: sub.id },
        select: { id: true },
      });
      if (!p) {
        return { handled: false, reason: 'practice_not_found_for_subscription' };
      }
      await db.$transaction([
        db.practice.update({ where: { id: p.id }, data: canceledFields }),
        db.processedStripeEvent.create({ data: { id: event.id } }),
      ]);
      await syncPlanStatusFromSubscription(p.id, 'canceled');
      return { handled: true };
    }
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === 'P2002') {
      const processed = await db.processedStripeEvent.findUnique({ where: { id: event.id } });
      if (processed) return { handled: true, reason: 'duplicate_event' };
    }
    throw e;
  }

  return { handled: false, reason: 'not_billing_event' };
}
