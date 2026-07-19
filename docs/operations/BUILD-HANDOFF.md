# BUILD HANDOFF — exact state and what's left to sell

**Written:** 2026-07-18. **Branch:** `main` @ `f088e87` (pushed, working tree clean).
**Read this file first in any new session. Do not re-derive or re-verify anything marked DONE — it burns tokens re-proving settled facts.**

---

## 1. Where the build stopped (in-flight work)

The last active workstream was the **in-call payment-shortfall check** (`verify_payment_amount` tool).
Everything is coded, tested, committed, and pushed. **One step remains:**

- [x] **Deploy staging, then run voice round 7 to verify the tool round-trip. VERIFIED round 7 2026-07-19.**
  - Deploy: `gh workflow run collectrx-staging-deploy.yml --repo GetCollectRx/Collect-RX` (repo secret `FLY_API_TOKEN` is set; local `fly deploy` works only if the Mac clock is synced — see §5).
  - Run a round: `POST https://api.vapi.ai/call` with `assistantId=a3180f2c-…` (sim), `phoneNumberId=` the Twilio number (`a4003bab…`, +16139098770), `customer.number=+19518486241`. Keys in `Collect-RX-main/.env`.
  - Pass = the squad-leg call log shows a `verify_payment_amount` `tool_call_result` containing `SHORTFALL DETECTED` (not "No result returned"), the agent challenges the $410-vs-$1,250 shortfall aloud, and structuredData outcome = `PARTIAL_PAYMENT`.
- [ ] **After round 7 passes: roll the tool to production** — the prod Claims_Agent config already has the tool (committed in `vapi-squad-config.json`), but prod's webhook host **`collect-rx.fly.dev` has NOT been deployed with any of this code**. Production deploy needs the operator's go. (round 7 green — awaiting operator go)

Why this design (do not re-litigate): six sim rounds proved the voice model executes tool calls with 100% reliability but drops prose rules; round 6 proved it also mis-copies amounts ($450 passed with $1,250 in its prompt). Therefore the server owns the math: the webhook looks up the claim's outstanding amount by `metadata.claimId` (production), falling back to the model-passed value only for sim calls. Independent post-call backstop `SHORTFALL_MISREPORTED` (claims validator) guarantees a short payment can never book as `CLAIM_PAID` even if the in-call layer fails.

---

## 2. DONE and verified — do not redo

| Area | State | Proof |
|---|---|---|
| Minute/licensing enforcement (tiers, trial hard-stop, soft-stop/overage, daily caps, 45-min ceiling, COGS breaker, fail-closed under `SUBSCRIPTION_ENFORCE=1`) | DONE | `tests/planGateFailClosed` 17/17, `billingSafetyMatrix` 5/5, full suite green; staging-verified end-to-end |
| Stripe test-mode sell path (catalog core/growth/scale, Checkout, webhook tier unlock, portal) | DONE on staging | PATH-TO-DELIVERY P4-04 checked; verified live 2026-07-17: signup → trial → Checkout → `billingTier=core` → limit → pause → confirm-overage → resume |
| Owner UX (app-wide pause banner + minutes, /billing picker), platform-admin tier/usage view | DONE | Screenshot-verified + e2e |
| Public /download (proxied assets, honest empty state) | DONE | `e2e/download-public.spec.ts` green; needs `GITHUB_RELEASES_TOKEN` on the server for real files |
| Conversation eval harness: 48 scenarios, LLM judge, retry hardening | DONE | `COLLECTRX_ANTHROPIC_EVAL=1 npm run eval:conversation-robustness` — **paid, a few $ per full sweep; run only as a gate before prompt changes, and prefer scenario subsets** |
| Claims_Agent scenario training (fact-capture, difficult-rep ladder, phonetic read-back, PARTIAL_PAYMENT outcome + schema + validator) | DONE | Full sweep green; prompt = the text-proven `8637c53` shape + tool (published to prod assistant 0e45a8ae and TEST squad 6f3d3f05) |
| PARTIAL_PAYMENT server backstop | DONE | `tests/shortfallMisreport.test.ts` 6/6, `tests/verifyPaymentTool.test.ts` 5/5, `tests/vapiToolCalls.test.ts` 4/4 |
| CI | GREEN @ `c210486` | Full pipeline incl. Playwright e2e |

**Hard-won lesson (do not repeat):** voice-prompt length is a budget. Three rounds of adding prose rules degraded existing behaviors (reference capture) without gaining the new one. Fix voice behavior with tools or server logic, not more prompt text. If prompt work is ever needed, consolidate/shorten first.

---

## 3. What's left to be SELLABLE — the complete list

Nothing below is optional filler; this is the honest full set, split by who acts.

