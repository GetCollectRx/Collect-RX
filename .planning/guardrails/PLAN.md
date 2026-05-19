# Guardrails Layer — Implementation Plan

**Status:** Draft for review
**Owner:** Khalid
**Reference:** [NVIDIA NeMo Guardrails](https://github.com/NVIDIA-NeMo/Guardrails)
**Date drafted:** 2026-05-19

---

## 1. Goal

Add a defense-in-depth guardrails layer to CollectRx that:

1. **Hardens the Vapi voice-agent pipeline** — formalizes pre-dispatch validation, persists every safety decision to an auditable log, and adds a semantic post-call audit pass that catches what regex misses (PHI leakage, novel carrier-block phrasings, off-script behavior).
2. **Produces a defensible PHIPA/PIPEDA compliance artifact** — by running the open-source NVIDIA NeMo Guardrails framework (Colang DSL) on every completed call transcript, with results persisted as an immutable audit trail.

## 2. Non-goals

- **Replacing existing logic.** `PIIVault`, `validateDispatch`, and the regex-based `classifyOutcome` all stay. Guardrails wrap and extend; they don't supplant.
- **Mid-call intervention.** Vapi runs the LLM inside the call. We cannot guardrail per-turn output — only the three checkpoints we control (pre-dispatch, webhook receipt, post-call).
- **Building a generic LLM gateway.** Scope is limited to the Vapi voice-AR path. The eligibility engine is non-LLM and out of scope.
- **A new policy DSL.** Rules live in one canonical JSON file (`rules.json`); Colang flows on the Python side are *generated from* that JSON, not hand-edited.

## 3. Architecture overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Node backend (Railway service: collectrx-api)                      │
│                                                                     │
│  ┌─────────────────────────┐    ┌──────────────────────────────┐   │
│  │ src/services/guardrails │    │ src/routes/insurance.ts      │   │
│  │   rules.json (canonical)│◄───┤   POST /queue/trigger/:id    │   │
│  │   preDispatch.ts        │    │     → preDispatchGuard(...)  │   │
│  │   webhookGuard.ts       │    │     → validateDispatch(...)  │   │
│  │   transcriptPersist.ts  │    └──────────────────────────────┘   │
│  └─────────────────────────┘                                       │
│           ▲                       ┌──────────────────────────────┐ │
│           │                       │ src/webhooks/vapi.ts         │ │
│           └───────────────────────┤   on call.ended:             │ │
│                                   │     persist transcript text  │ │
│                                   │     enqueue audit job →──────┼─┐
│                                   └──────────────────────────────┘ │
│                                                                    │ │
│  ┌──────────────────────────────┐                                  │ │
│  │ workers/guardrailAuditWorker │ ◄────── drains GuardrailAuditOutbox
│  │   POST → audit-sidecar       │ ─────────────┐                   │ │
│  │   write GuardrailAudit row   │              │                   │ │
│  │   if signals: fire           │              │                   │ │
│  │     CarrierBlockEvent        │              │                   │ │
│  └──────────────────────────────┘              │                   │ │
└────────────────────────────────────────────────┼───────────────────┘ │
                                                 │                     │
                                                 ▼                     │
┌──────────────────────────────────────────────────────────────────┐   │
│  Python sidecar (Railway service: collectrx-audit-sidecar)       │   │
│                                                                  │   │
│  audit-sidecar/                                                  │   │
│    app.py                  FastAPI: POST /audit/transcript       │   │
│    config/                                                       │   │
│      config.yml            NeMo Guardrails runtime config        │   │
│      rails/                                                      │   │
│        phi_leak.co         Colang flow: PHI leakage detection    │   │
│        carrier_block.co    Colang flow: block-signal semantic    │   │
│        off_script.co       Colang flow: off-topic detection      │   │
│    rules_sync.py           Reads ../shared/rules.json → Colang   │   │
│    Dockerfile                                                    │   │
│    railway.json                                                  │   │
└──────────────────────────────────────────────────────────────────┘
```

**Two Railway services**, communicating via HTTP. Sidecar is **only** called by the worker (never on the request path), so its latency never blocks a user-facing operation.

## 4. Canonical rule catalog

Single source of truth: `Collect-RX-main/src/services/guardrails/rules.json`.

Mirrored to the Python side via a small `rules_sync.py` script that generates Colang stubs at sidecar boot.

### Rule schema

```jsonc
{
  "version": "1.0.0",
  "rules": [
    {
      "id": "PRE_DISPATCH_CARRIER_BLOCK",
      "tier": "hot-path",
      "severity": "block",
      "description": "Suspend dispatch if carrier is under active CARRIER_BLOCK",
      "delegates_to": "validateDispatch.carrierBlockCheck"
    },
    {
      "id": "PRE_DISPATCH_BUSINESS_HOURS",
      "tier": "hot-path",
      "severity": "block",
      "description": "Calls only Mon–Fri 08:00–17:00 America/Toronto",
      "delegates_to": "validateDispatch.businessHoursCheck"
    },
    {
      "id": "PRE_DISPATCH_CLAIM_AGE_MIN",
      "tier": "hot-path",
      "severity": "block",
      "description": "Claim must be ≥30 days outstanding (≥21 for TELUS)",
      "delegates_to": "validateDispatch.claimAgeCheck"
    },
    {
      "id": "PRE_DISPATCH_CLAIM_AGE_MAX",
      "tier": "hot-path",
      "severity": "escalate",
      "description": "Claim >90 days outstanding → skip AI, escalate to human",
      "delegates_to": "validateDispatch.claimAgeCheck"
    },
    {
      "id": "PRE_DISPATCH_MAX_ATTEMPTS",
      "tier": "hot-path",
      "severity": "block",
      "description": "Max 3 call attempts per claim",
      "delegates_to": "validateDispatch.attemptCountCheck"
    },
    {
      "id": "PRE_DISPATCH_PHI_TOKENIZED",
      "tier": "hot-path",
      "severity": "block",
      "description": "Patient identifier sent to Vapi must be a valid UUID token in PIIVault",
      "delegates_to": "guardrails.preDispatch.checkTokenValidity"
    },
    {
      "id": "WEBHOOK_NO_RAW_PHI_IN_METADATA",
      "tier": "hot-path",
      "severity": "alert",
      "description": "Vapi webhook metadata echo must not contain raw names/DOBs/HCN",
      "delegates_to": "guardrails.webhookGuard.scanMetadata"
    },
    {
      "id": "POST_CALL_CARRIER_BLOCK_REGEX",
      "tier": "hot-path",
      "severity": "block",
      "description": "Regex match on known block phrases (existing behavior)",
      "delegates_to": "outcome.processor.BLOCK_SIGNAL_PATTERNS"
    },
    {
      "id": "POST_CALL_CARRIER_BLOCK_SEMANTIC",
      "tier": "audit",
      "severity": "block",
      "description": "Semantic classifier — flag transcripts where rep's intent matches 'this is a bot, stop calling'",
      "colang_flow": "rails/carrier_block.co"
    },
    {
      "id": "POST_CALL_PHI_LEAK_SCAN",
      "tier": "audit",
      "severity": "alert",
      "description": "Scan agent turns for non-tokenized identifiers (numeric strings resembling HCN, DOB-formatted strings, surname patterns)",
      "colang_flow": "rails/phi_leak.co"
    },
    {
      "id": "POST_CALL_OFF_SCRIPT",
      "tier": "audit",
      "severity": "alert",
      "description": "Flag agent turns where topic drifts outside insurance claim status (small talk beyond pleasantries, medical advice, billing disputes outside scope)",
      "colang_flow": "rails/off_script.co"
    },
    {
      "id": "POST_CALL_AGENT_HALLUCINATION",
      "tier": "audit",
      "severity": "alert",
      "description": "Agent stated a fact not present in call context (e.g., invented a reference number, fabricated a coverage detail)",
      "colang_flow": "rails/off_script.co"
    }
  ]
}
```

**Severity semantics:**
- `block` → refuse the action / fail the dispatch / flag the call as unsafe
- `escalate` → allow but route to human queue
- `alert` → log + counter; surface in admin dashboard; do not block

## 5. Schema migrations

New file: `Collect-RX-main/prisma/migrations/2026_05_guardrails/migration.sql`

```sql
-- 1. Persist transcript text (Vapi payload already includes it)
ALTER TABLE call_attempts
  ADD COLUMN transcript_text TEXT;

-- 2. Outbox for async audit jobs (same pattern as emr_sync_outbox)
CREATE TABLE guardrail_audit_outbox (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_attempt_id UUID NOT NULL REFERENCES call_attempts(id) ON DELETE CASCADE,
  enqueued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  attempts      INT NOT NULL DEFAULT 0,
  last_error    TEXT,
  UNIQUE (call_attempt_id)
);
CREATE INDEX idx_guardrail_audit_outbox_unprocessed
  ON guardrail_audit_outbox (enqueued_at)
  WHERE processed_at IS NULL;

-- 3. Audit result table (immutable; one row per (call_attempt × rules_version) pair)
CREATE TABLE guardrail_audits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_attempt_id UUID NOT NULL REFERENCES call_attempts(id) ON DELETE CASCADE,
  rules_version   TEXT NOT NULL,
  ran_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  risk_score      NUMERIC(4,3) NOT NULL,            -- 0.000..1.000
  violations_json JSONB NOT NULL,                   -- [{rule_id, severity, evidence}]
  signals_json    JSONB NOT NULL,                   -- {carrier_block:bool, phi_leak:bool, off_script:bool, hallucination:bool}
  sidecar_latency_ms INT,
  UNIQUE (call_attempt_id, rules_version)
);
CREATE INDEX idx_guardrail_audits_call ON guardrail_audits (call_attempt_id);
CREATE INDEX idx_guardrail_audits_risk ON guardrail_audits (risk_score DESC) WHERE risk_score > 0.5;
```

Then update `Collect-RX-main/prisma/schema.prisma` to add the matching Prisma models (`transcriptText` on `CallAttempt`, plus `GuardrailAuditOutbox` and `GuardrailAudit` models).

## 6. Phase A — Hot-path TS guardrails

**Goal:** Ship the rule catalog, pre-dispatch wrapper, webhook metadata scanner, transcript persistence, and audit-outbox enqueue. Lays everything Phase B will plug into.

### Files added

```
Collect-RX-main/src/services/guardrails/
  rules.json                  ← canonical catalog (see §4)
  index.ts                    ← public exports
  types.ts                    ← Rule, Violation, GuardrailDecision interfaces
  preDispatch.ts              ← wraps validateDispatch + token-validity check
  webhookGuard.ts             ← scans payload.metadata for raw PHI
  transcriptPersist.ts        ← writes payload.transcript → call_attempts.transcript_text
  auditEnqueue.ts             ← inserts row in guardrail_audit_outbox
  audit.ts                    ← writes structured rows to AuditLog (no PHI)

