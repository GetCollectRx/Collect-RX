/**
 * P6-03: in-process golden-signal style counters (single instance).
 * For multi-instance / p95 in prod, use your APM (Sentry) or a metrics backend.
 */

let requestCount = 0;
let error5xx = 0;
let latencySumMs = 0;
let bootedAt = new Date().toISOString();

/** Vapi webhook counters (single-process; use APM in multi-instance). */
let vapiCallEnded = 0;
let vapiDuplicateIgnored = 0;
let vapiCarrierBlock = 0;
let vapiClaimUpdated = 0;

/** EMR sync outbox drain (single-process counters). */
let emrOutboxDelivered = 0;
let emrOutboxFailed = 0;
let emrOutboxDevAck = 0;

export function markBoot(): void {
  bootedAt = new Date().toISOString();
}

export function recordHttpRequest(latencyMs: number, status: number): void {
  requestCount += 1;
  latencySumMs += latencyMs;
  if (status >= 500) {
    error5xx += 1;
  }
}

export function recordVapiWebhook(event: 'call_ended' | 'duplicate' | 'carrier_block' | 'claim_updated'): void {
  if (event === 'call_ended') vapiCallEnded += 1;
  else if (event === 'duplicate') vapiDuplicateIgnored += 1;
  else if (event === 'carrier_block') vapiCarrierBlock += 1;
  else if (event === 'claim_updated') vapiClaimUpdated += 1;
}

export function recordEmrOutbox(event: 'delivered' | 'failed' | 'dev_ack'): void {
  if (event === 'delivered') emrOutboxDelivered += 1;
  else if (event === 'failed') emrOutboxFailed += 1;
  else if (event === 'dev_ack') emrOutboxDevAck += 1;
}

/** Non-secret flags for `/api/health/metrics` (ops dashboards; not a substitute for real APM). */
function deploymentSnapshot() {
  const redisUrlSet = Boolean((process.env.REDIS_URL || '').trim());
  const schedulerDisabled =
    process.env.DISABLE_SCHEDULER === '1' || process.env.DISABLE_SCHEDULER === 'true';
  const emrWebhookConfigured = Boolean((process.env.EMR_SYNC_WEBHOOK_URL || '').trim());
  const emrOutboxDevAck =
    process.env.EMR_OUTBOX_DEV_ACK === '1' || process.env.EMR_OUTBOX_DEV_ACK === 'true';
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    redisUrlSet,
    schedulerDisabled,
    bullWorkerExpected: redisUrlSet && !schedulerDisabled,
    emrWebhookConfigured,
    emrOutboxDevAck,
    vapiWebhookSecretSet: Boolean((process.env.VAPI_WEBHOOK_SECRET || '').trim()),
    sendgridVerifyKeySet: Boolean((process.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY || '').trim()),
  };
}

export function getMetrics() {
  const avgLatencyMs = requestCount ? Math.round(latencySumMs / requestCount) : 0;
  return {
    http: {
      requests: requestCount,
      errors5xx: error5xx,
      avgLatencyMs,
    },
    vapi: {
      callEnded: vapiCallEnded,
      duplicateIgnored: vapiDuplicateIgnored,
      carrierBlock: vapiCarrierBlock,
      claimUpdated: vapiClaimUpdated,
    },
    emrOutbox: {
      delivered: emrOutboxDelivered,
      failed: emrOutboxFailed,
      devAck: emrOutboxDevAck,
    },
    deployment: deploymentSnapshot(),
    bootedAt,
    processUptimeSec: Math.floor(process.uptime()),
  };
}