### A. Engineering (small, hours)
1. **Round 7 verification + prod rollout of the tool** (§1 above). ~30 min.
2. **`trialEndsAt` backfill** — practices created before 2026-07-17 have never-expiring trials. One SQL on each DB: `UPDATE "Practice" SET trial_ends_at = created_at + interval '30 days' WHERE billing_tier = 'trial' AND trial_ends_at IS NULL;` (staging now, prod at cutover). NOT YET RUN ANYWHERE.
3. **Production app deploy** (`collect-rx` Fly app): deploy current main, run migrations (release_command does it), set prod secrets (mirror staging + Stripe live when ready), `SUBSCRIPTION_ENFORCE=1`. Blocked only on operator go.

### B. Operator tasks (you, non-code)
4. **Fix the Mac clock permanently** — it drifted 40 min, was fixed, then drifted 3 h 10 m the next day. Enable *System Settings → General → Date & Time → Set automatically*. Until then local `fly deploy` and Fly auth fail; use the GitHub Actions deploy workflow.
5. **Stripe live mode** — requires business bank account + business verification in the Stripe dashboard. Then create the three live prices, set live keys + live webhook secret on prod, keep test keys on staging. (Test-mode flow is already fully proven — this is paperwork, not engineering.)
6. **`GITHUB_RELEASES_TOKEN`** on the server if you want real installer downloads on /download (fine-grained token, Contents-read on `GetCollectRx/Collect-RX`). Optional — CSV onboarding needs no desktop app.
7. **Delete the stale Railway webhook endpoint** in the Stripe dashboard (points at the dead `collect-rx-production.up.railway.app`).

### C. Legal / compliance (go-live gate, tracked in PATH-TO-DELIVERY §E)
8. BAAs/DPAs with SendGrid, Twilio, Stripe, Vapi, Fly. 9. Counsel-reviewed Terms/Privacy. 10. PIPEDA breach contact. 11. Pen test or written pilot exception. 12. DNS `www.collectrx.ca` → prod.

### D. Proof (the only thing code cannot provide)
13. **One pilot practice, 50–100 supervised live carrier calls.** Measure: connect rate, status-obtained rate, carrier-block incidents, dollars moved. This is the recovery-rate evidence the sales pitch needs. Everything in the product is instrumented for it; there are currently **zero active practices**.

**Sellable =** A1–A3 + B4–B5 + C-list signed + D started. B6–B7 are polish.

---

## 4. Key references (so you never grep for them again)

- **Squads/assistants (Vapi):** prod squad `40ee8e13` → IVR_Navigator `eeb6ec1d`, Hold_Sentinel `2e90b271`, Claims_Agent `0e45a8ae` (Sonnet), Escalation_Closer `1d3a8cab`, Resolution_Closer `a90b41a0`. TEST squad `6f3d3f05` (inline members, values baked, tool server → staging). Sim assistant `a3180f2c` (difficult-Sarah script: stonewall → $410 reduction, FG-22/Ontario-2025 revealed only if asked → ambiguous ref `R-B-8-8-1-D`). Publish = PATCH assistant/squad from `vapi-squad-config.json`; **no publish script exists**; keep config, prod, and TEST squad in sync on every prompt change.
- **Webhooks:** live route `src/webhooks/vapi.ts` (HMAC `x-vapi-signature` or per-tool `x-vapi-secret`); prod URL `collect-rx.fly.dev/api/webhooks/vapi`, staging `collect-rx-staging.fly.dev/...`.
- **Pricing source of truth:** `Collect-RX-main/src/billing/tiers.ts` only (core $799/1,200 min, growth $1,999/2,800, scale $2,499/4,000; trial 500/50/30 d).
- **Staging:** `collect-rx-staging.fly.dev`; smokes `npm run smoke:staging` + `smoke:staging:product` (creds auto-load from `.staging-seed-credentials`). Deploy via GH Actions workflow `collectrx-staging-deploy.yml`.
- **Docs:** `docs/operations/PATH-TO-DELIVERY.md` (master checklist), `PHASE4-GO-LIVE.md` §P4-04 (Stripe operator steps + verification flow).

## 5. Token-efficiency protocol for future sessions

1. Open this file first; treat §2 as settled — no re-audits, no "let me verify the whole system" passes.
2. Run targeted test files, never the full suite, unless CI is red or you changed shared infra.
3. The conversation eval is **paid** — subsets only (`-- S042 S029`), full sweep only before shipping a prompt change.
4. Voice rounds cost Vapi minutes — run one only to verify a specific change, with a named pass criterion, max two per change (the round-3-to-5 loop that burned three rounds on prompt variants is the anti-pattern; §2's lesson).
5. Prefer the GH Actions deploy over local (clock issue).
