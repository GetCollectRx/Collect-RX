# CollectRx — Full Security Audit

**Date:** 2026-05-29
**Reviewer posture:** Adversarial / "security tyrant" — every server surface, the Electron desktop app, all webhooks, payments, and dependencies.
**App:** `Collect-RX-main` (dental insurance A/R automation; AI voice agents call Canadian carriers; handles PHI + money). HIPAA-analog regime for Canada = **PHIPA / PIPEDA**.
**Verdict:** The application is **well-engineered for security**. No critical or high-severity vulnerabilities were found. The substantive risks were in the AI→money decision path (fixed) and one auth fail-open (fixed). The remainder are dependency patches and a few low/defense-in-depth hardening items.

---

## Severity summary

| Sev | Count | Status |
|-----|-------|--------|
| Critical | 0 | — |
| High | 0 | — |
| Medium | AI finalizes money on weak signal | **Fixed** |
| Medium | Auth fail-open (accountant check) | **Fixed** |
| Medium | JWT algorithm not pinned | **Fixed** |
| Low | HTML report XSS (no output escaping) | **Fixed** |
| Low | Global `urlencoded` widened CSRF surface | **Fixed** (scoped to Twilio) |
| Low | Dependency advisories (qs/express prod; 5 dev-only) | Action listed |
| Low | CSP disabled, Electron `will-navigate`, reset-token at rest | Recommendations |
| Informational | several | Recommendations |

---

## Fixed in this engagement (code changes, typecheck clean)

1. **AI could finalize a financial outcome on a weak signal** *(Medium — anti-hallucination).*
   Claims could be marked `RESOLVED`/`DENIED`/`APPROVED_PENDING_PAYMENT` from keyword/regex classification of a phone transcript, and could emit a `PAYMENT_CONFIRMED` EMR event. Added `outcomeConfidence.ts`: a financial-terminal status is trusted only with corroboration (structured carrier payload **or** a captured reference number); otherwise it is downgraded to `ESCALATED`, an escalation is opened for a human, and no payment event fires. Wired into both webhook paths. This is also the "ask itself before asking a human" behavior — it self-verifies and only escalates what it genuinely cannot confirm.

2. **Auth fail-open on accountant access check** *(Medium — PHI access).*
   A DB error during the accountant active/expiry check used to call `next()` (grant). Now fails closed (503).

