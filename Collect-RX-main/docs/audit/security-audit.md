# CollectRx Security Audit — Phase 0 Tracker

**Auditor:** Khalid Egeh  
**Date:** 2026-04-20  
**Scope:** Backend (Railway/Node.js), PHI data layer, Vapi integration, credential management  
**Result:** 27 of 29 issues resolved. 2 deferred (post-Series A).

---

## Legend
- ✅ Closed — fixed in code, confirmed
- 🔶 Deferred — known, out of scope for Phase 0
- ❌ Open — unresolved

---

## Category 1: Credential & Secret Management (6 issues)

| # | Finding | Severity | Status | Resolution |
|---|---------|----------|--------|------------|
| 1 | `VAPI_API_KEY` hard-coded in source | Critical | ✅ Closed | Moved to `process.env` exclusively; validated on module load |
| 2 | `DATABASE_URL` exposed in `.env` committed to git | Critical | ✅ Closed | `.env` in `.gitignore`; Railway env vars used in production |
| 3 | `VAPI_WEBHOOK_SECRET` placeholder value in `.env` | High | ✅ Closed | Real 64-char hex secret generated (`openssl rand -hex 32`) and set in `.env` |
| 4 | No webhook signature verification | High | ✅ Closed | HMAC-SHA256 `verifyVapiWebhook` middleware in `src/middleware/security.js` |
| 5 | AWS Parameter Store not used for credential storage | High | ✅ Closed | `src/config/secrets.js` implements SSM loading with env var fallback |
| 6 | API key logged on startup | Medium | ✅ Closed | Startup only warns if key is **missing** — key value is never logged |

---

## Category 2: PHI Boundary — Vapi / Third-Party (6 issues)

| # | Finding | Severity | Status | Resolution |
|---|---------|----------|--------|------------|
| 7 | Patient name, DOB, policy number sent in Vapi call payload metadata | Critical | ✅ Closed | Metadata now contains only `claim_id` (UUID), `carrier_code`, `practice_name`, `carrier_confidence` — no PHI |
| 8 | PHI fields logged in `dispatchCall` | High | ✅ Closed | All log entries use claim UUID only; PHI tokenized via `src/pii-vault.js` before any log call |
| 9 | No PHI tokenization before Vapi dispatch | High | ✅ Closed | `src/pii-vault.js` PIIVault tokenizes PHI fields; tokens expire after 1h and are revoked post-call |
| 10 | No token resolution endpoint (Vapi agents couldn't retrieve PHI securely) | High | ✅ Closed | `POST /api/vapi/phi/resolve` endpoint added — HMAC-authenticated, rate-limited |
| 11 | PHI stored in Vapi assistant knowledge bases | High | ✅ Closed | No PHI in `vapi-squad-config.json` static configs; claim data injected only as ephemeral call variables |
| 12 | Transcript (containing PHI) included verbatim in escalation log entries | Medium | ✅ Closed | Escalation `details` field in `unknown_response` path truncated to 500 chars; transcript not separately logged |

---

## Category 3: Input Validation & Injection (5 issues)

| # | Finding | Severity | Status | Resolution |
|---|---------|----------|--------|------------|
| 13 | SQL injection risk via unvalidated query params | Critical | ✅ Closed | All query params run through `validateClaimsQuery` with whitelist enum checks before parameterized SQL |
| 14 | Unexpected fields accepted on POST bodies (mass assignment) | High | ✅ Closed | Strict-mode validators (`validatePracticeBody`, etc.) reject any field not in the explicit allowlist |
| 15 | Oversized JSON body not capped | Medium | ✅ Closed | `express.json({ limit: "1mb" })` in `src/index.js`; CSV import capped at 10 MB separately |
| 16 | String fields not sanitized (control chars, XSS) | Medium | ✅ Closed | `sanitizeString()` strips ASCII control characters on all string inputs |
| 17 | SSRF via `escalation_webhook_url` | Medium | ✅ Closed | `validatePracticeBody` enforces `https://` prefix only on webhook URLs |

---

## Category 4: HTTP Security Headers & Transport (4 issues)

| # | Finding | Severity | Status | Resolution |
|---|---------|----------|--------|------------|
| 18 | Missing security headers (XSS, MIME sniff, clickjack) | High | ✅ Closed | `helmet()` applied globally in `src/index.js` (X-Content-Type-Options, X-Frame-Options, HSTS, CSP, Referrer-Policy) |
| 19 | CORS wildcard (`*`) allowed | High | ✅ Closed | Allowlist-based CORS: only Railway backend and Lovable frontend origins accepted |
| 20 | HTTP allowed in production (no TLS redirect) | Medium | ✅ Closed | `x-forwarded-proto` redirect in `src/index.js` enforces HTTPS in production |
| 21 | API responses expose stack traces | Medium | ✅ Closed | Global error handler returns generic `"Internal server error"` to clients; full stack logged server-side only |

---

## Category 5: Rate Limiting & Abuse Prevention (3 issues)

| # | Finding | Severity | Status | Resolution |
|---|---------|----------|--------|------------|
| 22 | No rate limiting on any endpoint | High | ✅ Closed | Three-tier rate limiting: `standardLimiter` (120/min), `strictLimiter` (10/min), `webhookLimiter` (300/min) |
| 23 | Queue run endpoint callable unlimited times (cost risk) | High | ✅ Closed | `strictLimiter` on `POST /api/queue/run`; localhost bypass for MCP server only |
| 24 | CSV import not size-capped | Medium | ✅ Closed | `10mb` limit on `text/csv`; JSON import capped at 5,000 rows |

---

## Category 6: Audit Logging (3 issues)

| # | Finding | Severity | Status | Resolution |
|---|---------|----------|--------|------------|
| 25 | No structured audit logging for call events | High | ✅ Closed | Winston logger captures: `CALL_INITIATED`, `CALL_ACCEPTED_BY_VAPI`, `CALL_DISPATCH_FAILED`, `CALL_OUTCOME` events with claim UUID |
| 26 | Logs only to console — no persistent audit trail | Medium | ✅ Closed | `winston-daily-rotate-file` transport added in `src/logger.js`; 90-day retention |
| 27 | PHI appears in log output | High | ✅ Closed | PIIVault tokenization ensures PHI fields never reach logger; PII scrubber format applied as defence-in-depth |

---

## Category 7: Deferred (Out of Scope for Phase 0)

| # | Finding | Severity | Status | Notes |
|---|---------|----------|--------|-------|
| 28 | No SOC 2 Type II certification | High | 🔶 Deferred | Post-Series A — requires 6-month observation period |
| 29 | No patient consent portal for PHIPA s.29 disclosure | Medium | 🔶 Deferred | Deferred to Phase 6+ (post-pilot); current calls are B2B only (insurer representatives) |

---

## Sign-off

| Criterion | Result |
|-----------|--------|
| Issues resolved | **27 / 29** ✅ |
| Critical issues open | **0** ✅ |
| High issues open | **0** ✅ |
| PHI crossing Vapi boundary | **0 incidents** ✅ |
| Credentials exposed in repo | **0 active** ✅ |
