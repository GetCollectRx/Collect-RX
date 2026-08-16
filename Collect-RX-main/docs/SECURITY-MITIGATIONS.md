# Emergency Security Mitigations (Wednesday Pilot)

**Status**: Deployed for Wednesday launch  
**Effective**: August 15, 2026  
**Full fixes scheduled**: Post-launch (week of August 22)

## Overview

Three critical security findings from the August 15 audit require emergency safeguards before the Wednesday pilot launch. These mitigations reduce risk while full fixes are being developed post-launch.

---

## Mitigation #1: Immutable Audit Logging

**Finding**: Incomplete audit logging implementation  
**Risk**: Cannot verify who accessed PHI when, enabling unauthorized access without detection  
**Timeline**: Full fix 2-3 days post-launch

### Emergency Implementation (Wednesday)

**Files**:
- `src/server/audit/immutableAuditLog.ts` — Core immutable logging with SHA-256 chaining
- `src/server/middleware/auditPhiAccess.ts` — Middleware to capture all PHI access
- `tests/security/immutableAuditLog.test.ts` — Verification tests

**What it does**:
1. **Chain verification** — Each audit entry's hash includes the previous entry's hash (blockchain-like). Tampering with any entry breaks the entire chain.
2. **Immutable storage** — Audit entries are written to the database with append-only semantics.
3. **Automatic logging** — All PHI access (patients, claims, recordings) is automatically logged.
4. **Critical alerting** — If audit log write fails, a security alert is generated immediately.

**How to use**:
```typescript
import { logImmutableAuditEntry, initializeLastHash } from './audit/immutableAuditLog.js'
import { prisma } from '../lib/prisma.js'

// Initialize on startup
await initializeLastHash(prisma)

// Log a PHI access event
await logImmutableAuditEntry(prisma, {
  userId: user.id,
  action: 'read',
  resourceType: 'claim',
  resourceId: claimId,
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
  result: 'success',
  details: 'Claim details retrieved',
})
```

**Verification** (post-launch):
```bash
# Check audit logs
npm run db:query "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 10"

# Verify chain integrity
npm run audit:verify-chain
```

### Post-Launch Full Implementation

- [ ] Write-once append-only file storage (AWS S3 WORM)
- [ ] HMAC signing on each entry
- [ ] Automatic chain verification on read
- [ ] 6-year retention enforcement
- [ ] Integration with SIEM/monitoring system
- [ ] Quarterly integrity audits

---

## Mitigation #2: PII/PHI Redaction in Logs

**Finding**: PHI leakage in logs (patient names, phone numbers, dates of birth)  
**Risk**: Sensitive patient data visible in application logs and error messages  
**Timeline**: Full fix 1-2 days post-launch

### Emergency Implementation (Wednesday)

**Files**:
- `src/server/logging/phiRedactor.ts` — PII detection and redaction utilities
- `tests/security/phiRedaction.test.ts` — Redaction tests

**What it does**:
1. **Automatic redaction** — All common PII patterns (SSN, PHN, phone, email, DOB) are automatically detected and replaced with placeholders
2. **Field-name redaction** — Known PHI field names (patientName, subscriberName, etc.) are redacted entirely
3. **Recursive redaction** — Nested objects and arrays are recursively scanned and redacted
4. **PII detection** — Can detect if an object contains PII before logging

**Redaction patterns**:
| Pattern | Original | Redacted |
|---------|----------|----------|
| SSN | 123-45-6789 | XXX-XX-XXXX |
| Canadian PHN | 1234 5678 9012 | XXXX XXXX XXXX |
| Phone | 416-555-0100 | XXX-XXX-XXXX |
| Email | john@example.com | XXX@example.com |
| DOB (ISO) | 1990-05-15 | XXXX-XX-XX |
| Credit Card | 1234-5678-9012-3456 | XXXX-XXXX-XXXX-XXXX |