Collect-RX-main/tests/guardrails/
  preDispatch.test.ts
  webhookGuard.test.ts
  transcriptPersist.test.ts
  ruleCatalog.test.ts         ← schema validation + parity with delegates_to refs
```

### Files modified

- `Collect-RX-main/src/routes/insurance.ts` — wrap the existing `validateDispatch()` call at ~line 294 with `preDispatchGuard()`. Same return shape; adds structured audit log write on every decision.
- `Collect-RX-main/src/webhooks/vapi.ts` — at the existing `call.ended` handler (~line 95+), after signature validation, call `webhookGuard.scanMetadata(payload)`, then `transcriptPersist.write(...)`, then `auditEnqueue.enqueue(callAttemptId)`. All non-blocking on failure (log + continue).
- `Collect-RX-main/prisma/schema.prisma` — add models (see §5).

### Pre-dispatch wrapper shape

```ts
// src/services/guardrails/preDispatch.ts
export interface GuardrailDecision {
  allow: boolean;
  escalate: boolean;
  reasons: Violation[];      // every rule evaluated, not just failing
  rulesVersion: string;
}

export async function preDispatchGuard(claim: InsuranceClaim): Promise<GuardrailDecision> {
  // 1. PHI-token validity (new check)
  const tokenOk = piiVault.isValid(claim.patientToken);

  // 2. Delegate to existing validateDispatch (do not duplicate its logic)
  const v = await validateDispatch(claim);

  // 3. Compose, stamp with rulesVersion, write structured AuditLog row
  const decision = compose(tokenOk, v);
  await writeAudit({
    action: 'GUARDRAIL_PRE_DISPATCH',
    subjectType: 'InsuranceClaim',
    subjectId: claim.id,
    details: { decision, rulesVersion: RULES.version },
  });
  return decision;
}
```

**Critical:** `preDispatchGuard` *delegates to* `validateDispatch` — does not reimplement it. Keeps the existing code path authoritative.

### Acceptance criteria (Phase A)

- [ ] `rules.json` validated by a schema test; every `delegates_to` reference resolves to a real symbol
- [ ] Pre-dispatch wrapper returns identical allow/deny decisions to bare `validateDispatch` for all existing test cases
- [ ] PHI-token-validity rule catches a stale/expired token (new test)
- [ ] `transcript_text` column populated on every `call.ended` event in tests
- [ ] Webhook metadata scanner blocks a synthetic payload containing a raw 10-digit string (HCN-shaped) in metadata
- [ ] `guardrail_audit_outbox` row inserted per completed call (integration test)
- [ ] Every guardrail decision writes to `audit_logs` with `rulesVersion` stamped
- [ ] No regression in `npm test` and `npm run lint`

## 7. Phase B — Python NeMo sidecar

**New repo subdirectory:** `audit-sidecar/` (sibling to `Collect-RX-main/`)

### Files

```
audit-sidecar/
  app.py                      ← FastAPI app, single endpoint
  requirements.txt            ← nemoguardrails, fastapi, uvicorn, pydantic
  config/
    config.yml                ← NeMo runtime config (model, embeddings)
    rails/
      phi_leak.co             ← Colang: detect non-tokenized identifiers
      carrier_block.co        ← Colang: semantic block-signal detection
      off_script.co           ← Colang: topic / hallucination detection
  rules_sync.py               ← reads shared rules.json → generates Colang stubs
  shared/
    rules.json                ← symlinked from Collect-RX-main/src/services/guardrails/rules.json
  tests/
    test_phi_leak.py
    test_carrier_block.py
    test_off_script.py
    fixtures/
      transcript_clean.txt
      transcript_with_phi.txt
      transcript_with_block.txt
  Dockerfile
  railway.json
  README.md
