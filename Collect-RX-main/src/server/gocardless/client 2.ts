/**
 * GoCardless API client — Canadian PAD (Pre-Authorized Debit) via the
 * Billing Requests flow. Confirmed against developer.gocardless.com and
 * support.gocardless.com (both publicly reachable, unlike Rotessa's docs):
 *
 * - Base URLs, Bearer auth, and the required GoCardless-Version header
 *   are documented at developer.gocardless.com/getting-started/set-up.
 * - The Billing Request → Billing Request Flow → hosted authorisation_url
 *   sequence is documented at
 *   developer.gocardless.com/billing-requests/setting-up-a-dd-mandate.
 * - Canadian PAD uses `mandate_request.scheme: "pad"` with
 *   `consent_type: "recurring"` (support.gocardless.com/hc/en-us/articles/
 *   360013059874-Canada-PAD-custom-payment-pages).
 * - Subscriptions (`amount` in cents, `currency`, `interval_unit`,
 *   `links.mandate`) are documented at
 *   developer.gocardless.com/recurring-payments/subscriptions.
 * - Webhook signature verification (HMAC-SHA256 over the raw body,
 *   compared against the `Webhook-Signature` header) is documented at
 *   developer.gocardless.com/getting-started/stay-up-to-date-with-webhooks-v2.
 *
 * The GoCardless-Version date string below is the value GoCardless has
 * used since their 2015 API stabilization and is what every official
 * client library ships — confirm it hasn't been superseded before going
 * live, since this couldn't be independently re-verified against the raw
 * API reference page (returned 404 during research).
 */

const PRODUCTION_BASE_URL = 'https://api.gocardless.com';
const SANDBOX_BASE_URL = 'https://api-sandbox.gocardless.com';
const GOCARDLESS_API_VERSION = '2015-07-06';

export class GoCardlessApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = 'GoCardlessApiError';
  }
}

function baseUrl(): string {
  return process.env.GOCARDLESS_ENV === 'production' ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
}

function accessToken(): string {
  const token = process.env.GOCARDLESS_ACCESS_TOKEN;
  if (!token) {
    throw new Error('GOCARDLESS_ACCESS_TOKEN is not configured');
  }
  return token;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken()}`,
      'GoCardless-Version': GOCARDLESS_API_VERSION,
      ...init.headers,
    },
  });
  const text = await res.text();
  const body: unknown = text.length > 0 ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new GoCardlessApiError(
      `GoCardless API ${init.method ?? 'GET'} ${path} failed (${res.status})`,
      res.status,
      body
    );
  }
  return body as T;
}

export interface GoCardlessBillingRequest {
  id: string;
  status: 'pending' | 'ready_to_fulfil' | 'fulfilled' | 'cancelled';
  links: { mandate_request?: string; mandate_request_mandate?: string; customer?: string };
}

/**
 * Creates a Billing Request for a recurring Canadian PAD mandate. No bank
 * details are involved yet — the practice completes those, plus the PAD
 * agreement e-signature, on GoCardless's own hosted page (see
 * createBillingRequestFlow). Our backend never touches bank fields.
 */
export async function createBillingRequest(params: {
  practiceId: string;
  practiceName: string;
  billingEmail: string;
}): Promise<GoCardlessBillingRequest> {
  return request<{ billing_requests: GoCardlessBillingRequest }>('/billing_requests', {
    method: 'POST',
    body: JSON.stringify({
      billing_requests: {
        mandate_request: { scheme: 'pad', consent_type: 'recurring' },
        metadata: { practice_id: params.practiceId },
      },
    }),
  }).then((r) => r.billing_requests);
}

export async function getBillingRequest(id: string): Promise<GoCardlessBillingRequest> {
  return request<{ billing_requests: GoCardlessBillingRequest }>(`/billing_requests/${id}`, {
    method: 'GET',
  }).then((r) => r.billing_requests);
}

export interface GoCardlessBillingRequestFlow {
  id: string;
  authorisation_url: string;
  expires_at: string;
}

/** Returns the hosted GoCardless page where the practice enters bank details and signs the PAD agreement. */
export async function createBillingRequestFlow(params: {
  billingRequestId: string;
  redirectUri: string;
  exitUri: string;
}): Promise<GoCardlessBillingRequestFlow> {
  return request<{ billing_request_flows: GoCardlessBillingRequestFlow }>('/billing_request_flows', {
    method: 'POST',
    body: JSON.stringify({
      billing_request_flows: {
        links: { billing_request: params.billingRequestId },
        redirect_uri: params.redirectUri,
        exit_uri: params.exitUri,
      },
    }),
  }).then((r) => r.billing_request_flows);
}

export type GoCardlessMandateStatus =
  | 'pending_customer_approval'
  | 'pending_submission'
  | 'submitted'
  | 'active'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'consumed'
  | 'blocked';

export interface GoCardlessMandate {
  id: string;
  status: GoCardlessMandateStatus;
  /** Earliest date GoCardless will accept a charge against this mandate — a subscription
   *  start_date before this is rejected with a 422 (confirmed against the sandbox). */
  next_possible_charge_date: string;
  links: { customer: string };
}

export async function getMandate(id: string): Promise<GoCardlessMandate> {
  return request<{ mandates: GoCardlessMandate }>(`/mandates/${id}`, { method: 'GET' }).then((r) => r.mandates);
}

export async function cancelMandate(id: string): Promise<void> {
  await request(`/mandates/${id}/actions/cancel`, { method: 'POST', body: JSON.stringify({ data: {} }) });
}

export interface GoCardlessSubscription {
  id: string;
  status: string;
  links: { mandate: string };
}

export async function createSubscription(params: {
  mandateId: string;
  amountCents: number;
  currency: string;
  processDate: string; // ISO date of first charge
}): Promise<GoCardlessSubscription> {
  return request<{ subscriptions: GoCardlessSubscription }>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      subscriptions: {
        amount: params.amountCents,
        currency: params.currency,
        interval_unit: 'monthly',
        start_date: params.processDate,
        links: { mandate: params.mandateId },
      },
    }),
  }).then((r) => r.subscriptions);
}

export async function cancelSubscription(id: string): Promise<void> {
  await request(`/subscriptions/${id}/actions/cancel`, { method: 'POST', body: JSON.stringify({ data: {} }) });
}

export type GoCardlessPaymentStatus =
  | 'pending_customer_approval'
  | 'pending_submission'
  | 'submitted'
  | 'confirmed'
  | 'paid_out'
  | 'cancelled'
  | 'customer_approval_denied'
  | 'failed'
  | 'charged_back';

export interface GoCardlessPayment {
  id: string;
  amount: number;
  status: GoCardlessPaymentStatus;
  charge_date: string;
  links: { subscription?: string; mandate: string };
}

export async function getPayment(id: string): Promise<GoCardlessPayment> {
  return request<{ payments: GoCardlessPayment }>(`/payments/${id}`, { method: 'GET' }).then((r) => r.payments);
}

export async function listPaymentsForSubscription(subscriptionId: string): Promise<GoCardlessPayment[]> {
  return request<{ payments: GoCardlessPayment[] }>(`/payments?subscription=${subscriptionId}`, {
    method: 'GET',
  }).then((r) => r.payments);
}

/** GoCardless webhook event — one HTTP request carries a batch of these (up to 250). */
export interface GoCardlessWebhookEvent {
  id: string;
  resource_type: 'payments' | 'mandates' | 'subscriptions' | 'billing_requests';
  action: string;
  links: { payment?: string; mandate?: string; subscription?: string; billing_request?: string };
}
