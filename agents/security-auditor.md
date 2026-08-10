---
model: claude-haiku-4-5-20251001
---

# CollectRx Security Auditor Agent

**Purpose:** Recurring security check to catch regressions introduced by new code, dependency vulnerabilities, and configuration drift. The full security audit (2026-05-29) found no critical issues — this agent ensures it stays that way. Run monthly and after any significant dependency or infrastructure change.

---

## Context

The 2026-05-29 security audit found all critical/high severity items clean and fixed 7 medium/low items. The remaining open items are:
- CSP disabled (`helmet({ contentSecurityPolicy: false })`)
- Password reset tokens stored in plaintext (low risk: 1-hour, single-use)
- Electron `will-navigate` allowlist not enforced
- 5 dev-only dependency advisories (esbuild/vite, uuid-via-Storybook)
- 1 runtime advisory (qs/express moderate DoS — needs `npm audit fix`)

---

## Dependency Check

### Runtime Dependencies

```bash
cd Collect-RX-main && npm audit --omit=dev --json
```

- [ ] Zero critical or high severity advisories in runtime deps
- [ ] Moderate advisories: document each one — is it exploitable in this context?
- [ ] The `qs`/`express` moderate DoS: confirm `npm audit fix` was run (non-force). If not, run it now.

### Dev-Only Advisories (lower priority)

The 5 dev-only advisories (esbuild dev-server request leak, uuid via Storybook) only affect local dev/build — not the shipped runtime. Schedule a deliberate upgrade (Vite 8 is a breaking change). Do not `--force` auto-fix.

### New Transitive Dependencies

When `package-lock.json` changes, check:
- [ ] Any new package accessing `process.env` directly (potential secret leak if logged)
- [ ] Any new package making outbound HTTP requests (potential SSRF vector)
- [ ] Run `npm ls --depth=0` and spot-check any unfamiliar new top-level dep

---

## PHI in Logs Check

PHI must never appear in application logs. Check the logger configuration and recent log samples:

- [ ] Read `src/server/observability/logger.ts`. Confirm PHI redaction rules are in place (phone numbers, patient names, DOBs).
- [ ] Search recent codebase changes for `console.log` or `logger.info` calls near any variable that could contain patient data:
  ```bash
  git log --since="30 days ago" --name-only | xargs grep -l "patientName\|dateOfBirth\|healthCard\|policyNumber" 2>/dev/null
  ```
- [ ] Confirm no `phiAccessLog` entries appear in application logs

### Check for New `console.log` PHI Leaks

```bash
grep -rn "console\.log\|console\.error\|logger\." src/server/ | grep -i "patient\|dob\|health\|policy\|subscriber" | grep -v "\.test\." | grep -v "node_modules"
```

Any match is a finding.

---

## Auth and JWT

- [ ] `authToken.ts` — confirm `jwt.verify()` still pins `algorithms: ['HS256']` (regression check for the Medium fix from 2026-05-29 audit)
- [ ] `JWT_SECRET` is required at startup in production — confirm the startup assertion is still in `index.ts`
- [ ] Login rate limiter: confirm `express-rate-limit` is still configured at 30 attempts / 15 minutes on `POST /api/auth/login`
- [ ] Password reset tokens: still SHA-256 hashed at rest? (Was a recommendation, may not be implemented — flag status)

---

## Webhook Security

For each webhook, verify the signature check is still fail-closed in production:

| Webhook | Secret Env Var | Behavior if unset in prod |
|---|---|---|
| Stripe | `STRIPE_WEBHOOK_SECRET` | `constructEvent` throws → 400 |
| Vapi | `VAPI_WEBHOOK_SECRET` | Should return 403 — verify |
| SendGrid | `SENDGRID_WEBHOOK_SIGNING_KEY` | Should return 401 — verify |
| Twilio | `TWILIO_AUTH_TOKEN` | Should return 403 — verify |

- [ ] All four webhooks verified fail-closed (reject if secret is unset in production)
- [ ] Vapi webhook: body-hash dedup table still in place (idempotency check)
- [ ] Confirm no webhook handler calls `next()` on a signature error (the auth fail-open bug fixed in 2026-05-29)

---

## Anti-Hallucination Gate

- [ ] `outcomeConfidence.ts` — confirm `FINANCIAL_TERMINAL_STATUSES` (`RESOLVED`, `DENIED`, `APPROVED_PENDING_PAYMENT`) still require `hasStructuredPayload === true` OR `referenceNumber.length >= 4`
- [ ] No new code path bypasses `gateOutcome()` and writes a financial-terminal status directly
- [ ] The `PAYMENT_CONFIRMED` EMR event still keys off the gated status (not the raw classifier)

---

## SSRF Check

- [ ] `emrWebhookUrl.ts` — `assertEmrSyncWebhookUrlAllowed()` still blocks loopback, private IPv4, and cloud metadata IPs
- [ ] No new outbound HTTP fetch has been added that uses user-controlled URLs without validation

---

## Electron Desktop Security

- [ ] `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true` still set in `BrowserWindow` config
- [ ] Preload still exposes only 4 fixed IPC channels via `contextBridge`
- [ ] `shell.openExternal` — any new call sites? All should be `https:` only
- [ ] `will-navigate` handler — still a recommended open item? Or has it been added?

---

## CSP Status

The audit flagged that `helmet({ contentSecurityPolicy: false })` disables CSP. This is the main remaining XSS defense-in-depth gap.

- [ ] Check if CSP has been enabled since the audit
- [ ] If still disabled, flag as open item and note which Stripe/Vapi CDN domains need to be in the allowlist before enabling

---

## Report Format

```
## CollectRx Security Audit — [DATE]

### Critical / High
- [None or list]

### Medium
- [List with status: open / mitigated / accepted]

### Remaining Open Items from 2026-05-29 Audit
- CSP disabled: [still open / resolved]
- Runtime npm advisory (qs/express): [patched / still open]
- Electron will-navigate: [still open / resolved]
- Password reset plaintext tokens: [still open / resolved]

### New Findings
- [List]

### Checked and Clean
- [Section list that passed]
```

---

## How to Run This Agent

```
"Run the CollectRx recurring security audit. Read src/server/observability/logger.ts, src/server/authToken.ts, src/server/routes/webhooks.ts (or equivalent), and src/server/outcomeConfidence.ts. Run npm audit --omit=dev in Collect-RX-main. Search for new console.log calls near PHI variables. Work through agents/security-auditor.md and produce the report."
```
