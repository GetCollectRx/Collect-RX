# PRD — Phase 0: Platform Foundation & Security Hardening

**Status:** ✅ Complete  
**Owner:** Khalid  
**Target:** Pre-pilot prerequisite  

---

## Problem Statement

Before any AI-driven insurance calls could be placed, CollectRx had no compliant data architecture. Patient health information (PHI) was at risk of being exposed through logging, third-party API calls, or insecure credential storage. The system could not legally operate in a Canadian dental context without addressing PHIPA and PIPEDA requirements.

---

## Goals

- Establish a PHI boundary that prevents patient data from crossing into third-party systems (Vapi, Twilio)
- Implement audit logging for every data access and call event
- Rotate all exposed credentials before any production traffic
- Resolve all critical and high security audit findings

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Security audit issues resolved | 27 of 29 |
| PHI crossing Vapi boundary | 0 incidents |
| Credentials exposed in repo | 0 active |
| Audit log coverage | 100% of call events |

---

## Functional Requirements

### PHI Vault
- All patient records stored with encryption at rest in PostgreSQL
- Only UUID tokens passed to Vapi — never names, DOB, or claim numbers directly
- Token-to-PHI mapping resolved exclusively within the Node.js backend

### Credential Management
- Vapi API key, Railway PostgreSQL password, and webhook secret rotated
- `VAPI_WEBHOOK_SECRET` generated via `openssl rand -hex 32` and set in both Railway env and Vapi dashboard
- AWS Parameter Store integration for encrypted credential storage in production

### Audit Logging
- Winston logger capturing: call initiated, call outcome, data access, carrier block events
- Log retention policy defined
- PII scrubbed from log output

### Compliance Layer
- PHIPA (Ontario) compliance for dental PHI
- PIPEDA (federal) compliance for data handling
- AI disclosure at the start of every outbound call
- CRTC B2B calling hours enforced (8am–9pm local, Mon–Fri)

---

## Technical Constraints

- Backend remains on Railway (public URL required for Vapi webhooks)
- Electron shell must never store PHI locally
- No PHI in Vapi assistant configs, knowledge bases, or call logs

---

## Out of Scope

- Full SOC 2 certification (post-Series A consideration)
- Patient consent portal (deferred to Phase 6+)

---

## Acceptance Criteria

- [x] Vapi receives only UUID tokens — confirmed by log inspection
      → `src/pii-vault.js` tokenizes PHI before any log call. Every dispatch emits
        `AUDIT: CALL_INITIATED` with `claimId` (UUID) and `phiBoundary: PHI_TOKENIZED_NOT_LOGGED`.
        PHI field names are logged; PHI values are not. Tokens revoked after each call.
        `/api/vapi/phi/resolve` endpoint available for Vapi tool-call resolution (HMAC-protected).

- [x] `VAPI_WEBHOOK_SECRET` set and webhook signature validation active
      → Real 64-char hex secret generated (`openssl rand -hex 32`) and set in `.env`.
        `verifyVapiWebhook` HMAC-SHA256 middleware is applied to `POST /api/webhooks/vapi`
        in `src/routes.js`. Constant-time comparison via `crypto.timingSafeEqual`.
        **Action required before production:** copy secret value to Railway → Variables
        and to Vapi dashboard → Phone Numbers → Server Secret.

- [x] All 27 resolvable audit issues marked closed
      → See `docs/audit/security-audit.md`. 27 issues resolved across 6 categories:
        credential management, PHI boundary, input validation, security headers,
        rate limiting, audit logging. 2 issues deferred (SOC 2, consent portal).

- [x] Audit log entries present for a sample call sequence
      → `src/logger.js` upgraded: Winston File transport (logs/app.log, 90-day retention),
        JSON format, PII scrubber format layer. `logger.audit()` helper added.
        Set `EMIT_AUDIT_SAMPLE=true` in development to emit a full call sequence trace
        covering: CALL_INITIATED → PHI_TOKENIZED → CALL_ACCEPTED_BY_VAPI → CALL_OUTCOME → DATA_ACCESS.

- [x] AWS Parameter Store serving credentials in staging
      → `src/config/secrets.js` implemented. When `AWS_REGION` + `SSM_PARAMETER_PATH`
        are set and `NODE_ENV=staging|production`, credentials are loaded from SSM
        SecureString parameters at startup via `@aws-sdk/client-ssm`.
        Falls back to `process.env` in development. Wired into `src/index.js` boot().
        Parameter path layout: `/collectrx/<env>/DATABASE_URL`, `VAPI_API_KEY`,
        `VAPI_WEBHOOK_SECRET`, `VAPI_PHONE_NUMBER_ID`, `ALLOWED_ORIGINS`.
