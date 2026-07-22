/**
 * PAD mandate registration, billing pulls, and status reconciliation for
 * the GoCardless Canadian PAD integration.
 *
 * Bank details are never collected by our backend: registerPadMandate only
 * creates a bare GoCardless Billing Request, then the practice completes
 * GoCardless's own hosted Billing Request Flow (see getAuthorizationLink)
 * to enter their bank account and e-sign the PAD agreement directly with
 * GoCardless. Real webhooks (see webhooks/gocardless.ts) are the primary
 * signal for mandate activation and payment status; reconcilePending*
 * below is a periodic safety net in case a webhook delivery is missed.
 *
 * Suspension reuses the existing callsPaused/callsPausedReason gate (see
 * plans/usagePeriodService.ts) so every other part of the platform that
 * already checks that flag picks up PAD delinquency without further changes.
 */
import type { PrismaClient, PadMandate, PadTransaction, PadTransactionStatus } from '@prisma/client';
import {
  createBillingRequest,
  getBillingRequest,
  createBillingRequestFlow,
  getMandate,
  cancelMandate,
  createSubscription,
  cancelSubscription,
  getPayment,
  listPaymentsForSubscription,
  type GoCardlessPayment,
  type GoCardlessPaymentStatus,
} from './client.js';
import { sendPracticeNotification } from '../services/practiceNotificationService.js';

export const PAD_CALLS_PAUSED_REASON = 'pad_payment_failed';

export interface RegisterPadMandateInput {
  practiceId: string;
  practiceName: string;
  billingEmail: string;
  monthlyAmountCents: number;
}

/** Creates a bare GoCardless Billing Request (no bank fields) and records the pending mandate. */
export async function registerPadMandate(db: PrismaClient, input: RegisterPadMandateInput): Promise<PadMandate> {
  const existing = await db.padMandate.findUnique({ where: { practiceId: input.practiceId } });
  if (existing) {
    throw new Error(`Practice ${input.practiceId} already has a PAD mandate (${existing.id})`);
  }

  const billingRequest = await createBillingRequest({
    practiceId: input.practiceId,
    practiceName: input.practiceName,
    billingEmail: input.billingEmail,
  });

  return db.padMandate.create({
    data: {
      practiceId: input.practiceId,
      gocardlessBillingRequestId: billingRequest.id,
      monthlyAmountCents: input.monthlyAmountCents,
      status: 'pending_authorization',
    },
  });
}

/** Returns GoCardless's hosted Billing Request Flow URL for the practice to authorize bank debit. */
export async function getAuthorizationLink(db: PrismaClient, practiceId: string, redirectBaseUrl: string): Promise<string> {
  const mandate = await db.padMandate.findUniqueOrThrow({ where: { practiceId } });
  const flow = await createBillingRequestFlow({
    billingRequestId: mandate.gocardlessBillingRequestId,
    redirectUri: `${redirectBaseUrl}/billing?pad_authorized=1`,
    exitUri: `${redirectBaseUrl}/billing?pad_authorized=0`,
  });
  return flow.authorisation_url;
}

/**
 * Called once a mandate is confirmed active — via the mandates webhook
 * (action: "active") or the reconciliation poller. Creates the recurring
 * monthly subscription and activates our mandate record.
 */
export async function activateMandate(db: PrismaClient, gocardlessMandateId: string): Promise<PadMandate | null> {
  const mandate = await db.padMandate.findFirst({
    where: { gocardlessMandateId },
  });
  if (!mandate || mandate.status !== 'pending_authorization') return null;
  const remoteMandate = await getMandate(gocardlessMandateId);
  return finishActivation(db, mandate, remoteMandate.next_possible_charge_date);
}

/**
 * `earliestChargeDate` is GoCardless's own `next_possible_charge_date` on the mandate —
 * a subscription start_date before this is rejected with a 422 (confirmed against the
 * sandbox), so our pre-notification-derived date must never be earlier than it.
 */
async function finishActivation(db: PrismaClient, mandate: PadMandate, earliestChargeDate: string): Promise<PadMandate> {
  const preNotificationDate = new Date(Date.now() + mandate.preNotificationDays * 24 * 60 * 60 * 1000);
  const firstPullDate = preNotificationDate > new Date(earliestChargeDate) ? preNotificationDate : new Date(earliestChargeDate);
  const subscription = await createSubscription({
    mandateId: mandate.gocardlessMandateId as string,
    amountCents: mandate.monthlyAmountCents,
    currency: 'CAD',
    processDate: firstPullDate.toISOString().slice(0, 10),
  });
  return db.padMandate.update({
    where: { id: mandate.id },
    data: {
      status: 'active',
      gocardlessSubscriptionId: subscription.id,
      authorizedAt: new Date(),
    },
  });
}

export async function cancelPadMandate(db: PrismaClient, practiceId: string): Promise<PadMandate | null> {
  const mandate = await db.padMandate.findUnique({ where: { practiceId } });
  if (!mandate) return null;
  if (mandate.gocardlessSubscriptionId) {
    await cancelSubscription(mandate.gocardlessSubscriptionId);
  }
  if (mandate.gocardlessMandateId) {
    await cancelMandate(mandate.gocardlessMandateId);
  }
  return db.padMandate.update({
    where: { practiceId },
    data: { status: 'canceled', canceledAt: new Date() },
  });
}

/**
 * Safety-net poll for mandates still awaiting authorization: checks whether
 * the Billing Request has been fulfilled and, if so, whether the resulting
 * mandate is now active — then activates it. Real-time activation is
 * expected to arrive via the mandates webhook first; this catches any
 * missed delivery.
 */