```

### Sidecar API

Single endpoint, intentionally narrow:

```
POST /audit/transcript
Content-Type: application/json
Authorization: Bearer <SIDECAR_SHARED_SECRET>

Request:
{
  "call_attempt_id": "uuid",
  "transcript_text": "...full transcript...",
  "carrier_id": "SUN_LIFE",
  "outcome": "RESOLVED",
  "rules_version": "1.0.0"
}

Response 200:
{
  "rules_version": "1.0.0",
  "risk_score": 0.0..1.0,
  "violations": [
    {"rule_id": "POST_CALL_PHI_LEAK_SCAN", "severity": "alert", "evidence": "agent turn 14: '...Maria Gonzalez...'"}
  ],
  "signals": {
    "carrier_block": false,
    "phi_leak": true,
    "off_script": false,
    "hallucination": false
  }
}

Errors: 401 (auth), 422 (validation), 500 (sidecar internal)
```

### Auth

Symmetric shared secret in env (`SIDECAR_SHARED_SECRET`). Set in both Railway services. No mTLS, no OAuth — internal service, single tenant.

### Colang flow sketch — `carrier_block.co`

```colang
define user expresses block signal
  "this looks like an automated call"
  "we cannot speak with bots"
  "you'll need a human to call back"
  "this number is flagged in our system"
  "robocall, hanging up now"

