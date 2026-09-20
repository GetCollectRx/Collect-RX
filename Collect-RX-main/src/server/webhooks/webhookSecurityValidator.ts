/**
 * Centralized webhook security validation and audit logging.
 *
 * Provides unified HMAC/ECDSA signature verification, timestamp validation for
 * replay attacks, idempotency checking, and comprehensive audit trail logging
 * for all incoming webhooks (Vapi, Stripe, SendGrid, GoCardless, validator).
 *
 * Security: All validation results are logged for audit and compliance.
 */

import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { logLine } from '../observability/logger.js';

export type WebhookType = 'vapi' | 'stripe' | 'sendgrid' | 'gocardless' | 'validator';
export type IdempotencyCheckResult = 'new' | 'duplicate' | 'processing' | 'processed';

export interface WebhookValidationResult {
  isValid: boolean;
  signatureValid: boolean;
  timestampValid: boolean;
  idempotencyCheck: IdempotencyCheckResult;
  error?: string;
  errorCode?: string;
  webhookId?: string;
}

export interface WebhookAuditEntry {
  webhookType: WebhookType;
  webhookId: string;
  signatureValid: boolean;
  timestampValid: boolean;
  idempotencyCheck: IdempotencyCheckResult;
  errorMessage?: string;
  httpStatusCode?: number;
  sourceIp?: string;
  requestHeaders?: Record<string, string>;
}

/**
 * Validate HMAC-SHA256 signature using timing-safe comparison.
 * Returns {isValid: boolean, signature: string}.
 */
export function validateHmacSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): { isValid: boolean; signature: string } {
  if (!signatureHeader || !secret) {
    return { isValid: false, signature: signatureHeader || '' };
  }

  try {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    const isValid = a.length === b.length && crypto.timingSafeEqual(a, b);
    return { isValid, signature: signatureHeader };
  } catch {
    return { isValid: false, signature: signatureHeader };
  }
}

/**
 * Validate Stripe webhook signature (t=timestamp,v1=signature format).
 * Returns {isValid: boolean, timestamp: number | null}.
 */
export function validateStripeSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): { isValid: boolean; timestamp: number | null; error?: string } {
  if (!signatureHeader || !secret) {
    return { isValid: false, timestamp: null, error: 'Missing signature or secret' };
  }

  try {
    const parts = signatureHeader.split(',');
    let timestamp = 0;
    let signature = '';

    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key === 't') timestamp = parseInt(value, 10);
      if (key === 'v1') signature = value;
    }

    if (!timestamp || !signature) {
      return { isValid: false, timestamp: null, error: 'Invalid signature format' };
    }

    const signedContent = `${timestamp}.${rawBody.toString('utf-8')}`;
    const computed = crypto.createHmac('sha256', secret).update(signedContent).digest('hex');

    const isValid = computed === signature;
    return { isValid, timestamp };
  } catch (err) {
    return { isValid: false, timestamp: null, error: (err as Error).message };
  }
}

/**
 * Check if Stripe webhook timestamp is recent (within 5 minutes).
 * Prevents replay attacks by rejecting old webhooks.
 */
export function isStripeTimestampValid(timestamp: number, toleranceSeconds = 300): boolean {
  if (!timestamp) return false;
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  return diff >= 0 && diff <= toleranceSeconds;
}

/**
 * Check idempotency: has this webhook ID been processed before?
 * Returns the state and whether processing should continue.
 */
export async function checkWebhookIdempotency(
  prisma: PrismaClient,
  webhookType: WebhookType,
  webhookId: string,
): Promise<IdempotencyCheckResult> {
  if (!webhookId) return 'new';

  const existing = await prisma.webhookAuditLog.findFirst({
    where: { webhookType, webhookId },
    orderBy: { createdAt: 'desc' },
  });

  if (!existing) return 'new';

  // Webhook has been seen before
  if (existing.processedAt) return 'duplicate';
  if (existing.errorMessage) return 'processed';

  // Currently being processed
  return 'processing';
}

/**
 * Log webhook attempt to audit trail.
 * Called after every webhook attempt, successful or failed.
 */
export async function logWebhookAudit(
  prisma: PrismaClient,
  entry: WebhookAuditEntry,
): Promise<void> {
  try {
    await prisma.webhookAuditLog.create({
      data: {
        webhookType: entry.webhookType,
        webhookId: entry.webhookId,
        signatureValid: entry.signatureValid,
        timestampValid: entry.timestampValid,
        idempotencyCheck: entry.idempotencyCheck,
        errorMessage: entry.errorMessage,
        httpStatusCode: entry.httpStatusCode,
        sourceIp: entry.sourceIp,
        requestHeaders: entry.requestHeaders || {},
        receivedAt: new Date(),
        processedAt: new Date(),
      },
    });
  } catch (err) {
    logLine('error', '[webhook-audit] Failed to log webhook audit entry', {
      error: String(err),
      webhookType: entry.webhookType,
      webhookId: entry.webhookId,
    });
  }
}

/**
 * Validate Vapi webhook.
 * Signature: x-vapi-signature header (sha256=<hex>)
 */