export async function reconcilePendingAuthorizations(db: PrismaClient): Promise<{ checked: number; activated: number }> {
  const pending = await db.padMandate.findMany({ where: { status: 'pending_authorization' } });
  let activated = 0;
  for (const mandate of pending) {
    const billingRequest = await getBillingRequest(mandate.gocardlessBillingRequestId);
    if (billingRequest.status !== 'fulfilled' || !billingRequest.links.mandate_request_mandate) continue;

    const remoteMandate = await getMandate(billingRequest.links.mandate_request_mandate);
    if (remoteMandate.status !== 'active') continue;

    await db.padMandate.update({
      where: { id: mandate.id },
      data: { gocardlessCustomerId: remoteMandate.links.customer, gocardlessMandateId: remoteMandate.id },
    });
    await finishActivation(db, { ...mandate, gocardlessMandateId: remoteMandate.id }, remoteMandate.next_possible_charge_date);
    activated += 1;
  }
  return { checked: pending.length, activated };
}

function gocardlessStatusToLocal(status: GoCardlessPaymentStatus): PadTransactionStatus {
  switch (status) {
    case 'pending_customer_approval':
    case 'pending_submission':
      return 'future';
    case 'submitted':
      return 'sent_to_bank';
    case 'confirmed':
      return 'processed';
    case 'paid_out':
      return 'approved';
    case 'failed':
    case 'cancelled':
    case 'customer_approval_denied':
      return 'declined';
    case 'charged_back':
      return 'chargeback';
  }
}

export interface PadTransactionDecision {
  status: PadTransactionStatus;
  settledAt: Date | null;
  failureReason: string | null;
  suspendPractice: boolean;
  restorePractice: boolean;
}

/**
 * Pure decision function: given a GoCardless payment snapshot, what should
 * happen to our local record and the practice's access. Kept separate from
 * the Prisma writes below so it's unit-testable without a database.
 */
export function decidePadTransactionUpdate(remote: GoCardlessPayment): PadTransactionDecision {
  const status = gocardlessStatusToLocal(remote.status);
  const settledAt = status === 'approved' ? new Date(remote.charge_date) : null;
  const isFailure = status === 'declined' || status === 'chargeback';
  return {
    status,
    settledAt,
    failureReason: isFailure ? `GoCardless payment ${remote.status}` : null,
    suspendPractice: isFailure,
    restorePractice: status === 'approved',
  };
}

/**
 * Applies a GoCardless payment snapshot to our database: updates the
 * PadTransaction row, flips practice access via the shared callsPaused
 * gate, and sends a persisted notification on suspend/restore. Shared by
 * both the webhook handler and the reconciliation poller so behavior is
 * identical regardless of transport.
 */
export async function applyGoCardlessPayment(db: PrismaClient, remote: GoCardlessPayment): Promise<PadTransaction | null> {
  const local = await db.padTransaction.findUnique({ where: { gocardlessPaymentId: remote.id } });
  if (!local) return null;

  const decision = decidePadTransactionUpdate(remote);

  const updated = await db.padTransaction.update({
    where: { id: local.id },
    data: {
      status: decision.status,
      settledAt: decision.settledAt,
      failureReason: decision.failureReason,
      submittedAt: local.submittedAt ?? (decision.status !== 'future' ? new Date() : null),
    },
  });

  if (decision.suspendPractice) {
    const result = await db.practice.updateMany({
      where: { id: local.practiceId, callsPaused: false },
      data: {
        callsPaused: true,
        callsPausedReason: PAD_CALLS_PAUSED_REASON,
        callsPausedAt: new Date(),
      },
    });
    if (result.count > 0) {
      await sendPracticeNotification(db, {
        practiceId: local.practiceId,
        type: 'PAYMENT_FAILED',
        subject: 'Payment failed — calls are paused',
        message: `Your monthly payment ${decision.failureReason ?? 'was declined'}. Calls are paused until this is resolved.`,
        severity: 'critical',
      });
    }
  } else if (decision.restorePractice) {
    const result = await db.practice.updateMany({
      where: { id: local.practiceId, callsPausedReason: PAD_CALLS_PAUSED_REASON },
      data: { callsPaused: false, callsPausedReason: null, callsPausedAt: null },
    });
    if (result.count > 0) {
      await sendPracticeNotification(db, {
        practiceId: local.practiceId,
        type: 'PAYMENT_RECEIVED',
        subject: 'Payment received — calls resumed',
        message: 'Your monthly payment was approved and calls have resumed.',
        severity: 'info',
      });
    }
  }

  return updated;
}

/**
 * Safety-net poll for PadTransactions still awaiting a final status.
 * Real-time status is expected via the payments webhook first; this
 * catches any missed delivery.
 */
export async function reconcilePendingPadTransactions(db: PrismaClient): Promise<{ checked: number; updated: number }> {
  const pending = await db.padTransaction.findMany({
    where: { status: { in: ['future', 'sent_to_bank', 'processed'] } },
    include: { mandate: { select: { gocardlessSubscriptionId: true } } },
  });
  if (pending.length === 0) return { checked: 0, updated: 0 };

  const subscriptionIds = new Set(
    pending.map((p) => p.mandate.gocardlessSubscriptionId).filter((id): id is string => id !== null)
  );
  let updated = 0;
  for (const subscriptionId of subscriptionIds) {
    const payments = await listPaymentsForSubscription(subscriptionId);
    for (const payment of payments) {
      const result = await applyGoCardlessPayment(db, payment);
      if (result) updated += 1;
    }
  }
  return { checked: pending.length, updated };
}

/** Fetches a single payment by ID — used by the webhook handler for events that only carry an ID. */
export async function fetchAndApplyPayment(db: PrismaClient, paymentId: string): Promise<PadTransaction | null> {
  const payment = await getPayment(paymentId);
  return applyGoCardlessPayment(db, payment);
}