define bot detect block
  "carrier_block_detected"

define flow block_detection
  user expresses block signal
  bot detect block
```

Mirrored for `phi_leak.co` and `off_script.co`. The point isn't conversational — we're using Colang's intent-matching as a semantic classifier over historical transcripts.

### Deployment

- Separate Railway service `collectrx-audit-sidecar`
- Same GitHub repo, Railway's per-service `rootDirectory: audit-sidecar`
- Resource: smallest tier (1 vCPU, 512MB) — sidecar is CPU-bound on embeddings; can scale later
- `SIDECAR_SHARED_SECRET` set in both services
- Health endpoint `GET /health` for Railway's check
- **Embedding model:** start with NeMo Guardrails' default sentence-transformer (CPU-friendly). Document path to swap for OpenAI embeddings if recall is poor.

### Acceptance criteria (Phase B)

- [ ] `docker build` succeeds locally
- [ ] FastAPI app boots, `/health` returns 200
- [ ] Each Colang flow has at least one passing test fixture (positive + negative)
- [ ] `rules_sync.py` generates Colang scaffolding from `rules.json` without errors
- [ ] Sidecar deployed to Railway as its own service
- [ ] Latency: P50 < 800ms, P95 < 2s on a 5000-token transcript (asynchronous path, so generous)

## 8. Phase C — Wire-up

### Files added

```
Collect-RX-main/src/workers/guardrailAuditWorker.ts
Collect-RX-main/tests/workers/guardrailAuditWorker.test.ts
```

### Files modified

- `Collect-RX-main/src/server/workerEntry.ts` — register the new worker alongside the existing EmrSyncOutbox drain
- `Collect-RX-main/.env.example` — add `SIDECAR_URL`, `SIDECAR_SHARED_SECRET`
- (Optional UI surface) Admin page: `Collect-RX-main/src/components/admin/GuardrailAudits.tsx` to view recent audits

### Worker logic

```ts
async function drain(): Promise<void> {
  const job = await claimNextOutboxRow();
  if (!job) return;

  try {
    const attempt = await prisma.callAttempt.findUnique({
      where: { id: job.callAttemptId },
      select: { id: true, transcriptText: true, claim: { select: { carrierId: true } }, outcome: true },
    });
    if (!attempt?.transcriptText) {
      await markProcessed(job.id, 'NO_TRANSCRIPT');
      return;
    }

    const result = await callSidecar(attempt);

    await prisma.$transaction(async (tx) => {
      await tx.guardrailAudit.create({ data: { ...result, callAttemptId: attempt.id } });
      // Belt-and-suspenders: if semantic classifier caught a block that regex missed,
      // fire CarrierBlockEvent retroactively.
      if (result.signals.carrier_block && !attempt.carrierBlockDetected) {
        await tx.carrierBlockEvent.create({ /* ... */ });
        await fireCarrierBlockSuspension(tx, attempt);
      }
      await markProcessed(job.id);
    });
  } catch (err) {
    await markAttemptError(job.id, err);
  }
}
```

### Acceptance criteria (Phase C)

- [ ] Worker drains a synthetic outbox row end-to-end against a local sidecar
- [ ] `GuardrailAudit` row written with all fields
- [ ] Retroactive `CarrierBlockEvent` fires when sidecar reports `carrier_block: true` and regex didn't catch it
- [ ] Worker is idempotent (claim-row uses `UPDATE ... SET processed_at = NOW() WHERE processed_at IS NULL` semantics)
- [ ] Backoff on sidecar failure (3 attempts, exponential, dead-letter after)
- [ ] Metrics: counter for `guardrail_audit_completed`, `guardrail_audit_failed`, gauge for `guardrail_audit_queue_depth`

## 9. Test plan

| Layer | Tests |
|---|---|
| Rule catalog | JSON schema validation; `delegates_to` reference resolution; `version` SemVer parse |
| `preDispatchGuard` | Parity test: ≥20 fixtures match `validateDispatch` decisions; new test for stale token; AuditLog write per call |
| `webhookGuard` | Synthetic payload with raw HCN in metadata → alert raised; clean payload → no alert |
| `transcriptPersist` | `call.ended` writes `transcript_text`; empty transcript → null, not "" |
| `auditEnqueue` | Outbox row appears; duplicate enqueue is no-op (unique constraint) |
| Sidecar Colang | Per-flow fixtures (positive + negative); golden-file test for sidecar response shape |
| Worker | End-to-end against local sidecar; retroactive CarrierBlockEvent on semantic-only catch; backoff and dead-letter |
| Regression | Existing `npm test` and `npm run lint` pass; eligibility tests untouched |

## 10. Rollout

1. **Phase A merged behind no flag.** Hot-path additions are non-blocking on failure — guardrail decisions log but don't refuse anything new beyond `validateDispatch`'s existing behavior. Safe to ship.
2. **Schema migration applied to staging Railway DB first**, verified, then prod.
3. **Phase B deployed to Railway as a new service.** Smoke-test `/audit/transcript` from production Node service before enabling the worker.
4. **Phase C worker started, audit-only (no retroactive block actions) for first 2 weeks.** Review `GuardrailAudit` rows in admin UI. Once false-positive rate on `carrier_block` signal is < 5%, enable retroactive block firing.
5. **Compliance package:** generate a one-page summary PDF citing the rule catalog version, the Colang flow files, and a sample audit record. This is the artifact Dr. Hasan's office shows under a PHIPA inquiry.

## 11. Observability

- Existing `audit_logs` table is the structured log for every guardrail decision (no PHI).
- New Prometheus-style counters (extend whatever metrics layer already exists; if none, defer):
  - `guardrail_pre_dispatch_decisions_total{outcome="allow|deny|escalate"}`
  - `guardrail_webhook_alerts_total{rule_id}`
  - `guardrail_audit_results_total{signal,fired}`
- Sidecar logs structured JSON to stdout (Railway captures); never logs transcript bodies.

## 12. Risks and open questions

| # | Risk | Mitigation |
|---|---|---|
| R1 | Sidecar cold-start latency on Railway (NeMo loads embeddings) | Set min-instances to 1; healthcheck warms the model |
| R2 | Colang/NeMo dependency churn between versions | Pin exact versions in `requirements.txt`; sidecar repo subdir has its own lockfile |
| R3 | False positive on PHI-leak scan (e.g., a reference number matches HCN shape) | Tier as `alert` not `block`; review false-positive rate during 2-week observation window |
| R4 | Embedding model bias on Canadian English / French / accented speech | Document as known limitation; pilot is English-only; revisit before bilingual rollout |
| R5 | Transcripts contain PHI; persisting them increases blast radius | Encrypt `transcript_text` at rest (Postgres TDE on Railway); retention policy: purge transcripts >180 days |
| R6 | Two Railway services = two billing lines | Sidecar is small (512MB tier); acceptable cost for the compliance story |

### Open questions for review

1. **Q1 — Transcript retention.** What's the right TTL? Suggesting 180 days. Compliance / Dr. Hasan to confirm.
2. **Q2 — Phase A flag.** Ship behind a feature flag (`GUARDRAILS_ENABLED=true`) for an extra layer of safety, or just ship since it's non-blocking? Recommendation: no flag — the wrapper degrades to existing behavior on failure.
3. **Q3 — Sidecar embedding model.** Default sentence-transformer (free, CPU, good enough) vs OpenAI embeddings (paid, higher recall). Recommendation: start with default; measure FP rate; revisit.
4. **Q4 — Admin UI scope.** Does the GuardrailAudits admin page ship in Phase C, or is it a separate Phase D? Recommendation: a *read-only* page in Phase C (link from existing admin nav, no new design system work).

---

## Estimated effort

| Phase | Effort | Risk |
|---|---|---|
| A — Hot-path TS guardrails | 1–2 days | Low |
| B — Python sidecar | 2–3 days | Medium (NeMo learning curve, Colang flows) |
| C — Wire-up | 1 day | Low (mirrors existing outbox pattern) |
| **Total** | **4–6 days** | |