**How to use**:
```typescript
import { redactPII, redactObject, containsPII } from './logging/phiRedactor.js'

// Redact text
const safe = redactPII('Patient: John Doe, DOB: 1990-05-15, SSN: 123-45-6789')
// → 'Patient: John Doe, DOB: XXXX-XX-XX, SSN: XXX-XX-XXXX'

// Redact objects
const safeData = redactObject({
  patientName: 'Jane Smith',
  email: 'jane@example.com',
  claimId: 'claim_123', // Safe field not redacted
})
// → { patientName: '[REDACTED:PHI]', email: 'XXX@example.com', claimId: 'claim_123' }

// Detect PII before logging
if (containsPII(errorData)) {
  logger.warn('Error data contains PII — redacting', {
    piiTypes: detectPIITypes(errorData),
    data: redactObject(errorData),
  })
}
```

**Verification** (post-launch):
```bash
# Search logs for unredacted PII (should find none)
grep -r '123-45-6789' logs/
grep -r '@example.com' logs/
grep -r 'john.doe@' logs/
```

### Post-Launch Full Implementation

- [ ] Automated log scanning (DLP scanning for missed patterns)
- [ ] Regular penetration testing
- [ ] Redaction policy enforcement in CI
- [ ] Encrypted logs storage
- [ ] Integration with compliance audit tools

---

## Mitigation #3: Vapi Call Recording & Transcript Security

**Finding**: Unencrypted call recordings and transcripts in Vapi API  
**Risk**: Recording contains unencrypted PHI, accessible via Vapi API credentials  
**Timeline**: Full fix 2-3 days post-launch

### Emergency Implementation (Wednesday)

**Files**:
- `src/server/vapi/vapiSecurityControls.ts` — Vapi security configuration and encryption
- `tests/security/vapiSecurity.test.ts` — Security controls tests

**What it does**:
1. **Webhook encryption** — All Vapi webhooks can be encrypted in transit using AES-256-GCM
2. **Recording access logging** — Every access to a call recording is logged for audit
3. **Security modes** — Three security modes to choose from:
   - **DISABLED** — All AI calls disabled, manual review only
   - **ENCRYPTED_TRANSIT** — Calls allowed but webhooks encrypted in database
   - **FULL_SECURITY** — Post-launch with encryption at rest

### Configuration

**Set security mode** (environment variable):
```bash
# Option A: Disable Vapi entirely
VAPI_ENABLED=false

# Option B: Keep Vapi but encrypt webhooks
VAPI_SECURITY_MODE=encrypted_transit
VAPI_WEBHOOK_ENCRYPTION_KEY=<64-char hex string>
```

**Generate encryption key**:
```bash
node -e "
const crypto = require('crypto');
const key = crypto.randomBytes(32).toString('hex');
console.log('VAPI_WEBHOOK_ENCRYPTION_KEY=' + key);
"
```

**How to use**:
```typescript
import {
  isVapiCallsEnabled,
  encryptVapiPayload,
  decryptVapiPayload,
  logRecordingAccess,
  validateVapiSecurityConfiguration,
} from './vapi/vapiSecurityControls.js'

// Check if Vapi is enabled
if (!isVapiCallsEnabled()) {
  await queueClaimForManualReview(claim, 'Vapi disabled for security')
  return
}

// Encrypt webhook payload before storing
const encrypted = encryptVapiPayload(vapiWebhook)
await db.vapiWebhookLog.create({
  data: {
    encrypted: encrypted.encrypted,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
  },
})

// Log all recording access
await logRecordingAccess(prisma, {
  recordingId: recording.id,
  userId: user.id,
  accessReason: 'quality_audit',
  ipAddress: req.ip,
})

// Validate configuration on startup
const validation = validateVapiSecurityConfiguration()
if (!validation.valid) {
  logger.warn('Vapi security configuration issues', { warnings: validation.warnings })
}
```

