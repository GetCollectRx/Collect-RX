# Webhook Signature Validation & Security Audit Trail

**Status**: Security Audit Finding #9 — Implemented August 15, 2026

This document describes the centralized webhook security validation framework and comprehensive audit logging for all incoming webhooks (Vapi, Stripe, SendGrid, GoCardless, Validator).

## Overview

CollectRx processes webhooks from five external services. Each requires signature verification to prevent forged events and replay attacks:

| Service    | Signature Method | Timestamp Check | Idempotency | Status |
|-----------|------------------|-----------------|-------------|--------|
| Vapi      | HMAC-SHA256      | No              | Body hash   | ✓ Active |
| Stripe    | HMAC-SHA256      | Yes (5 min)     | Event ID    | ✓ Active |
| SendGrid  | ECDSA-P256       | No              | None*       | ✓ Active |
| GoCardless| HMAC-SHA256      | No              | Event ID    | ✓ Active |
| Validator | HMAC-SHA256      | No              | Body hash   | ✓ Active |

*SendGrid webhooks are processed in batches with individual event-level handling; duplicate protection happens at the event level via prospect/campaign tracking.

## Centralized Validation Framework

### `webhookSecurityValidator.ts`

The main validation utility provides:

1. **HMAC-SHA256 Validation** (`validateHmacSignature()`)
   - Timing-safe buffer comparison to prevent timing attacks
   - Returns boolean + signature for audit logging

2. **Stripe Signature Validation** (`validateStripeSignature()`)
   - Parses `t=timestamp,v1=signature` format
   - Extracts and validates timestamp
   - Returns signature + timestamp validity

3. **Timestamp Validation** (`isStripeTimestampValid()`)
   - Rejects webhooks older than 5 minutes (configurable)
   - Prevents replay attacks
   - Used exclusively for Stripe; other services may add later

4. **Idempotency Checking** (`checkWebhookIdempotency()`)
   - Queries `WebhookAuditLog` for prior attempts
   - Returns state: `new`, `duplicate`, `processing`, `processed`
   - Prevents double-processing of identical events

5. **Service-Specific Validators**
   - `validateVapiWebhook()` — Full Vapi validation flow
   - `validateStripeWebhook()` — Full Stripe validation flow
   - `validateGoCardlessWebhook()` — Full GoCardless validation flow

6. **Audit Logging** (`logWebhookAudit()`)
   - Records every validation attempt to `WebhookAuditLog` table
   - Captures: signature validity, timestamp, idempotency state, errors, HTTP status, source IP

7. **Request Inspection**
   - `extractAuditHeaders()` — Extracts safe headers for audit (excludes auth)
   - `getSourceIp()` — Resolves client IP respecting proxy headers

## Database Schema

### `WebhookAuditLog` Table

```sql
CREATE TABLE "webhook_audit_logs" (
  id                   TEXT          PRIMARY KEY,
  webhook_type         TEXT NOT NULL, -- vapi, stripe, sendgrid, gocardless, validator
  webhook_id           TEXT NOT NULL, -- vendor event ID
  signature_valid      BOOLEAN NOT NULL,
  timestamp_valid      BOOLEAN NOT NULL DEFAULT true,
  idempotency_check    TEXT NOT NULL, -- new, duplicate, processing, processed
  error_message        TEXT,
  http_status_code     INTEGER,
  source_ip            TEXT,
  request_headers      JSONB,
  received_at          TIMESTAMP,
  processed_at         TIMESTAMP,
  created_at           TIMESTAMP
);

-- Indexes for fast audit queries
CREATE INDEX idx_webhook_audit_logs_type
CREATE INDEX idx_webhook_audit_logs_webhook_id
CREATE INDEX idx_webhook_audit_logs_signature_valid
CREATE INDEX idx_webhook_audit_logs_type_created
```

**Compliance**: No webhook payloads, signatures, or raw bodies are stored — only audit metadata for compliance and debugging.

## Integration Points

### Vapi Webhook (`src/webhooks/vapi.ts`)

Current state: Already implements HMAC-SHA256 validation + body hash idempotency.