3. **EMR `PAYMENT_CONFIRMED` leak** *(Medium, same root as #1).* The EMR event keyed off the raw classifier outcome; now keys off the gated status.

4. **JWT algorithm not pinned** *(Medium — auth).* `jwt.verify` was called without an `algorithms` allowlist, leaving the door open to algorithm-confusion / `alg:none`-class attacks. Now pinned to `HS256` on both sign and verify (`authToken.ts`).

5. **HTML report XSS** *(Low — stored XSS).* `reportHtml()` interpolated the practice name and every table cell into HTML with no escaping; a crafted practice/patient name could execute script when a staffer opens a downloaded report. Added `escapeHtml()` over title, headers, and all cells (`practiceReportsApi.ts`).

6. **Global `express.urlencoded` widened the CSRF surface** *(Low — CSRF).* Form-encoded parsing was enabled app-wide, but only the signature-verified Twilio webhook needs it. Cookie auth + a global form parser means a cross-site simple form POST could ride the session if cross-site cookie mode is ever enabled. Scoped `urlencoded` to the Twilio route only; the JSON API now rejects form posts (CORS preflight already protects `application/json`).

7. **Stale auth tests** repaired so `npm test` is a trustworthy gate again (practice-ID→email login migration).

---

## Audited and found SOUND (no change needed)

**Injection.** No `queryRawUnsafe`/`executeRawUnsafe`/`eval`/`new Function`. All raw SQL (`cdcp.ts`, health checks) uses Prisma **tagged-template parameterization** — not string concatenation. No command injection: the only `spawn` calls (Electron) use `process.execPath` with **fixed** script paths and no user input.

**SSRF.** The one server-initiated dynamic fetch (`EMR_SYNC_WEBHOOK_URL`) is guarded by `assertEmrSyncWebhookUrlAllowed`: rejects embedded creds, non-http(s), and (in prod) loopback/private-IPv4/cloud-metadata hosts. URL is operator-set, not user-set.

**Path traversal.** The only request-adjacent file write (`learning/implementer.ts`) builds the filename via `slugify()`, which strips everything non-`[a-z0-9]` — no `../` or `/` possible.

**Electron desktop.** Best-practice flags: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`. Preload exposes only 4 fixed, safe IPC channels via `contextBridge`. `setWindowOpenHandler` denies in-app windows and opens links externally.

**Webhooks — all verified and fail-closed in production.** Stripe (`constructEvent` on raw body, missing-sig→400), Vapi (shared secret + idempotent body-hash dedup), SendGrid (ECDSA signature; **prod rejects 401 if key unset**), Twilio (`validateRequest`; **prod returns 403 if token/URL unset**).

**Authorization / IDOR — robust and consistent.** Every protected router applies `authenticate`. Object-level access is enforced everywhere: routes either query with `practiceId` in the `where` clause or fetch-then-verify `practiceId === session` → 404. The linchpin `queryPracticeConflictsSession` ignores client `practiceId` hints for normal users (always uses the JWT's practiceId) and 403s on mismatch; only `platform_dev` may target other practices, and that path is **redacted** (verified by passing test). A dedicated `idorPracticeScope.audit` test enforces this pattern.

**Crypto.** AES-256-GCM for PHI at rest (NIST 96-bit IV, authenticated encryption, no custom primitives), versioned payloads (supports key rotation), mandatory crypto-access audit logging. Stripe onboard-return URLs are HMAC-SHA256 signed and verified with constant-time `timingSafeEqual` (length-guarded).

**Secrets.** `.env` git-ignored; no committed API keys/private keys; history scrubbed (BFG). `JWT_SECRET` and PHI key required at startup in production.

**PHI in logs.** No patient identifiers are written to `console.*`. PHI access flows through the audit-log module.

**Web hardening.** Helmet + HSTS, 2 MB body limit, `trust proxy: 1`, httpOnly/secure/sameSite cookies, tiered rate limiting (auth 5/15min, webhooks 300/min, standard on `/api`). **CORS** returns an explicit allowlist (env or defaults) — no `*`, no arbitrary-origin reflection, so safe with `credentials: true`. **Rate limiter** keys on `ipKeyGenerator(req.ip)`, correct under single-proxy `trust proxy: 1`.

**Passwords & reset.** bcrypt cost factor **12**. Password-reset tokens are 256-bit (`randomBytes(32)`), 1-hour expiry, single-use (`usedAt`), applied atomically. Login compares with bcrypt; cookie cleared on logout.

**Health/metrics endpoint.** `/api/health/metrics` is token-gated (`HEALTH_METRICS_TOKEN`, constant-time compare) and returns only boolean deployment flags — no secrets.

**CSV.** Import is guarded by MIME/extension allowlist + 12 MB cap. The one CSV export emits only hardcoded labels, `Number()`s, ISO dates, and booleans — no free-text cells, so no formula/CSV injection.

**No fabricated money.** Reconciliation computes variance from structured EOB fields, never transcript text; flags >$50/$150 for human review. No monetary value is parsed from any transcript anywhere.

---

## Action required (dependencies — run on your machine; I can't from here without corrupting your macOS `node_modules`)

- **Production runtime (do this):** `npm audit fix` (non-`--force`) to patch the `qs`/`express` moderate DoS. Then `npm test`.
- **Dev-only (lower priority, needs evaluation):** 5 moderate advisories — `esbuild`/`vite` dev-server request leak and `uuid`-via-Storybook — only affect local dev/build tooling, not the shipped runtime. The app's runtime `uuidv4()` use (no `buf` arg) is not exploitable. Upgrading needs `--force` (breaking: Vite 8, Storybook), so schedule it deliberately rather than auto-fixing.

---

## Recommended hardening (low / defense-in-depth)

0. **Enable a Content-Security-Policy.** `helmet({ contentSecurityPolicy: false })` disables CSP — the main remaining XSS defense-in-depth gap. The SPA + Stripe + Vapi make a strict CSP fiddly, so roll it out behind a flag and test: start with `default-src 'self'`, allow Stripe (`js.stripe.com`, `api.stripe.com`) and your API origin, then tighten. Pair with `frame-ancestors 'none'`.

0b. **Hash password-reset tokens at rest.** Tokens are stored and looked up in plaintext; store a SHA-256 hash and look up by hash so a DB read can't be replayed into account takeover. Low risk today (1-hour, single-use), cheap to fix. Consider raising the password minimum above 8 and adding a breached-password check.

1. **Electron `will-navigate` allowlist.** Add a `webContents.on('will-navigate', …)` (and `will-redirect`) handler restricting navigation to your known dashboard origin. Today a compromised/redirecting remote page could move the main window off-origin. (Low: `webSecurity` + sandbox already contain most impact.)
2. **SSRF DNS-rebinding.** `assertEmrSyncWebhookUrlAllowed` checks the hostname string but not the resolved IP. Since the URL is operator-set this is low risk; if you ever make EMR URLs user-configurable, resolve+pin the IP or use an egress allowlist. Also add IPv6 private ranges (`fc00::/7`, `fe80::/10`) to the block set.
3. **Tighten `shell.openExternal`** in Electron to `https:` + known hosts only.
4. **Regression tests** for the new gate: assert an uncorroborated `RESOLVED`/`DENIED` webhook → `ESCALATED` + open escalation + **no** `PAYMENT_CONFIRMED`.
5. **Vendor agreements (compliance, not code):** confirm signed BAA/DPA-equivalents with Vapi, Twilio, SendGrid, Stripe, and any LLM provider before they process PHI; keep prompts to LLMs PHI-free (currently they are — only aggregates/backlog text go out).
6. **Key rotation runbook** for `PHI_ENCRYPTION_KEY` (payload versioning already supports it).
7. **Run SAST in CI** (Semgrep + `npm audit` gate) so new code is continuously checked.

---

## Method / coverage note

This was a manual review of the security-relevant surfaces: crypto, auth/session/JWT, all middleware, every route file's authz pattern, all four webhook verifiers, the Electron main + preload, payment/Stripe/patient-pay flows, SSRF/injection/path-traversal sinks, secrets, and logging — plus `npm audit`. It is not a substitute for a funded third-party penetration test, which I'd recommend before processing live PHI at scale.
