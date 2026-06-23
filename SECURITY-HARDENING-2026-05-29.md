# CollectRx — Security & Compliance Hardening Pass

**Date:** 2026-05-29
**Scope reviewed:** PHI security & HIPAA/PHIPA controls, anti-hallucination guardrails on financial/insurance outcomes, self-questioning/escalation logic, and code-level vulnerabilities across `Collect-RX-main` (the live `dental-ar-system` app).
**Verification:** `tsc --noEmit` passes clean after all changes. Gate logic unit-verified against six cases. Full `vitest` suite could not run in this Linux sandbox (the repo's `node_modules` were installed on macOS, so the native rollup binary is missing — an environment artifact, not a code issue; run `npm test` on your machine).

---

## What I changed (live edits)

### 1. Anti-hallucination gate on money decisions — *new control*
**Files:** `src/server/outcomeConfidence.ts` (new), `claimStatusFromCallOutcome.ts`, `vapi/vapiWebhook.ts`, `frontDesk/vapiDeskEvents.ts`

The platform was finalizing claim outcomes — `RESOLVED`, `DENIED`, `APPROVED_PENDING_PAYMENT` — from keyword/regex classification of (potentially mis-transcribed) phone-call transcripts. A misheard "approved" could mark a claim paid, stop follow-up, and emit a `PAYMENT_CONFIRMED` event to the EMR. That is the core "acting on a hallucinated financial fact" risk.

New rule: a **financial-terminal** status is only trusted when it is *corroborated* by either (a) a schema-validated structured payload from the carrier-call assistant, or (b) a captured carrier reference/confirmation number. If neither exists, the status is **downgraded to `ESCALATED`**, an escalation is opened for a human to verify, and **no payment/EMR event is emitted**. Non-financial statuses pass through unchanged. The change is backward-compatible (gate only applies when corroboration context is supplied; both webhook paths now supply it).

This is also the "ask itself before asking a human" behavior: the system self-checks *"do I actually have proof of this money result?"* and only escalates to staff the cases it genuinely cannot confirm — rather than either guessing or escalating everything.

### 2. Auth fail-open → fail-closed (PHI access)
**File:** `src/server/middleware/authenticate.ts`

The accountant token check (verifying the account is still active and not expired) previously called `next()` — *allowing the request through* — when the DB lookup errored. That is a fail-open on a PHI access-control check: a DB hiccup could grant access to a revoked/expired account. Now it returns `503` and denies access until verification succeeds.

### 3. EMR event leak closed
**File:** `src/server/vapi/vapiWebhook.ts`

The EMR outbox event was keyed off the *raw* classifier outcome, so a `RESOLVED` guess could emit `PAYMENT_CONFIRMED` even after the gate held it. It now keys off the **gated** status, so held outcomes cannot leak a payment-confirmed signal downstream.

---

## What was already solid (verified, no change needed)

- **Encryption:** AES-256-GCM for PHI at rest (NIST 96-bit IV, authenticated encryption, no custom crypto), keys loaded from env/KMS, mandatory crypto-access audit logging on every encrypt/decrypt.
- **Access control:** Role-based PHI gating in the JWT (`phiAccess` per role), PHI route allow-listing, practice-scoping, redaction module.
- **Secrets:** `.env` is git-ignored; no API keys/private keys committed; git history already scrubbed (BFG report present). `JWT_SECRET` and PHI key are required at startup in production.
- **Web hardening:** Helmet (with HSTS), CORS allow-list, `express.json` body-size limit (2 MB), `trust proxy` set, cookie-parser, httpOnly/secure/sameSite auth cookies.
- **Rate limiting:** Login, platform-login, and password-reset endpoints are brute-force limited (5 req / 15 min per IP, Redis-backed).
- **No injection sinks:** No `queryRawUnsafe`, `exec`, `eval`, or `dangerouslySetInnerHTML` in the app code (Prisma parameterizes queries).
- **Webhook integrity:** Vapi webhook uses a shared-secret check plus idempotent body-hash dedup.
- **Carrier-block protocol:** Aggressively suspends all calls to a carrier on any bot-detection signal (safer to over-block).

---

## Additional areas audited (second pass — verified clean)

- **No PHI leaves to third-party LLMs.** The product-improvement agent sends only *aggregates* to Notion (practice name, carrier codes, counts via `groupBy`) — no patient names, DOB, policy/member numbers. Gemini grounding queries carry backlog item text (title/description/keywords from the internal learning DB), not patient records. Data minimization is respected on outbound LLM/Notion calls.
- **No fabricated money.** The reconciliation engine computes variance from *structured EOB adjudication fields* (`insurancePaid`, `patientPaid`, `providerFee`), never from transcript text, and flags variances over $50 (high) / $150 (critical → escalate) for human review with a `requiresHumanReview` flag. A codebase-wide scan confirms **no monetary amount is ever parsed from a call transcript, summary, or success-evaluation string** anywhere in the server. The only thing read from transcripts is the outcome *category* and a reference number — and that category is now gated (see change #1).

The remaining exposure on outbound calls is the data that *must* go to Vapi/Twilio to place a carrier call (patient/claim identifiers) — covered by vendor agreements, see next steps.

## Outstanding item requiring your action

**Dependency advisory (moderate):** `qs` (pulled in via `express`) has a remotely-triggerable DoS (GHSA-q8mj-m7cp-5q26). Fix is a patch bump. I did **not** run `npm audit fix` here because this folder's `node_modules` is your macOS install mounted into a Linux sandbox — installing from Linux would put wrong-platform binaries into it. **On your machine, run:**

```bash
cd collectrx-platform/Collect-RX-main
npm audit fix
npm test   # confirm green, including the outcome/webhook tests
```

---

## Recommended next steps (not done in this pass)

- Add an explicit `requiresHumanVerification` flag/column on the escalation or claim so the UI can visually distinguish *"AI held this — please confirm the amount"* from ordinary escalations.
- Add regression tests asserting that an uncorroborated `RESOLVED`/`DENIED` webhook results in `ESCALATED` + an open escalation + **no** `PAYMENT_CONFIRMED` EMR event.
- Confirm a signed Business Associate-equivalent / data-processing agreement is in place with Vapi, Twilio, SendGrid, and any LLM provider before they touch PHI, and that PHI is minimized in prompts sent to Gemini/LLM grounding calls.
- Periodic key rotation procedure for `PHI_ENCRYPTION_KEY` (payload is already versioned, which supports this).
