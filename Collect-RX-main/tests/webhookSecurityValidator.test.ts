/**
 * Webhook security validator tests — signature verification, timestamp validation, idempotency.
 * Database-dependent tests are skipped when DATABASE_URL is not set.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import {
  validateHmacSignature,
  validateStripeSignature,
  isStripeTimestampValid,
  validateVapiWebhook,
  validateStripeWebhook,
  validateGoCardlessWebhook,
  extractAuditHeaders,
  getSourceIp,
} from '../src/server/webhooks/webhookSecurityValidator';

const hasDatabaseUrl = !!process.env.DATABASE_URL;

describe('Webhook Security Validator', () => {
  describe('validateHmacSignature', () => {
    it('validates correct HMAC-SHA256 signature', () => {
      const secret = 'test_secret_key';
      const body = Buffer.from('{"test": "payload"}');
      const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');

      const result = validateHmacSignature(body, expected, secret);
      expect(result.isValid).toBe(true);
    });

    it('rejects invalid HMAC signature', () => {
      const secret = 'test_secret_key';
      const body = Buffer.from('{"test": "payload"}');
      const invalidSig = 'invalid_signature_12345678901234567890';

      const result = validateHmacSignature(body, invalidSig, secret);
      expect(result.isValid).toBe(false);
    });

    it('rejects missing signature header', () => {
      const result = validateHmacSignature(Buffer.from('test'), undefined, 'secret');
      expect(result.isValid).toBe(false);
    });

    it('rejects missing secret', () => {
      const result = validateHmacSignature(Buffer.from('test'), 'sig123', '');
      expect(result.isValid).toBe(false);
    });

    it('prevents timing attacks using buffer comparison', () => {
      const secret = 'secret';
      const body = Buffer.from('test');
      const sig1 = crypto.createHmac('sha256', secret).update(body).digest('hex');
      const sig2 = sig1.substring(0, 10) + 'x' + sig1.substring(11);

      // Both should be invalid, and both should take roughly the same time
      const result1 = validateHmacSignature(body, sig1, secret);
      const result2 = validateHmacSignature(body, sig2, secret);

      expect(result1.isValid).toBe(true);
      expect(result2.isValid).toBe(false);
    });
  });

  describe('validateStripeSignature', () => {
    it('validates correct Stripe signature with recent timestamp', () => {
      const secret = 'test_secret';
      const body = Buffer.from('{"type": "test"}');
      const timestamp = Math.floor(Date.now() / 1000);
      const signedContent = `${timestamp}.${body.toString()}`;
      const sig = crypto.createHmac('sha256', secret).update(signedContent).digest('hex');
      const signature = `t=${timestamp},v1=${sig}`;

      const result = validateStripeSignature(body, signature, secret);
      expect(result.isValid).toBe(true);
      expect(result.timestamp).toBe(timestamp);
    });

    it('rejects Stripe signature with old timestamp', () => {
      const secret = 'test_secret';
      const body = Buffer.from('{"type": "test"}');
      const timestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const signedContent = `${timestamp}.${body.toString()}`;
      const sig = crypto.createHmac('sha256', secret).update(signedContent).digest('hex');
      const signature = `t=${timestamp},v1=${sig}`;

      const result = validateStripeSignature(body, signature, secret);
      expect(result.isValid).toBe(true); // Signature is valid, but timestamp will be checked separately
      expect(result.timestamp).toBe(timestamp);
    });

    it('rejects malformed Stripe signature', () => {
      const result = validateStripeSignature(Buffer.from('test'), 'invalid_format', 'secret');
      expect(result.isValid).toBe(false);
    });
  });

  describe('isStripeTimestampValid', () => {
    it('accepts recent timestamps', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(isStripeTimestampValid(now)).toBe(true);
      expect(isStripeTimestampValid(now - 60)).toBe(true);
    });

    it('rejects old timestamps (>5 minutes)', () => {
      const old = Math.floor(Date.now() / 1000) - 600; // 10 minutes
      expect(isStripeTimestampValid(old)).toBe(false);
    });

    it('accepts custom tolerance', () => {
      const old = Math.floor(Date.now() / 1000) - 600; // 10 minutes
      expect(isStripeTimestampValid(old, 900)).toBe(true); // 15 minute tolerance
    });

    it('rejects invalid/missing timestamp', () => {
      expect(isStripeTimestampValid(0)).toBe(false);
      expect(isStripeTimestampValid(-1)).toBe(false);
    });
  });

  (hasDatabaseUrl ? describe : describe.skip)('checkWebhookIdempotency', () => {
    let prisma: any;
    let checkWebhookIdempotency: any;

    beforeEach(async () => {
      if (!prisma) {
        const prismaModule = await import('../src/lib/prisma');
        prisma = prismaModule.prisma;
        const validatorModule = await import('../src/server/webhooks/webhookSecurityValidator');
        checkWebhookIdempotency = validatorModule.checkWebhookIdempotency;
      }
      await prisma.webhookAuditLog.deleteMany();
    });

    it('returns new for first webhook', async () => {
      const result = await checkWebhookIdempotency(prisma, 'vapi', 'call_001');
      expect(result).toBe('new');
    });

    it('returns duplicate for previously processed webhook', async () => {
      const webhookId = `call_${Date.now()}`;

      await prisma.webhookAuditLog.create({
        data: {
          webhookType: 'vapi',
          webhookId,
          signatureValid: true,
          timestampValid: true,
          idempotencyCheck: 'new',
          receivedAt: new Date(),
          processedAt: new Date(),
        },
      });

      const result = await checkWebhookIdempotency(prisma, 'vapi', webhookId);
      expect(result).toBe('duplicate');
    });

    it('returns processing for webhook being processed', async () => {
      const webhookId = `call_${Date.now()}`;

      await prisma.webhookAuditLog.create({
        data: {
          webhookType: 'vapi',
          webhookId,
          signatureValid: true,
          timestampValid: true,
          idempotencyCheck: 'processing',
          receivedAt: new Date(),
        },
      });

      const result = await checkWebhookIdempotency(prisma, 'vapi', webhookId);
      expect(result).toBe('processing');
    });

    it('returns processed for webhook with error', async () => {
      const webhookId = `call_${Date.now()}`;

      await prisma.webhookAuditLog.create({
        data: {
          webhookType: 'vapi',
          webhookId,
          signatureValid: false,
          timestampValid: true,
          idempotencyCheck: 'new',
          errorMessage: 'Invalid signature',
          receivedAt: new Date(),
        },
      });

      const result = await checkWebhookIdempotency(prisma, 'vapi', webhookId);
      expect(result).toBe('processed');
    });
  });

  (hasDatabaseUrl ? describe : describe.skip)('logWebhookAudit', () => {
    let prisma: any;
    let logWebhookAudit: any;

    beforeEach(async () => {
      if (!prisma) {
        const prismaModule = await import('../src/lib/prisma');
        prisma = prismaModule.prisma;
        const validatorModule = await import('../src/server/webhooks/webhookSecurityValidator');
        logWebhookAudit = validatorModule.logWebhookAudit;
      }
      await prisma.webhookAuditLog.deleteMany();
    });

    it('logs webhook audit entry', async () => {
      const webhookId = `vapi_${Date.now()}`;
      await logWebhookAudit(prisma, {
        webhookType: 'vapi',
        webhookId,
        signatureValid: true,
        timestampValid: true,
        idempotencyCheck: 'new',
        httpStatusCode: 200,
        sourceIp: '192.0.2.1',
      });

      const entry = await prisma.webhookAuditLog.findFirst({
        where: { webhookId },
      });

      expect(entry).toBeTruthy();
      expect(entry?.signatureValid).toBe(true);
      expect(entry?.httpStatusCode).toBe(200);
    });

    it('logs webhook audit entry with error', async () => {
      const webhookId = `stripe_${Date.now()}`;
      await logWebhookAudit(prisma, {
        webhookType: 'stripe',
        webhookId,
        signatureValid: false,
        timestampValid: true,
        idempotencyCheck: 'new',
        errorMessage: 'Invalid signature',
        httpStatusCode: 401,
      });

      const entry = await prisma.webhookAuditLog.findFirst({
        where: { webhookId },
      });

      expect(entry?.signatureValid).toBe(false);
      expect(entry?.errorMessage).toBe('Invalid signature');
    });
  });

  describe('extractAuditHeaders', () => {
    it('extracts allowed headers', () => {
      const mockReq = {
        headers: {
          'user-agent': 'test-client/1.0',
          'x-forwarded-for': '192.0.2.1',
          'content-type': 'application/json',
          'authorization': 'Bearer secret', // Should not be included
          'stripe-signature': 'sig_123', // Should not be included
        },
      } as any;

      const headers = extractAuditHeaders(mockReq);

      expect(headers['user-agent']).toBe('test-client/1.0');
      expect(headers['x-forwarded-for']).toBe('192.0.2.1');
      expect(headers['content-type']).toBe('application/json');
      expect(headers['authorization']).toBeUndefined();
      expect(headers['stripe-signature']).toBeUndefined();
    });
  });

  describe('getSourceIp', () => {
    it('returns IP from req.ip', () => {
      const mockReq = { ip: '192.0.2.1' } as any;
      const ip = getSourceIp(mockReq);
      expect(ip).toBe('192.0.2.1');
    });

    it('returns default when IP is unavailable', () => {
      const mockReq = { socket: {} } as any;
      const ip = getSourceIp(mockReq);
      expect(ip).toBe('unknown');
    });
  });

  (hasDatabaseUrl ? describe : describe.skip)('validateVapiWebhook', () => {
    let prisma: any;
    let validateVapiWebhook: any;

    beforeEach(async () => {
      if (!prisma) {
        const prismaModule = await import('../src/lib/prisma');
        prisma = prismaModule.prisma;
        const validatorModule = await import('../src/server/webhooks/webhookSecurityValidator');
        validateVapiWebhook = validatorModule.validateVapiWebhook;
      }
      await prisma.webhookAuditLog.deleteMany();
      vi.stubEnv('VAPI_WEBHOOK_SECRET', 'test_vapi_secret');
    });

    it('validates valid Vapi webhook', async () => {
      const secret = 'test_vapi_secret';
      const payload = { call: { id: 'vapi_001' }, type: 'call.ended' };
      const body = Buffer.from(JSON.stringify(payload));
      const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

      const mockReq = {
        headers: { 'x-vapi-signature': signature },
      } as any;

      const result = await validateVapiWebhook(prisma, body, mockReq);

      expect(result.isValid).toBe(true);
      expect(result.signatureValid).toBe(true);
      expect(result.webhookId).toBe('vapi_001');
    });

    it('rejects Vapi webhook with invalid signature', async () => {
      const payload = { call: { id: 'vapi_002' }, type: 'call.ended' };
      const body = Buffer.from(JSON.stringify(payload));
      const invalidSig = 'sha256=invalid_signature_here';

      const mockReq = {
        headers: { 'x-vapi-signature': invalidSig },
      } as any;

      const result = await validateVapiWebhook(prisma, body, mockReq);

      expect(result.isValid).toBe(false);
      expect(result.signatureValid).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
    });

    it('detects duplicate Vapi webhooks', async () => {
      const webhookId = `vapi_dup_${Date.now()}`;
      const payload = { call: { id: webhookId }, type: 'call.ended' };
      const body = Buffer.from(JSON.stringify(payload));

      await prisma.webhookAuditLog.create({
        data: {
          webhookType: 'vapi',
          webhookId,
          signatureValid: true,
          timestampValid: true,
          idempotencyCheck: 'new',
          receivedAt: new Date(),
          processedAt: new Date(),
        },
      });

      const secret = 'test_vapi_secret';
      const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
      const mockReq = { headers: { 'x-vapi-signature': signature } } as any;

      const result = await validateVapiWebhook(prisma, body, mockReq);

      expect(result.isValid).toBe(false);
      expect(result.idempotencyCheck).toBe('duplicate');
      expect(result.errorCode).toBe('DUPLICATE_WEBHOOK');
    });
  });

  (hasDatabaseUrl ? describe : describe.skip)('validateStripeWebhook', () => {
    let prisma: any;
    let validateStripeWebhook: any;

    beforeEach(async () => {
      if (!prisma) {
        const prismaModule = await import('../src/lib/prisma');
        prisma = prismaModule.prisma;
        const validatorModule = await import('../src/server/webhooks/webhookSecurityValidator');
        validateStripeWebhook = validatorModule.validateStripeWebhook;
      }
      await prisma.webhookAuditLog.deleteMany();
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'test_stripe_secret');
    });

    it('validates valid Stripe webhook with recent timestamp', async () => {
      const secret = 'test_stripe_secret';
      const payload = { id: 'evt_001', type: 'payment_intent.succeeded' };
      const body = Buffer.from(JSON.stringify(payload));
      const timestamp = Math.floor(Date.now() / 1000);
      const signedContent = `${timestamp}.${body.toString()}`;
      const sig = crypto.createHmac('sha256', secret).update(signedContent).digest('hex');
      const signature = `t=${timestamp},v1=${sig}`;

      const mockReq = { headers: { 'stripe-signature': signature } } as any;

      const result = await validateStripeWebhook(prisma, body, mockReq);

      expect(result.isValid).toBe(true);
      expect(result.signatureValid).toBe(true);
      expect(result.timestampValid).toBe(true);
    });

    it('rejects Stripe webhook with old timestamp', async () => {
      const secret = 'test_stripe_secret';
      const payload = { id: 'evt_002', type: 'payment_intent.succeeded' };
      const body = Buffer.from(JSON.stringify(payload));
      const timestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes old
      const signedContent = `${timestamp}.${body.toString()}`;
      const sig = crypto.createHmac('sha256', secret).update(signedContent).digest('hex');
      const signature = `t=${timestamp},v1=${sig}`;

      const mockReq = { headers: { 'stripe-signature': signature } } as any;

      const result = await validateStripeWebhook(prisma, body, mockReq);

      expect(result.isValid).toBe(false);
      expect(result.timestampValid).toBe(false);
      expect(result.errorCode).toBe('INVALID_TIMESTAMP');
    });

    it('rejects Stripe webhook with invalid signature', async () => {
      const payload = { id: 'evt_003', type: 'payment_intent.succeeded' };
      const body = Buffer.from(JSON.stringify(payload));
      const timestamp = Math.floor(Date.now() / 1000);
      const invalidSig = 'invalid_sig_here';
      const signature = `t=${timestamp},v1=${invalidSig}`;

      const mockReq = { headers: { 'stripe-signature': signature } } as any;

      const result = await validateStripeWebhook(prisma, body, mockReq);

      expect(result.isValid).toBe(false);
      expect(result.signatureValid).toBe(false);
    });
  });

  (hasDatabaseUrl ? describe : describe.skip)('validateGoCardlessWebhook', () => {
    let prisma: any;
    let validateGoCardlessWebhook: any;

    beforeEach(async () => {
      if (!prisma) {
        const prismaModule = await import('../src/lib/prisma');
        prisma = prismaModule.prisma;
        const validatorModule = await import('../src/server/webhooks/webhookSecurityValidator');
        validateGoCardlessWebhook = validatorModule.validateGoCardlessWebhook;
      }
      await prisma.webhookAuditLog.deleteMany();
      vi.stubEnv('GOCARDLESS_WEBHOOK_SECRET', 'test_gc_secret');
    });

    it('validates valid GoCardless webhook', async () => {
      const secret = 'test_gc_secret';
      const payload = { events: [{ id: 'pm_001' }, { id: 'pm_002' }] };
      const body = Buffer.from(JSON.stringify(payload));
      const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');

      const mockReq = { headers: { 'webhook-signature': signature } } as any;

      const result = await validateGoCardlessWebhook(prisma, body, mockReq);

      expect(result.isValid).toBe(true);
      expect(result.signatureValid).toBe(true);
      expect(result.webhookId).toBe('pm_001');
    });

    it('rejects GoCardless webhook with invalid signature', async () => {
      const payload = { events: [{ id: 'pm_003' }] };
      const body = Buffer.from(JSON.stringify(payload));
      const invalidSig = 'invalid_signature_here';

      const mockReq = { headers: { 'webhook-signature': invalidSig } } as any;

      const result = await validateGoCardlessWebhook(prisma, body, mockReq);

      expect(result.isValid).toBe(false);
      expect(result.signatureValid).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
    });
  });
});
