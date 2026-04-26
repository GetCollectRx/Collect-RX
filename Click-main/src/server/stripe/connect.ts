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
  let connectRow = await getConnectAccount(practiceId);
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
        redirect: { url: `${SERVER_URL()}/payment/thank-you` },
      },
    },
    { stripeAccount: stripeAccountId }
  );

  return { url: link.url, id: link.id };
}

// Stripe webhook handler
export async function handleWebhook(rawBody: Buffer | string, signature: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');

  const stripe = getStripe();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    throw new Error(`Stripe signature verification failed: ${(err as Error).message}`);
  }

  console.log('Stripe webhook received', { type: event.type });

  // Payment completions from Connect accounts
  if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
    const obj = event.data.object as any;
    const balanceId = obj.metadata?.balance_id;

    if (!balanceId) {
      console.warn('Stripe webhook: no balance_id in metadata');
      return { handled: false, reason: 'no balance_id' };
    }

    const amountReceived = ((obj.amount_received ?? obj.amount) / 100);
    const paymentIntentId = obj.payment_intent || obj.id;

    await prisma.patientBalance.update({
      where: { id: balanceId },
      data: {
        amountPaid: { increment: amountReceived },
        paymentStatus: 'paid',
        stripePaymentIntentId: paymentIntentId,
        updatedAt: new Date(),
      },
    });

    console.log('Payment recorded', { balanceId, amountReceived });
    return { handled: true, balanceId, amountReceived };
  }

  // Onboarding complete
  if (event.type === 'account.updated') {
    const account = event.data.object as Stripe.Account;
    const connectRecord = await prisma.stripeConnectAccount.findUnique({
      where: { stripeAccountId: account.id },
    });
    if (connectRecord) {
      await refreshAccountStatus(connectRecord.practiceId);
    }
    return { handled: true };
  }

  return { handled: false, reason: 'unhandled event type' };
}