**To integrate centralized validator:**
```typescript
import { validateVapiWebhook, logWebhookAudit, extractAuditHeaders, getSourceIp } from '../server/webhooks/webhookSecurityValidator';

router.post('/', async (req: Request, res: Response) => {
  const rawBody = req.body as Buffer;
  
  const validation = await validateVapiWebhook(prisma, rawBody, req);
  
  await logWebhookAudit(prisma, {
    webhookType: 'vapi',
    webhookId: validation.webhookId || 'unknown',
    signatureValid: validation.signatureValid,
    timestampValid: validation.timestampValid,
    idempotencyCheck: validation.idempotencyCheck,
    errorMessage: validation.error,
    httpStatusCode: validation.isValid ? 200 : 401,
    sourceIp: getSourceIp(req),
    requestHeaders: extractAuditHeaders(req),
  });
  
  if (!validation.isValid) {
    return res.status(401).json({ error: validation.error });
  }
  
  // Continue processing...
});
```

### Stripe Webhook (`src/server/routes/stripeApiRoutes.ts`)

Current state: Uses Stripe SDK's built-in `constructEvent()` which validates signature and timestamp.

**To integrate centralized validator for audit trail:**
```typescript
import { logWebhookAudit, extractAuditHeaders, getSourceIp } from '../webhooks/webhookSecurityValidator';

export function stripeWebhookHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response) => {
    const sig = req.headers['stripe-signature'];
    if (!sig) {
      await logWebhookAudit(prisma, {
        webhookType: 'stripe',
        webhookId: 'unknown',
        signatureValid: false,
        timestampValid: false,
        idempotencyCheck: 'new',
        errorMessage: 'Missing signature header',
        httpStatusCode: 400,
        sourceIp: getSourceIp(req),
        requestHeaders: extractAuditHeaders(req),
      });
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }
    
    // Existing Stripe SDK validation
    // ... then log success:
    await logWebhookAudit(prisma, {
      webhookType: 'stripe',
      webhookId: event.id,
      signatureValid: true,
      timestampValid: true,
      idempotencyCheck: 'new', // Stripe SDK handles duplicates internally
      httpStatusCode: 200,
      sourceIp: getSourceIp(req),
      requestHeaders: extractAuditHeaders(req),
    });
  };
}
```

### GoCardless Webhook (`src/server/webhooks/gocardless.ts`)

Current state: Already implements HMAC-SHA256 validation + event ID idempotency.

**Already mostly compatible; add audit logging:**
```typescript
import { logWebhookAudit, extractAuditHeaders, getSourceIp } from './webhookSecurityValidator';

export function gocardlessWebhookHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response) => {
    // ... existing validation
    
    if (!verifySignature(...)) {
      await logWebhookAudit(prisma, {
        webhookType: 'gocardless',
        webhookId: 'unknown',
        signatureValid: false,
        timestampValid: true,
        idempotencyCheck: 'new',
        errorMessage: 'Invalid signature',
        httpStatusCode: 401,
        sourceIp: getSourceIp(req),
      });
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // Process events and log success
  };
}
```

### SendGrid Webhook (`src/server/sendgrid/handleSendgridEventWebhook.ts`)

Current state: Uses SendGrid SDK's ECDSA signature verification.

**Add audit logging:**
```typescript
import { logWebhookAudit, extractAuditHeaders, getSourceIp } from '../webhooks/webhookSecurityValidator';

export function makeSendgridEventWebhookHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response) => {
    // ... existing ECDSA validation
    
    if (!ewh.verifySignature(...)) {
      await logWebhookAudit(prisma, {
        webhookType: 'sendgrid',
        webhookId: 'batch_unknown',
        signatureValid: false,
        timestampValid: true,
        idempotencyCheck: 'new',
        errorMessage: 'ECDSA verification failed',
        httpStatusCode: 401,
        sourceIp: getSourceIp(req),
      });
      return res.status(401).send('invalid signature');
    }
    
    // Process events and log
    for (const rawEvent of batchParsed.data) {
      await logWebhookAudit(prisma, {
        webhookType: 'sendgrid',
        webhookId: rawEvent.sg_message_id || `batch_${Date.now()}`,
        signatureValid: true,
        timestampValid: true,
        idempotencyCheck: 'new',
        httpStatusCode: 200,
        sourceIp: getSourceIp(req),
      });
      // Process event...
    }
  };
}
```