**Verification** (post-launch):
```bash
# Check encryption key is set
echo $VAPI_WEBHOOK_ENCRYPTION_KEY | wc -c  # Should be 65 (64 hex + newline)

# Check recording access logs
npm run db:query "SELECT * FROM recording_access_log ORDER BY accessed_at DESC"

# Check encrypted webhooks stored
npm run db:query "SELECT * FROM vapi_webhook_logs WHERE encrypted IS NOT NULL"
```

### Post-Launch Full Implementation

- [ ] Encryption at rest for recordings (AES-256-GCM on disk)
- [ ] Automatic transcript redaction (remove PHI from transcripts)
- [ ] Business Associate Agreement (BAA) with Vapi
- [ ] Recording retention policy (auto-delete after compliance period)
- [ ] Access control enforcement (only approved users can access recordings)
- [ ] Integration with compliance audit

---

## Deployment Checklist

Before Wednesday pilot launch:

### Preparation
- [ ] Review emergency mitigation code
- [ ] Run all security tests: `npm run test -- tests/security/`
- [ ] Generate Vapi encryption key: `node scripts/generate-vapi-key.js`

### Deployment
- [ ] Set environment variables:
  ```bash
  VAPI_WEBHOOK_ENCRYPTION_KEY=<generated key>
  VAPI_ENABLED=true or false (based on decision)
  ```
- [ ] Run database migrations: `npm run db:migrate`
- [ ] Deploy to staging first
- [ ] Run smoke tests: `npm run test:smoke`

### Verification
- [ ] Audit logs are being written: `npm run db:query "SELECT COUNT(*) FROM audit_log"`
- [ ] No PII in logs: `grep -i '123-45-6789\|@example.com' logs/* | wc -l` (should be 0)
- [ ] Vapi security configuration valid: Check server startup logs for warnings
- [ ] Recording access logged: `npm run db:query "SELECT * FROM recording_access_log LIMIT 1"`

### Post-Launch Work

**Week of August 22 (Full Implementations)**:
1. **Audit Logging** (2-3 days)
   - Append-only database storage
   - HMAC signing
   - WORM storage on AWS S3
   - Retention policies

2. **PHI Tokenization** (1-2 days)
   - Audit all data paths
   - Enforce tokenization on all PHI fields
   - DLP scanning
   - Penetration testing

3. **Vapi Encryption** (2-3 days)
   - Encryption at rest (AES-256-GCM)
   - Automatic transcript redaction
   - Access control layer
   - BAA with Vapi

---

## Monitoring & Alerts

### Critical Alerts
- [ ] Audit log write failure (immediate page)
- [ ] PII detected in logs (immediate page)
- [ ] Vapi encryption key missing/invalid (immediate page)
- [ ] Recording access by unauthorized user (immediate investigation)

### Regular Checks
- [ ] Daily: Audit log chain integrity
- [ ] Weekly: PII pattern scanning
- [ ] Weekly: Recording access review
- [ ] Monthly: Encryption key rotation

---

## Related Files

- `src/server/audit/auditLog.ts` — Original audit logging (extended by immutable version)
- `src/server/observability/logger.ts` — Core logger (already has PHI redaction)
- `src/server/vapi/vapiWebhook.ts` — Vapi webhook handler
- `tests/security/` — All security-related tests
- `docs/compliance/PHI-VAPI-BOUNDARY.md` — PHI handling policy
- `docs/compliance/crtc-disclosure-decision.md` — CRTC compliance rules

---

## References

**Security Standards**:
- PHIPA — Ontario Personal Health Information Protection Act
- PIPEDA — Canadian Personal Information Protection and Electronic Documents Act
- CRTC — Canadian Radio-television and Telecommunications Commission

**Implementation References**:
- OWASP Top 10 — A02: Cryptographic Failures
- CWE-532: Insertion of Sensitive Information into Log File
- CWE-321: Use of Hard-coded Cryptographic Key

---

## Questions or Issues?

Contact: Security team (khalid@collectrx.ca)  
Escalation: Emergency line: 911 (or ops contact)
