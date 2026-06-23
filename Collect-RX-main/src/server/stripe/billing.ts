/**
 * CollectRx platform subscription (Stripe Billing).
 * Charges the dental practice for using CollectRx — separate from Stripe Connect (patient → practice).
 */

import type { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { readPublicAppUrl } from '../envRailway.js';
import { startNewBillingCycle, syncPlanStatusFromSubscription } from '../plans/planBridge.js';

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

/** When true and a subscription price is configured, practices must be active/trialing (or skip-listed). */
export function subscriptionEnforceEnabled(): boolean {
  return process.env.SUBSCRIPTION_ENFORCE === '1' || process.env.SUBSCRIPTION_ENFORCE === 'true';
}

function subscriptionPriceId(): string | undefined {
  return process.env.STRIPE_PRACTICE_SUBSCRIPTION_PRICE_ID?.trim() || undefined;
}

function billingSkipPracticeIds(): Set<string> {
  const raw = process.env.BILLING_SKIP_PRACTICE_IDS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
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

export type SubscriptionGateState = {
  enforce: boolean;
  active: boolean;
  status: string | null;
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
    return {
      enforce: false,
      active: true,
      status: null,
      currentPeriodEnd: null,
      priceConfigured,
      skipped: false,
    };
  }

  const p = await db.practice.findUnique({
    where: { id: practiceId },
    select: { subscriptionStatus: true, subscriptionCurrentPeriodEnd: true },
  });

  const active = skipped || isSubscriptionStatusActive(p?.subscriptionStatus);

  return {
    enforce: true,
    active,
    status: p?.subscriptionStatus ?? null,
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
  await db.practice.update({
    where: { id: practiceId },
    data: {
      stripeSubscriptionId: sub.id,
      stripeCustomerId: customerId,
      subscriptionStatus: sub.status,
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
      subscriptionCurrentPeriodEnd: null,
    },
  });
}

export async function createBillingCheckoutSession(practiceId: string, db: PrismaClient): Promise<{ url: string }> {
  const price = subscriptionPriceId();
  if (!price) {
    throw new Error('STRIPE_PRACTICE_SUBSCRIPTION_PRICE_ID is not configured');
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
    metadata: { practice_id: practiceId },
    subscription_data: {
      metadata: { practice_id: practiceId },
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
 * Platform Billing webhook branch — call after `constructEvent`, before Connect patient-pay logic.
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
      const rawPid = session.metadata?.practice_id;
      const practiceId = typeof rawPid === 'string' && rawPid.length > 0 ? rawPid : undefined;
      const subRef = session.subscription;
      if (!practiceId || !subRef) {
        return { handled: false, reason: 'missing_practice_or_subscription' };
      }
      const subId = typeof subRef === 'string' ? subRef : subRef.id;
      const sub = await stripe.subscriptions.retrieve(subId, { expand: ['items.data'] });
      await db.$transaction([
        db.practice.update({
          where: { id: practiceId },
          data: {
            stripeSubscriptionId: sub.id,
            stripeCustomerId:
              typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
            subscriptionStatus: sub.status,
            subscriptionCurrentPeriodEnd: subscriptionPeriodEndDate(sub),
          },
        }),
        db.processedStripeEvent.create({ data: { id: event.id } }),
      ]);
      await syncPlanStatusFromSubscription(practiceId, sub.status);
      return { handled: true };
    }

    if (event.type === 'invoice.paid') {
      const invoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };
      const subRef = invoice.subscription;
      if (!subRef) return { handled: false, reason: 'invoice_without_subscription' };
      const subId = typeof subRef === 'string' ? subRef : subRef.id;
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
      const sub = event.data.object as Stripe.Subscription;
      const metaPid = sub.metadata?.practice_id;
      let practiceId: string | undefined =
        typeof metaPid === 'string' && metaPid.length > 0 ? metaPid : undefined;
      if (!practiceId) {
        const p = await db.practice.findFirst({
          where: { stripeSubscriptionId: sub.id },
          select: { id: true },
        });
        practiceId = p?.id;
      }
      if (!practiceId) {
        return { handled: false, reason: 'practice_not_found_for_subscription' };
      }
      await db.$transaction([
        db.practice.update({
          where: { id: practiceId },
          data: {
            stripeSubscriptionId: sub.id,
            stripeCustomerId:
              typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
            subscriptionStatus: sub.status,
            subscriptionCurrentPeriodEnd: subscriptionPeriodEndDate(sub),
          },
        }),
        db.processedStripeEvent.create({ data: { id: event.id } }),
      ]);
      await syncPlanStatusFromSubscription(practiceId, sub.status);
      return { handled: true };
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      const p = await db.practice.findFirst({
        where: { stripeSubscriptionId: sub.id },
        select: { id: true },
      });
      if (!p) {
        return { handled: false, reason: 'practice_not_found_for_subscription' };
      }
      await db.$transaction([
        db.practice.update({
          where: { id: p.id },
          data: {
            subscriptionStatus: 'canceled',
            stripeSubscriptionId: null,
            subscriptionCurrentPeriodEnd: null,
          },
        }),
        db.processedStripeEvent.create({ data: { id: event.id } }),
      ]);
      await syncPlanStatusFromSubscription(p.id, 'canceled');
      return { handled: true };
    }
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === 'P2002') {
      return { handled: true, reason: 'duplicate_event' };
    }
    throw e;
  }

  return { handled: false, reason: 'not_billing_event' };
}