## Deployment & Migration

1. **Run Migration**
   ```bash
   npm run db:migrate:collectrx
   # or
   npx prisma migrate deploy
   ```

2. **Run Tests**
   ```bash
   npm run test:webhooks
   # or
   npx vitest run tests/webhookSecurityValidator.test.ts
   ```

3. **Monitor Audit Trail**
   ```sql
   -- Check webhook validation success rate
   SELECT webhook_type, COUNT(*) as total, 
          SUM(CASE WHEN signature_valid THEN 1 ELSE 0 END) as valid_sig
   FROM webhook_audit_logs
   WHERE created_at > NOW() - INTERVAL '1 hour'
   GROUP BY webhook_type;
   
   -- Find failed validations
   SELECT * FROM webhook_audit_logs 
   WHERE signature_valid = false OR idempotency_check = 'duplicate'
   ORDER BY created_at DESC LIMIT 50;
   
   -- Audit by source IP
   SELECT source_ip, webhook_type, COUNT(*) as count
   FROM webhook_audit_logs
   WHERE created_at > NOW() - INTERVAL '24 hours'
   GROUP BY source_ip, webhook_type;
   ```

## Security Best Practices

### Signature Verification

- **Always use timing-safe comparison** (`crypto.timingSafeEqual()`) to prevent timing attacks
- **Never log signatures** — only the validation result
- **Require secrets in production** — server should refuse to start without `VAPI_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`, etc.

### Timestamp Validation

- **Stripe webhooks**: Reject if > 5 minutes old (prevents replay attacks)
- **Future webhook types**: Consider adding per-service timestamp checks (GoCardless, Vapi may benefit)

### Idempotency

- **Vapi**: Use body hash (full webhook body rarely repeats)
- **Stripe**: Use event ID (webhooks may be replayed with identical content)
- **GoCardless**: Use event ID (batch webhooks contain multiple distinct events)
- **SendGrid**: Use `sg_message_id` per event (sent within batch)

### Audit Trail

- **Comprehensive logging**: Every webhook attempt is logged, successful or failed
- **No sensitive data**: Audit logs contain only validation metadata, never payloads
- **Retention**: Keep audit logs for 90+ days for compliance
- **Alerts**: Set up monitoring for high rates of failed signature validation (possible attack)

## Monitoring & Alerts

### Key Metrics

```sql
-- Webhook validation failure rate
SELECT webhook_type, 
       COUNT(*) as total,
       SUM(CASE WHEN NOT signature_valid THEN 1 ELSE 0 END) as failed_sig,
       ROUND(100.0 * SUM(CASE WHEN NOT signature_valid THEN 1 ELSE 0 END) / COUNT(*), 2) as failure_rate_pct
FROM webhook_audit_logs
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY webhook_type;

-- Duplicate webhook detection
SELECT webhook_type, COUNT(DISTINCT webhook_id) as unique_webhooks, COUNT(*) as total_attempts
FROM webhook_audit_logs
WHERE idempotency_check = 'duplicate'
AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY webhook_type;

-- Timestamp rejections (Stripe)
SELECT webhook_type, COUNT(*) as rejected
FROM webhook_audit_logs
WHERE timestamp_valid = false
AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY webhook_type;
```

### Alerting

Set up alerts for:
- **High signature failure rate** (>5% in 1 hour) — possible attack or config issue
- **Frequent duplicate webhooks** (>10% of traffic) — possible retry loop
- **Old Stripe webhooks** being rejected — possible client clock skew

## Testing

See `tests/webhookSecurityValidator.test.ts` for:
- HMAC signature validation tests
- Stripe signature + timestamp validation
- Idempotency checking
- Service-specific validators (Vapi, Stripe, GoCardless)
- Audit logging

Run tests:
```bash
cd Collect-RX-main
npm test -- tests/webhookSecurityValidator.test.ts
```

## Related Documentation

- **PHI Boundary**: `docs/compliance/PHI-VAPI-BOUNDARY.md`
- **CRTC Compliance**: `docs/compliance/crtc-disclosure-decision.md`
- **Security Audit**: `docs/operations/security-audit-2026-08-15.md` (Finding #9)