export async function validateVapiWebhook(
  prisma: PrismaClient,
  rawBody: Buffer,
  req: Request,
): Promise<WebhookValidationResult> {
  const signature = req.headers['x-vapi-signature'] as string | undefined;
  const secret = process.env.VAPI_WEBHOOK_SECRET;

  if (!signature || !secret) {
    return {
      isValid: false,
      signatureValid: false,
      timestampValid: true,
      idempotencyCheck: 'new',
      error: 'Missing signature or secret',
      errorCode: 'MISSING_SIGNATURE',
    };
  }

  const signatureParts = signature.split('=');
  const signatureValue = signatureParts.length > 1 ? signatureParts[1] : signature;
  const { isValid: signatureOk } = validateHmacSignature(rawBody, signatureValue, secret);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    return {
      isValid: false,
      signatureValid: signatureOk,
      timestampValid: true,
      idempotencyCheck: 'new',
      error: 'Invalid JSON payload',
      errorCode: 'INVALID_JSON',
    };
  }

  const webhookId = (payload as { call?: { id?: string } }).call?.id || 'unknown';
  const idempotency = await checkWebhookIdempotency(prisma, 'vapi', webhookId);

  const result: WebhookValidationResult = {
    isValid: signatureOk && idempotency === 'new',
    signatureValid: signatureOk,
    timestampValid: true,
    idempotencyCheck: idempotency,
    webhookId,
  };

  if (!signatureOk) {
    result.error = 'Invalid signature';
    result.errorCode = 'INVALID_SIGNATURE';
  }

  if (idempotency === 'duplicate') {
    result.error = 'Webhook already processed';
    result.errorCode = 'DUPLICATE_WEBHOOK';
  }

  return result;
}

/**
 * Validate Stripe webhook.
 * Signature: stripe-signature header (t=timestamp,v1=signature)
 */
export async function validateStripeWebhook(
  prisma: PrismaClient,
  rawBody: Buffer,
  req: Request,
): Promise<WebhookValidationResult> {
  const signature = req.headers['stripe-signature'] as string | undefined;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !secret) {
    return {
      isValid: false,
      signatureValid: false,
      timestampValid: true,
      idempotencyCheck: 'new',
      error: 'Missing signature or secret',
      errorCode: 'MISSING_SIGNATURE',
    };
  }

  const { isValid: signatureOk, timestamp } = validateStripeSignature(rawBody, signature, secret);
  const timestampOk = timestamp ? isStripeTimestampValid(timestamp) : false;

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    return {
      isValid: false,
      signatureValid: signatureOk,
      timestampValid: timestampOk,
      idempotencyCheck: 'new',
      error: 'Invalid JSON payload',
      errorCode: 'INVALID_JSON',
    };
  }

  const webhookId = (payload as { id?: string }).id || 'unknown';
  const idempotency = await checkWebhookIdempotency(prisma, 'stripe', webhookId);

  const result: WebhookValidationResult = {
    isValid: signatureOk && timestampOk && idempotency === 'new',
    signatureValid: signatureOk,
    timestampValid: timestampOk,
    idempotencyCheck: idempotency,
    webhookId,
  };

  if (!signatureOk) {
    result.error = 'Invalid signature';
    result.errorCode = 'INVALID_SIGNATURE';
  }

  if (!timestampOk) {
    result.error = 'Webhook timestamp invalid or too old';
    result.errorCode = 'INVALID_TIMESTAMP';
  }

  if (idempotency === 'duplicate') {
    result.error = 'Webhook already processed';
    result.errorCode = 'DUPLICATE_WEBHOOK';
  }

  return result;
}

/**
 * Validate GoCardless webhook.
 * Signature: webhook-signature header (hex-encoded HMAC-SHA256)
 */
export async function validateGoCardlessWebhook(
  prisma: PrismaClient,
  rawBody: Buffer,
  req: Request,
): Promise<WebhookValidationResult> {
  const signature = req.headers['webhook-signature'] as string | undefined;
  const secret = process.env.GOCARDLESS_WEBHOOK_SECRET;

  if (!signature || !secret) {
    return {
      isValid: false,
      signatureValid: false,
      timestampValid: true,
      idempotencyCheck: 'new',
      error: 'Missing signature or secret',
      errorCode: 'MISSING_SIGNATURE',
    };
  }

  const { isValid: signatureOk } = validateHmacSignature(rawBody, signature, secret);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    return {
      isValid: false,
      signatureValid: signatureOk,
      timestampValid: true,
      idempotencyCheck: 'new',
      error: 'Invalid JSON payload',
      errorCode: 'INVALID_JSON',
    };
  }

  // GoCardless batches can have multiple events; use first event ID as webhook ID
  const events = (payload as { events?: Array<{ id?: string }> }).events;
  const webhookId = events?.[0]?.id || 'unknown';
  const idempotency = await checkWebhookIdempotency(prisma, 'gocardless', webhookId);

  const result: WebhookValidationResult = {
    isValid: signatureOk && idempotency === 'new',
    signatureValid: signatureOk,
    timestampValid: true,
    idempotencyCheck: idempotency,
    webhookId,
  };

  if (!signatureOk) {
    result.error = 'Invalid signature';
    result.errorCode = 'INVALID_SIGNATURE';
  }

  if (idempotency === 'duplicate') {
    result.error = 'Webhook already processed';
    result.errorCode = 'DUPLICATE_WEBHOOK';
  }

  return result;
}

/**
 * Extract non-sensitive request headers for audit logging.
 * Excludes authorization headers, cookies, and signatures.
 */
export function extractAuditHeaders(req: Request): Record<string, string> {
  const allowed = ['user-agent', 'x-forwarded-for', 'x-forwarded-proto', 'content-type', 'content-length'];
  const headers: Record<string, string> = {};

  for (const name of allowed) {
    const value = req.headers[name];
    if (value) {
      headers[name] = Array.isArray(value) ? value[0] : value;
    }
  }

  return headers;
}

/**
 * Get source IP from request, respecting X-Forwarded-For when trust proxy is enabled.
 */
export function getSourceIp(req: Request): string {
  return (req.ip || req.socket?.remoteAddress || 'unknown').toString();
}
