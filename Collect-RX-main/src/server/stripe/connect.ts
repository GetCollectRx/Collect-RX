/**
 * CollectRx — Stripe Connect
 *
 * Each dental practice is their own Stripe Express merchant (Stripe Connect).
 * Patient payments go directly to the practice's bank account.
 * CollectRx never holds practice funds.
 *
 * PHI constraint: no patient name, DOB, or health data is sent to Stripe.
 */

import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { sendPaymentReceiptEmail } from '../patients/messaging';
import { handlePlatformBillingWebhook } from './billing';

const prisma = new PrismaClient();

function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

const SERVER_URL = () => (process.env.SERVER_URL || 'https://localhost:3000').replace(/\/$/, '');

// Connect account lookup
export async function getConnectAccount(practiceId: string) {
  return prisma.stripeConnectAccount.findUnique({
    where: { practiceId },
  });
}

// Onboard a practice
export async function createOnboardingLink(practiceId: string, practiceEmail?: string, practiceName?: string) {
  const stripe = getStripe();

  // Check if account already exists
  const connectRow = await getConnectAccount(practiceId);
  let stripeAccountId: string;

  if (connectRow) {
    stripeAccountId = connectRow.stripeAccountId;
  } else {
    // Create Stripe Express account
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'CA',
      email: practiceEmail || undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_profile: {
        name: practiceName || 'Dental Practice',
        mcc: '8021', // Dentists and orthodontists
      },
      metadata: { practice_id: practiceId },
    });

    stripeAccountId = account.id;

    await prisma.stripeConnectAccount.create({
      data: {
        practiceId,
        stripeAccountId,
      },
    });
  }

  // Generate a fresh onboarding link
  const link = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${SERVER_URL()}/api/stripe/connect/onboard/refresh?practice_id=${practiceId}`,
    return_url: `${SERVER_URL()}/api/stripe/connect/onboard/complete?practice_id=${practiceId}`,
    type: 'account_onboarding',
  });

  return { url: link.url, stripeAccountId };
}

// Check / refresh account status
export async function refreshAccountStatus(practiceId: string) {
  const connectRow = await getConnectAccount(practiceId);
  if (!connectRow) return null;

  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(connectRow.stripeAccountId);

  await prisma.stripeConnectAccount.update({
    where: { practiceId },
    data: {
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      onboardingComplete: account.details_submitted || false,
      updatedAt: new Date(),
    },
  });

  return {
    stripeAccountId: connectRow.stripeAccountId,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    onboardingComplete: account.details_submitted,
  };
}

// Generate a Payment Link for one patient balance
interface BalanceForPayment {
  id: string;
  patientOwes: number;
  practiceId?: string | null;
  patientToken: string;
}

export async function generatePaymentLink(balance: BalanceForPayment, stripeAccountId: string) {
  const stripe = getStripe();
  const amountCents = Math.round(Number(balance.patientOwes) * 100);

  if (amountCents <= 0) throw new Error('Balance amount must be positive');

  // Create a one-off price
  const price = await stripe.prices.create(
    {
      currency: 'cad',
      unit_amount: amountCents,
      product_data: {
        name: 'Dental Procedure Payment',
      },
    },
    { stripeAccount: stripeAccountId }
  );

  // Create a Payment Link
  const link = await stripe.paymentLinks.create(
    {
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: {
        balance_id: String(balance.id),
        practice_id: String(balance.practiceId || ''),
        patient_token: String(balance.patientToken),
      },
      after_completion: {
        type: 'redirect',
        redirect: { url: `${SERVER_URL()}/payment/thank-you?paid=1` },
      },
    },
    { stripeAccount: stripeAccountId }
  );

  return { url: link.url, id: link.id };
}

// Stripe webhook handler — use the same PrismaClient as the app (migrations, tests).
export async function handleWebhook(
  rawBody: Buffer | string,
  signature: string,
  db: PrismaClient
) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');

  const stripe = getStripe();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    throw new Error(`Stripe signature verification failed: ${(err as Error).message}`);
  }

  console.log('Stripe webhook received', { type: event.type, id: event.id });

  // Idempotency: Stripe may retry the same event; we store event.id and skip work.
  const alreadyProcessed = await db.processedStripeEvent.findUnique({ where: { id: event.id } });
  if (alreadyProcessed) {
    return { handled: true, duplicate: true, eventId: event.id };
  }

  const billingResult = await handlePlatformBillingWebhook(event, db, stripe);
  if (billingResult.handled) {
    return { handled: true, platformBilling: true, eventId: event.id, reason: billingResult.reason };
  }

  // Connect Payment Links emit both checkout.session.completed and payment_intent.succeeded
  // for the same charge. Credited only from checkout so we do not double-post the balance.
  if (event.type === 'payment_intent.succeeded') {
    console.log('Stripe webhook: ignoring payment_intent.succeeded (credited on checkout.session.completed)', {
      eventId: event.id,
    });
    return { handled: false, reason: 'payment_intent_ignored_await_checkout' };
  }

  // Real patient pay path: Connect Payment Link → Checkout Session (metadata from link → session)
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode === 'subscription') {
      return { handled: false, reason: 'subscription_checkout_not_handled_by_billing' };
    }
    const balanceId = session.metadata?.balance_id;
    const amountCents = session.amount_total ?? 0;
    let paymentIntentId: string | null = null;
    if (session.payment_intent) {
      paymentIntentId =
        typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id;
    }

    if (!balanceId) {
      console.warn('Stripe webhook: no balance_id in session metadata', { type: event.type, eventId: event.id });
      return { handled: false, reason: 'no balance_id' };
    }

    const amountReceived = amountCents / 100;
    const bal = await db.patientBalance.findUnique({ where: { id: balanceId } });
    if (!bal) {
      console.warn('Stripe webhook: balance not found', { balanceId });
      return { handled: false, reason: 'balance_not_found' };
    }

    const newAmountPaid = Number(bal.amountPaid || 0) + amountReceived;
    const patientOwes = Number(bal.patientOwes);
    const newStatus = newAmountPaid + 0.0001 >= patientOwes ? 'paid' : 'partial';

    try {
      await db.$transaction([
        db.processedStripeEvent.create({ data: { id: event.id } }),
        db.patientBalance.update({
          where: { id: balanceId },
          data: {
            amountPaid: newAmountPaid,
            paymentStatus: newStatus,
            ...(paymentIntentId && { stripePaymentIntentId: paymentIntentId }),
            updatedAt: new Date(),
          },
        }),
      ]);
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === 'P2002') {
        return { handled: true, duplicate: true, eventId: event.id };
      }
      throw e;
    }

    console.log('Payment recorded', { balanceId, amountReceived, newStatus });
    if (bal.patientEmail) {
      void sendPaymentReceiptEmail(bal.patientEmail, bal.patientFirstName, amountReceived);
    }
    return { handled: true, balanceId, amountReceived, newStatus };
  }

  if (event.type === 'account.updated') {
    const account = event.data.object as Stripe.Account;
    const connectRecord = await db.stripeConnectAccount.findUnique({
      where: { stripeAccountId: account.id },
    });
    if (connectRecord) {
      await refreshAccountStatus(connectRecord.practiceId);
    }
    return { handled: true };
  }

  return { handled: false, reason: 'unhandled event type' };
}
