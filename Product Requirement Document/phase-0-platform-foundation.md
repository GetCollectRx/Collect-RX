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

- [ ] Vapi receives only UUID tokens — confirmed by log inspection
- [ ] `VAPI_WEBHOOK_SECRET` set and webhook signature validation active
- [ ] All 27 resolvable audit issues marked closed
- [ ] Audit log entries present for a sample call sequence
- [ ] AWS Parameter Store serving credentials in staging

---

## V2 Execution Layer

### Validation Mode (Mandatory)

- This phase is executed in **single-practice pilot validation mode**.
- No multi-practice architecture or feature expansion is allowed before the Phase 6 Day-90 decision.

### Scope Lock

**In scope**
- PHI boundary validation for all outbound integrations (Vapi, Twilio, Stripe metadata)
- Secret rotation completion and evidence capture
- Audit logging implementation and retention policy enforcement
- Signature verification for inbound webhooks

**Out of scope**
- SOC 2 control implementation and audit prep
- New product features unrelated to security/compliance baseline

### Task Breakdown

| ID | Task | Owner | Estimate | Dependency |
|----|------|-------|----------|------------|
| P0-1 | Enumerate PHI fields + classify allowed/disallowed outbound fields | Khalid | 0.5 day | none |
| P0-2 | Enforce UUID-only payload transformer for third-party calls | Eng | 1 day | P0-1 |
| P0-3 | Add webhook signature verification middleware + replay timestamp window | Eng | 0.5 day | none |
| P0-4 | Rotate and re-issue all exposed secrets | Khalid | 0.5 day | none |
| P0-5 | Wire secrets from AWS Parameter Store in staging runtime | Eng | 1 day | P0-4 |
| P0-6 | Add structured audit log events and PII scrubbing tests | Eng | 1 day | P0-1 |
| P0-7 | Produce compliance evidence pack (screenshots, logs, config) | Khalid | 0.5 day | P0-2..P0-6 |

### Test Plan

- **Unit tests**
  - Outbound payload serializer strips PHI fields.
  - Log scrubber removes names, phone numbers, emails, claim identifiers.
- **Integration tests**
  - Invalid webhook signature returns 401.
  - Valid webhook with expected signature is accepted.
- **Operational checks**
  - Secret rotation verified by disabling old keys and confirming failures.
  - Sample audit trace shows full sequence: call initiated -> accessed -> outcome.

### Risks & Mitigations

| Risk | Trigger | Mitigation | Fallback |
|------|---------|------------|----------|
| Hidden PHI leaks in debug logs | Security scan/log sampling detects PHI | Enforce centralized logger wrapper | Block deploy and hotfix logger |
| Secret drift between envs | Staging works, prod fails auth | Maintain secret inventory and checksum checklist | Roll back to prior known-good secret set |
| Webhook replay attacks | Repeated accepted webhook events | Add timestamp tolerance + idempotency key storage | Temporarily block endpoint by IP allowlist |

### Operational Runbook

- On webhook auth failures > 5/min, page on-call and inspect signature mismatch metrics.
- On PHI leakage detection, immediately disable outbound jobs and rotate keys.
- Keep 30-day searchable security logs and 1-year archived audit logs.

### Exit Criteria (Go/No-Go)

- [ ] All secrets rotated and old secrets invalidated
- [ ] Signature verification enforced on all webhook endpoints
- [ ] PHI leakage test suite passing
- [ ] Evidence pack attached (logs, config screenshots, test output)
- [ ] Security owner sign-off recorded
