# CollectRx Expansion Architecture: Insurance-Facing Industries Beyond Dentistry

Prepared for: Khalid (founder)
Date: 2026-10-10
Status: discovery and design only. No application code was changed, nothing was deployed, no insurer was contacted, no live Vapi call was placed.
Canonical application inspected: `Collect-RX-main/` in this checkout (`/home/user/Collect-RX`). The repo-root `src/` prototype was ignored per `CLAUDE.md`.

## 0. How to read this document

Every statement carries one of three tags so observed code is never confused with design or with unverified outside facts.

| Tag | Meaning |
|---|---|
| **[F]** | Observed fact. Read in this repository, with a path and line. Not proof of deployed behavior. |
| **[P]** | Proposed design. Does not exist today. |
| **[X]** | External dependency or external claim. Not verified as a current legal or operational requirement unless a source is cited, and even then it needs a re-check before it becomes a product rule. |

Workspace notes, stated plainly:

- The brief's paths are macOS paths. This checkout lives at `/home/user/Collect-RX`. The deliverable is saved at `research/2026-10-10-architecture/` under that root, next to the repository `AGENTS.md`.
- `research/2026-10-10-architecture/GATES.md` and `PLAN.md` from the previous agent are **not present in this checkout** (no `research/` directory existed, no `sources/` directory exists). I did not reconstruct them. Everything here is derived from the code and from the brief's own findings list, each of which I re-verified.
- The previous agent's local test command was re-run here after `npm ci --ignore-scripts`. Result reproduced: 5 files passed, 47 tests passed, 3 todo (reported as skipped). These are mocked or local tests. They do not verify live Vapi, insurer access, production RLS enforcement, or any integration.

---

## 1. Summary for decision makers

1. **The product thesis survives the expansion intact.** What expands is the nouns around the phone call (who owes, who pays, who is contacted, what identifies the case), not the call machinery. IVR navigation, hold waiting, rep conversation, durable evidence capture and payment reconciliation are reusable. The dentistry-specific parts are concentrated in a small number of identifiable places (section 3.3).
2. **The single biggest structural blocker is identity.** `InsuranceClaim` is simultaneously the insurer's case, the business's invoice and the dispatchable work item, uniquely keyed on `[practiceId, claimNumber]` (`prisma/schema.prisma:743`). Collision, restoration and MVA rehab all break that equivalence. The fix is additive: introduce `InsuranceCase`, `Receivable` and `PaymentAllocation`, shadow-written from the existing dental import, with `practiceId` left untouched.
3. **Three defects in today's code should be fixed before any new vertical, because expansion multiplies them** (section 3.5):
   - The manual trigger route (`src/routes/insurance.ts:479`) does not apply human-assisted mode selection, does not use the TELUS TPA phone resolution, and skips the other safeguards the scheduler applies. It can therefore start the autonomous squad for a practice whose plan does not include it, and for a TELUS claim it dials the placeholder number the code itself labels "Not a real TELUS line."
   - The durable dispatch-intent helpers (`src/server/frontDesk/dispatchIntent.ts`) have **no production caller**. Protection against duplicate calls today rests on a vendor `Idempotency-Key` header plus queue state, not on the intent ledger.
   - "Dollars recovered" counts any balance drop that has either a call-set `RESOLVED` status or an insurer-paid amount on the export, including claims the business sat on while the insurer paid on its normal schedule. It measures verified receipts, not recovery attributable to CollectRx.
4. **Knowledge sharing is unsafe for multi-industry use.** `CarrierSubmissionChannel` has one global slot per carrier and channel type, overwritten by whichever tenant's call last stated a destination (`schema.prisma:2248`, `submissionChannelMemory.ts`). A case-specific adjuster fax number would become "known channel" text injected into other tenants' calls.
5. **Recommended architecture:** extend the existing modular monolith. No new services. Add four bounded modules inside `Collect-RX-main/src/server/`: a Case and Receivable ledger, a Payer and Contact registry, a single Dispatch service, and Objective Packs (versioned prompt, tool and outcome-schema bundles per call objective). Keep the five-role squad grammar.
6. **First implementation work package:** WP-0 (a small safety patch to the manual trigger), then WP-1 (one dispatch service with intents wired into production). Both are behavior-preserving for dentistry and are prerequisites for everything else. Details in section 10.

---

## 2. Expanded product definition

### 2.1 What the business hands to CollectRx

A **recovery task**: an unpaid or unconfirmed insurance-facing item the business wants chased by phone, with enough identity to be located by the insurer or administrator, and an authorization to speak on the business's behalf.

| Handed over | Examples |
|---|---|
| Receivable data (import, CSV, or later a connector) | Invoice number, amount, date issued, service or loss dates, line items where they matter |
| Case identifiers | Insurer claim or file number, policy, adjuster name if known, loss date, VIN or plate, property address, WSIB claim number, member and group IDs |
| Party facts | Who the legal debtor is, who the insurer or administrator is, who should receive payment |
| Authorizations | Billing agent authorization letter, direction to pay, assignment of benefits, claimant consent, as applicable to the payer |
| Business rules | Which objectives are allowed, who on staff owns decisions, escalation phone, quiet windows |

### 2.2 What the squad executes

Only work that is a phone interaction with a business counterpart (insurer, TPA, adjuster, administrator):

| Executable by the squad | Notes |
|---|---|
| Navigate the payer's phone tree to the correct department | Reusable role, route-specific hints |
| Wait on hold and detect a live human | Highest labor saver, vertical-independent |
| Ask status of an invoice or claim | Typed answer: received, in review, approved, partially approved, denied, paid, not found |
| Get payment facts | Issued date, method, amount, payee, reference or cheque or EFT number, delivery address |
| Request a trace, reissue or stop-payment | Only as a request, with reference captured |
| Confirm receipt or request a resubmission channel | Fax, portal, email, address, with the confirming rep recorded |
| Identify what is blocking payment | Missing document, pending approval, dispute, deductible, holdback |
| Capture deadlines and callback commitments | Exact dates only |
| Obtain a preauthorization reference | Only where the objective is preauthorization, separate from AR |

### 2.3 What comes back

Seven typed returns, kept separate on purpose (section 5.9):

1. What the representative said (statements, with confidence).
2. A recommended next action, and the system's decision after policy checks.
3. Commitments received (payment promised or issued, resubmission requested, callback promised, with dates and references).
4. Evidence (call record, reference, rep identity, transcript pointer, documents requested).
5. A recovery task state (next due date, owner: system or named staff).
6. Payment allocations reconciled later from remittance or import data, never inferred from a call.
7. An attribution class for each reconciled payment (section 5.9).

### 2.4 What requires staff judgment (not automated)

Disputes over scope, price or coverage; any negotiation or settlement; legal or lien actions; represented claimants; denials needing clinical or technical justification; changing rate or authorization; deciding to write off. The squad gathers the facts and hands off with a packet. It does not decide.

### 2.5 What is explicitly not the thesis

Claim-tracking dashboards, eligibility checks, general administrative automation. Eligibility, pre-visit checks and CDCP tools exist in the codebase (`src/billing/entitlements.ts`) and stay as dental modules. They are not carried into the new verticals.

---

## 3. Current implementation assessment

### 3.1 Traced path: imported receivable to payment reconciliation

| Step | What happens | Location |
|---|---|---|
| 1. Import | Rows normalized with alias mapping. Rows are grouped by claim number and merged into one claim-level row (amounts summed, earliest dates, codes unioned). Carrier name must map to one of six `CarrierId` values or the whole file is rejected in preflight. | `pms/pmsImportPipeline.ts`, `pms/claimRowMerge.ts`, `pms/carrierMap.ts` |
| 2. Persist | Upsert on `(practiceId, claimNumber)`. Patient PHI tokenized into the AES-256-GCM vault, token stored on the claim. A new token is minted on every re-import. | `pms/prismaClaimImporter.ts` |
| 3. Queue | Claims with status `PENDING`, balance above zero, 30 to 90 days outstanding, and no blocking gate get a `CallQueue` row. `WorkItem` rows rank by dollars, age and carrier risk. | `services/workQueueService.ts:29` |
| 4. Dispatch (scheduled) | Tick loop per practice: plan gate, `validateDispatch` (block, concurrency, authorization, 30 to 90 day window, 3 attempts, Mon to Fri 08:00 to 17:00 Eastern), pre-call triage, PHI detokenization, TELUS TPA phone resolution, mode selection, `initiateCall`, then create `CallAttempt`. One call per practice at a time. | `server/frontDesk/queueEngine.ts:482` onward, `carriers/adapter.ts:404` |
| 5. Call | Vapi squad: IVR_Navigator, Hold_Sentinel, Claims_Agent, Escalation_Closer, Resolution_Closer (autonomous), or IVR_Navigator, Hold_Sentinel, Claims_Scribe (human-assisted). PHI goes as ephemeral `variableValues`, metadata carries only UUID tokens. Recording disabled. | `vapi/client.ts`, `vapi-squad-config.json` |
| 6. Outcome | Webhook (HMAC or shared secret, body-hash idempotency ledger). Autonomous: outcome inferred by regex and keyword ladders over transcript and summary, or a structured payload if present. Human-assisted: `log_call_outcome` tool writes a `HumanAssistedCallLog`, scenario mapped to outcome. | `webhooks/vapi.ts`, `outcome/processor.ts`, `outcome/humanAssistedOutcomeResolver.ts` |
| 7. Next action | `routeClaimRecovery` picks `CALL_CARRIER`, `WAIT_SYNC`, `OPEN_CDCP`, `PRACTICE_GATE` or `STOP`; creates `ClaimRecoveryAction` gates, recall times, payment-expected dates. | `server/recovery/claimRouter.ts`, `recoveryLoopService.ts` |
| 8. Reconciliation | A later import reports the new balance. A drop is credited as recovered only with evidence (call-set `RESOLVED` or `APPROVED_PENDING_PAYMENT`, or an insurer-paid amount on the row). Zero balance with no evidence stops the claim without crediting it. Partial drops open a trace and extend the window by 7 days. | `recovery/paymentVerification.ts`, `partialPaymentHandler.ts` |
| 9. Absence | If the practice labels an export `full`, open claims missing from it get `recoveryRoute = STOP`, unless more than half (and at least 10) are missing, in which case it holds. | `pms/absentClaimHandler.ts` |

### 3.2 What works structurally and should be kept

| Capability | Why it carries over |
|---|---|
| Tenant isolation: `practiceId` on rows, `FORCE ROW LEVEL SECURITY` policies via `app_rls_practice_allowed`, request-scoped context in `server/db/rlsContext.ts` | The isolation primitive is generic. New tenant tables copy the same policy template. |
| PHI boundary: vault with AES-256-GCM, tokens in DB, ephemeral variables to Vapi, transcript scrubbing, deletion after call | Pattern is right. The payload shape is patient-specific (`PatientPHI`, `pii-vault.ts:71`). |
| Webhook hardening: signature or shared secret, tamper check against the DB, body-hash lease ledger, retry-safe failure marking | Reusable as is. |
| Hold tolerance and agent roles | IVR_Navigator and Hold_Sentinel are domain-neutral by design. |
| Retry ladder and hold-dump ledger | Engagement-evidence logic is generic (`holdLedger.ts`, `claimRouter.ts`). |
| Human-assisted path with structured, human-witnessed outcome | Strongest trust signal in the system. It is also the safe learning instrument for new verticals (section 7.6). |
| Plan entitlements enforced server-side (`billing/entitlements.ts`) | Pattern extends to verticals. |
| CARRIER_BLOCK protocol including organization siblings | Concept generalizes to payer-program and contact-route blocks. |
| Paid-evidence discipline (zero balance alone is not credited) | Right instinct, to be completed with attribution (section 5.9). |

### 3.3 What is dental-specific (and where)

| Area | Dental coupling | Location |
|---|---|---|
| Identity | `patientToken` required; `PatientPHI` is patient name, DOB, subscriber ID, group, subscriber name and DOB | `schema.prisma` InsuranceClaim; `pii-vault.ts:71` |
| Treatment | `treatmentCodes` as CDT codes; `Dentist` with a 9-digit CDA provider number checked on import | `schema.prisma`; `prismaClaimImporter.ts` |
| Payer set | `CarrierId` enum has six values and is used in about 119 source files; unknown carrier fails the import | `schema.prisma:562`; `carrierMap.ts` |
| Payer class | `PayerType` is PRIVATE, CDCP, PROVINCIAL | `schema.prisma:577` |
| Recovery routing | CDCP reconsideration branch, T11 denial import, x-ray escalation, fixed follow-up hours (72h processing, 14d trace) | `claimRouter.ts` |
| Dispatch policy | Flat 30 to 90 day window, 3 attempts, Eastern hours, hardcoded in code (the per-carrier minimum in `carrier-configs.json` is documented but not enforced) | `carriers/adapter.ts:455` |
| Prompts | Claims_Agent prompt says "dental practice in Canada", scenarios A to J reference procedures, x-rays, EOB to patient, fee guide years | `vapi-squad-config.json` |
| Authorization | BAAL, provider number and carrier toggle stored in practice settings JSON per carrier | `types/practiceSettings.ts`; `adapter.ts` |
| Destination guard | Static allowlist built from `CARRIER_PHONE_MAP` (6 numbers plus CDCP) | `vapi/client.ts:373` |
| Metrics | 18-minute dental baseline per completed call | `services/insurance-analytics.ts:26` |

### 3.4 Incomplete, configured only, or stubbed

| Item | Status |
|---|---|
| Dispatch intent ledger (`CallDispatchIntent`, `ensureDispatchIntent`, `markDispatchSending`, `confirmDispatch`, `recordAmbiguousDispatch`, `reconcileStaleDispatchIntents`) | Table, RLS and helpers exist. A search of `src/` finds references only in the helper file itself and in tests (`tests/dispatch-intent-*.test.ts`, `tests/rls.strict.test.ts`). **No production dispatch path calls them.** `CallAttempt.dispatchIntentId` therefore stays null in production. I found no dynamic import, but absence of a caller in static search is not proof; confirm in a staging run. |
| Human-assisted squad | Referenced only by environment variable `VAPI_HUMAN_ASSISTED_SQUAD_ID` with a hardcoded UUID fallback (`vapi/client.ts:236`). Claims_Scribe's prompt and tool definitions are not in the repository; `humanAssistedOutcomeResolver.ts` states its scenario list "mirrors the SCENARIOS list in Claims_Scribe's system prompt (Vapi dashboard)." A grep for `Claims_Scribe` finds no squad JSON. The human-assisted squad is therefore not version-controlled and not covered by `vapiSquadConfig.test.ts`. |
| Autonomous squad entitlement | `autonomous_calls` is in no plan tier (`entitlements.ts`). The capability is implemented in config but commercially disabled. |
| Hold and transition tracking | A migration adds `hold_duration_seconds`, `ivr_navigation_seconds` and a `call_transitions` table (`20260914_add_call_hold_transfer_tracking`), but the Prisma `CallAttempt` model does not list those columns, and the processor only updates `activeAgent` and `liveState` when an explicit transition payload exists (`webhooks/holdTransitionProcessor.ts`). Measured hold duration is not reliably persisted today. Note `ALLOWED_AGENTS` also omits Claims_Scribe. |
| Prompt variable gaps (repo config only, live squad may differ) | The Claims_Agent prompt references `{{subscriber_token}}`, which `initiateCall` does not set; it never uses `{{patient_name}}` and speaks `{{patient_token}}` (a UUID) to the rep. Either the live squad differs from the repo copy or the prompt is not yet exercised against a rep. Needs a staging comparison. |
| TELUS | Adapter documents per-carrier minimum wait days that dispatch does not enforce. TELUS number in `CARRIER_PHONE_MAP` is a labeled placeholder. |
| Carrier portal and Tx23 flags | `portalFirstDispatch`, `supportsTransaction23` exist as config fields. I did not verify any consumer; do not claim an electronic channel exists. |
| Org/DSO pooling | Org-level block sibling check exists. Org-level reporting not assessed. |

### 3.5 Verified inconsistencies that matter for expansion

#### A. Scheduled and manual dispatch diverge

Both paths exist today and are implemented separately.

| Concern | Scheduled (`queueEngine.ts`) | Manual (`routes/insurance.ts:479`) |
|---|---|---|
| Mode selection | `effectiveHumanAssisted(planTier, humanAssistedMode)` at line 774; `squadId` set to the human-assisted squad at line 959 | **Not applied.** `initiateCall` receives no `squadId`, so `client.ts` falls back to `VAPI_SQUAD_ID`, the default (autonomous) squad |
| `CallAttempt.isHumanAssisted` | Set | Not set (defaults false). Would also mis-route the outcome resolver and learning gates |
| TELUS TPA phone | Resolved with `getTelusDialPhone`, escalates when unverified | Uses `carrierConfig.phone` directly, i.e. `CARRIER_PHONE_MAP.telus_adjudicare`, which is in the allowlist, so the call proceeds to the placeholder number |
| Fleet carrier concurrency | `carrierActiveCounts` snapshot | Skipped (documented as intentional in `adapter.ts:303` comments) |
| One active call per practice | Enforced | Only per claim |
| Pre-call triage (non-phone resolution) | `probeClaimStatus` | Not run |
| Learned navigation notes, known resubmission or documentation channel | Injected | Not injected (`ivrHints` only) |
| COGS throttle (`essentialOnly`) | Applied | Not applied (only `planGate.allowed`) |
| Practice address, relationship fields | Passed (address) | Address not passed |
| Duplicate protection | Vendor `Idempotency-Key` = `claimId:attempt`; queue state | Vendor key; row lock reservation; compensating cleanup |
| Dispatch intent ledger | Not used | Not used |

Consequence for the entitlement question in the brief: **Hold Sentinel only on every plan is enforced at the scheduler and not at the manual trigger.** Whether the manual trigger actually reaches the autonomous squad depends on what `VAPI_SQUAD_ID` points to in each environment, which I cannot see. The code does not prevent it.

A related third creation point exists: `processVapiDeskWebhook` creates a `CallAttempt` on `call.started` if none exists (`server/frontDesk/vapiDeskEvents.ts`). That row has `isHumanAssisted = false` regardless of squad.

#### B. Import reconciliation is not scoped by source

`closeClaimsMissingFromFullExport` is scoped by `practiceId` only and driven by a caller-supplied flag. A business with two exports (e.g. job-costing invoices and an accommodation ledger) that labels one `full` would stop every open item the other source owns. It also sets `recoveryRoute = STOP` without recording which source asserted coverage.

#### C. Single claim number as identity

`mergeClaimRows` sums every row sharing a claim number into one claim, intentionally, to stop line-level exports from being read as partial payments. That is correct for dentistry and wrong for a shared insurance claim with a repair invoice, supplement, tow and storage charge, where those are separate invoices with separate balances, separate due dates and potentially separate payers.

#### D. "Recovered" is not attribution

In `recovery/paymentVerification.ts`:

- `PAYMENT_VERIFY_STATUSES` includes `IN_QUEUE`, `CALLING` and `ON_HOLD`. A claim that is still waiting in the queue, with the insurer paying on its ordinary schedule and the export showing an insurer-paid amount, is credited in full as `PAYMENT_VERIFIED_SYNC`.
- `getDollarsRecovered` sums those events (`services/insurance-analytics.ts`). There is no comparison against when the payment was issued relative to any CollectRx call, no commitment link, no baseline expected pay date.
- This is honest "verified receipts." It is not "incremental recovery." The brief's instruction ("Verified receipts do not automatically establish incremental recovery attributable to Collectrx") is correct and not yet implemented.

#### E. Shared knowledge is keyed by carrier only

| Table | Key | Risk |
|---|---|---|
| `CarrierLesson` | carrier | Approved lessons apply to every tenant. Reasonable for IVR hints, wrong for program- or tenant-specific behavior. |
| `CarrierSubmissionChannel` | unique `[carrierId, channelType]` | One global slot, last writer wins, filled automatically from validated call facts. A tenant's case-specific destination (private adjuster fax, a claim-specific upload address) is promoted to every tenant's next call. |
| `HumanAssistedCarrierProfile` | carrier, category | Synthesized from `HumanAssistedCallLog` rows of all tenants. Mixed program and department behavior. |

#### F. Identity vault is patient-shaped

`PatientPHI` fields are fixed. Vehicle and property identifiers, employer or WSIB identifiers, and adjuster or claimant details have no home. The legacy `src/services/pii-vault.js` (referenced in a warning in `prismaClaimImporter.ts`) is a second, disconnected tokenizer; do not extend it.

#### G. Value metrics

- Time saved = number of attempts with any non-null outcome multiplied by 18 (`insurance-analytics.ts:26`). This counts `NO_ANSWER`, `HUNG_UP`, calls where staff spoke, and ignores hold time, review work and handoff time.
- Measured hold duration is not reliably available (section 3.4).

---

## 4. Shared architecture

### 4.1 Decision

Extend the existing Express and Prisma monolith. Evidence that separate services are not justified: tenancy, RLS, webhook ledger, billing gates, worker queue (BullMQ) and observability already live in one deployable and are working infrastructure; the new concerns are data-model and policy concerns, not scaling or isolation concerns. A single Vapi concurrency bottleneck exists (`vapiSlotBudget`, one call per practice per tick), which is a tuning matter.

Revisit only if (a) call dispatch needs independent scaling from the web tier, which `Dockerfile.worker` and BullMQ already allow, or (b) a vertical requires a different data residency posture.

### 4.2 Module boundaries [P]

New directories under `Collect-RX-main/src/server/`, each with one public interface file and no cross-imports except through it.

| Module | Responsibility | Replaces or wraps |
|---|---|---|
| `ledger/` | `InsuranceCase`, `Receivable`, `PaymentAllocation`, parties, attribution. Single owner of balance math. | Wraps `InsuranceClaim` via adapter (dental dual-write) |
| `registry/` | `Payer`, `PayerProgram`, `ContactRoute`, `AuthorizationGrant`, policy packs (windows, attempts, cooldown, hours, timezone) | `CARRIER_PHONE_MAP`, `CARRIER_CONFIGS`, practice-settings `carrierConfigs`, `adapter.validateDispatch` constants |
| `dispatch/` | The only module allowed to call Vapi to create a call. Implements `dispatch(taskId, trigger)` | `queueEngine` dispatch block, `insurance.ts` trigger route |
| `objectives/` | Objective packs: prompt fragments, field allowlist, tool set, outcome JSON schema, voicemail policy, escalation triggers, versioned | Claims_Agent monolithic prompt |
| `outcomes/` | Typed outcome ingestion, decision derivation from rules, evidence storage | `outcome/processor.ts` regex ladder as fallback only |
| `identity/` | Generalized vault bundles with field classification | Wraps `pii-vault.ts` |
| `knowledge/` | Scoped lessons, channels, profiles with promotion rules | `learning/*` |
| `measurement/` | Time ledger and attribution reports | `insurance-analytics.ts` |

Existing dental code keeps working; it calls the new modules through thin adapters.

### 4.3 Request flow after consolidation [P]

```
import / staff entry -> ledger (Case, Receivable) -> RecoveryTask created by policy
RecoveryTask due -> dispatch.dispatch(taskId, trigger = SCHEDULED | MANUAL | CALLBACK)
   lock task; authorization; policy window; block; concurrency; plan + vertical entitlement;
   resolve mode; resolve contact route + destination guard; build identity bundle from
   objective allowlist; capability grant; create intent READY -> SENDING -> Vapi call (idempotent)
   -> CONFIRMED + CallAttempt in one transaction
Vapi webhook -> outcomes (typed first, text fallback) -> decision engine -> RecoveryTask update
Import / remittance -> ledger PaymentAllocation -> attribution classifier -> measurement
```

---

## 5. Target data model [P]

All new tenant-owned tables carry `practice_id` (not renamed; `Practice` stays the tenant and remains the billing entity), a `FORCE ROW LEVEL SECURITY` policy using `app_rls_practice_allowed`, and a `created_at`/`updated_at` pair. Names below are logical; Prisma `@map` style follows the repo (snake_case tables).

### 5.1 Business and location

- **Tenant = `Practice`** (unchanged). A multi-location operator is already modeled by `Organization` plus `OrganizationPractice` (`schema.prisma:110`, `:148`), and `checkCarrierBlock` already applies sibling-block logic. Each physical location is a `Practice` row. This avoids a rename and keeps RLS simple.
- Add `practice_verticals(practice_id, vertical, enabled_at, config jsonb)` where `vertical` is a text value from a controlled set (`dental`, `rehab_allied`, `property_restoration`, `collision_tow_storage`, `equipment_pharmacy`). Entitlements gate on this plus plan tier.
- Add `import_sources(id, practice_id, name, system_kind, location_scope jsonb, entity_kinds text[], created_at)`: one row per feed (e.g. "job costing export", "accommodation ledger", "HCAI extract").
- Add `import_coverage(id, import_run_id, import_source_id, coverage_kind, from_date, to_date, location_ids, complete boolean, attested_by)`: what a particular run claims to cover (section 5.8).

### 5.2 Payer and program

- `payers(id, legal_name, kind, jurisdiction, active)`: insurer, TPA, administrator, government board. Global table, read-only to tenants (policy: select for all authenticated tenants, write only via platform role). `kind` in (`insurer`, `tpa`, `administrator`, `government_board`, `clearinghouse`).
- `payer_programs(id, payer_id, program_code, line_of_business, jurisdiction, effective_from, effective_to, policy_pack_id)`: e.g. dental group, extended health, auto SABS, property claims, WSIB health care. `carrier_id` enum value maps in through `legacy_carrier_id` for the six dental carriers; **the enum is not extended**.
- `policy_packs(id, version, rules jsonb)`: the data-not-code version of the constants now in `adapter.ts`: minimum age, maximum age before human escalation, attempt cap, cooldown, call window, timezone, allowed objectives, expected pay window, follow-up intervals. Versioned and effective-dated. Continues the existing principle that "carrier rules are data, not code."

### 5.3 Insurance case

`insurance_cases` (the insurer's file; distinct from what the business invoices)

| Field | Notes |
|---|---|
| `id`, `practice_id`, `payer_program_id` | |
| `case_number` | Insurer's claim or file number as the insurer uses it |
| `case_number_norm` | Normalized for matching |
| `loss_or_service_date` | |
| `assigned_adjuster_party_id` | Nullable |
| `identity_token` | Vault pointer, section 5.10 |
| `status` | Business-side lifecycle, not insurer status |
| `source_id` | `import_sources` |
| Unique | `(practice_id, payer_program_id, case_number_norm)` |

A dental `InsuranceClaim` maps to one case plus one receivable.

### 5.4 Receivable (invoice and line)

`receivables` (the business's invoice; the thing that is owed)

| Field | Notes |
|---|---|
| `id`, `practice_id`, `insurance_case_id` | A case has many receivables |
| `receivable_kind` | enum-like text: `dental_claim`, `treatment_invoice`, `progress_invoice`, `completed_work_invoice`, `supplement`, `tow_charge`, `storage_charge`, `accommodation_period`, `equipment_invoice`, `repair_invoice` |
| `invoice_number`, `source_id`, `source_row_key` | Unique `(practice_id, source_id, invoice_number)` |
| `billed_cents`, `outstanding_cents`, `accrual_schedule_id` | Money in integer cents (existing tables use `Decimal(10,2)`; new tables use cents to avoid float drift) |
| `issued_at`, `due_at`, `service_from`, `service_to` | |
| `legal_debtor_party_id`, `payment_recipient_party_id` | See 5.5 |
| `scope_status` | `agreed`, `disputed`, `pending_supplement` (restoration and collision) |
| `legacy_claim_id` | Nullable FK to `insurance_claims`; the dental bridge |
| `closed_reason` | `paid_in_full`, `written_off`, `reassigned_to_patient`, `superseded`, `suspected_settled`, `void` |

`receivable_lines(id, receivable_id, line_no, code, description, amount_cents, qty, unit)` only where the objective needs line detail (e.g. disputed scope, OCF-style line items, storage days).

`accrual_schedules(id, receivable_id, rate_cents_per_unit, unit, start_date, end_date_or_null, cap_cents, last_computed_at)` for time-based storage and accommodation. Outstanding is a computed projection, never edited by hand.

### 5.5 Responsible parties

The brief requires legal debtor, insurer, administrator, payment recipient and contacted party modeled separately.

`parties(id, practice_id nullable, kind, display_name, identity_token nullable, org_ref nullable)`: person, organization, payer, adjusting firm. Tenant-private by default; a party row linked to a platform `payer` carries `payer_id`.

`case_party_roles(id, insurance_case_id nullable, receivable_id nullable, party_id, role, effective_from, effective_to)` with `role` in:

| Role | Meaning |
|---|---|
| `legal_debtor` | Who owes the business under contract or statute |
| `insurer` | Entity that indemnifies |
| `administrator` | TPA or adjusting firm that handles on the insurer's behalf |
| `payment_recipient` | Who actually receives the money (may be the policyholder, a joint payee, the business, a mortgagee) |
| `claimant_or_insured` | Person whose loss or treatment it is |
| `referrer` | Source of work (police tow, referring contractor, DRP) |
| `representative` | Lawyer or public adjuster; changes call permission |

`contacted party` is **not a role on the case**. It is per call: `call_attempts.contacted_*` (section 5.7), because the person reached rarely equals the roles above.

Important rules this enables: restoration receivables often have `legal_debtor = policyholder` while the call goes to `administrator`; collision receivables can have `legal_debtor = vehicle owner` for the deductible and `insurer` for the remainder as two receivables on one case.

### 5.6 Contact route, authorization, recovery task

`contact_routes` (replaces the static allowlist while keeping its guarantee)

| Field | Notes |
|---|---|
| `id`, `scope_kind` (`platform`, `tenant`, `case`), `practice_id` nullable, `insurance_case_id` nullable | |
| `payer_program_id`, `department`, `purpose` (`claim_status`, `payment_trace`, `preauth`, `supplement`, `provider_services`) | |
| `phone_e164`, `extension`, `ivr_path jsonb`, `hours jsonb`, `language` | |
| `verification_status` | `unverified`, `staff_attested`, `platform_verified`; `verified_by`, `verified_at`, `evidence_ref` |
| `expires_at`, `active` | Stale routes expire |

Destination guard [P]: dispatch may dial only a number that resolves to a row in scope for the tenant, with a sufficient verification level for the current mode. Seed `platform` routes from `CARRIER_PHONE_MAP` (preserves today's six). `tenant` and `case` routes (assigned adjuster direct line, extension) require staff attestation and are only used first in human-assisted mode until a successful call confirms them. This preserves destination verification, which is the purpose of the current allowlist, and adds departments, extensions and adjusters.

`authorization_grants(id, practice_id, payer_program_id nullable, party_id nullable, grant_kind, status, document_ref, valid_from, valid_to, scope jsonb)` with `grant_kind` in (`billing_agent_letter`, `direction_to_pay`, `assignment_of_benefits`, `claimant_consent`, `provider_registration`, `other`). Replaces the booleans inside practice settings JSON; the dental `authorizationSubmitted` and provider number migrate in. The scope field declares which objectives it permits (e.g. status inquiry yes, preauth no).

`recovery_tasks` (the dispatchable unit; supersedes `CallQueue` conceptually)

| Field | Notes |
|---|---|
| `id`, `practice_id`, `receivable_id` or `insurance_case_id` | A task can be per receivable or per case ("chase everything on this claim in one call") |
| `objective` | `status_check`, `payment_trace`, `confirm_receipt`, `supplement_follow_up`, `documentation_request`, `preauth_request`, `adjuster_callback` |
| `mode_requested`, `mode_effective` | `autonomous`, `hold_assist`, `staff_led_scribe` |
| `state` | `pending`, `dispatching`, `in_call`, `awaiting_callback`, `gated`, `escalated`, `closed` |
| `attempts`, `max_attempts`, `next_due_at`, `cooldown_until` | From policy pack |
| `legacy_queue_id` | Bridge to `call_queue` |
| `gate_ids` | Links to existing `claim_recovery_actions` generalized (below) |

`claim_recovery_actions` and `claim_recovery_events` are kept; add nullable `recovery_task_id`, `receivable_id` so they serve both worlds without a copy.

### 5.7 Call attempt, evidence, payment allocation

`call_attempts` additions (additive):

| Added column | Purpose |
|---|---|
| `practice_id` | Backfill from claim; lets RLS stop joining through `insurance_claims` for non-dental |
| `recovery_task_id`, `contact_route_id`, `objective`, `mode`, `objective_pack_version` | Traceability |
| `contacted_name`, `contacted_role`, `contacted_department` | Per-call contacted party |
| `staff_talk_seconds`, `staff_participant_id` | Measured staff participation |
| `machine_seconds`, `hold_seconds`, `ivr_seconds` | Measured machine time |
| `capability_grant_id` | Snapshot of what the call was allowed to do |
| `claim_id` | Relaxed from NOT NULL to nullable in WP-5, only when the first non-dental task dispatches |

`call_facts(id, call_attempt_id, practice_id, fact_kind, value jsonb, confidence, source)` holds typed statements and commitments (5.9).

`case_evidence(id, practice_id, insurance_case_id, receivable_id nullable, kind, status, document_ref, attested_at, attested_by)` generalizes `ClaimEvidenceItem`. Clinical or technical files stay in the customer's own system (as today); only status and a pointer are held.

`payment_allocations`

| Field | Notes |
|---|---|
| `id`, `practice_id`, `receivable_id`, `remittance_id` nullable | |
| `kind` | `insurer_payment`, `patient_or_customer_payment`, `adjustment`, `write_off`, `refund_or_reversal`, `holdback_release`, `unknown_balance_change` |
| `amount_cents`, `occurred_at`, `recorded_at` | |
| `evidence_kind` | `remittance_advice`, `export_insurer_paid_amount`, `staff_confirmed`, `balance_delta_only` |
| `source_import_run_id`, `source_id` | |
| `reconciled` | Boolean, set only by evidence stronger than `balance_delta_only` |

`remittances(id, practice_id, payer_id, payment_ref, method, issued_at, received_at, total_cents, payee_text)` so one cheque or EFT can allocate across many receivables and many cases (needed for MVA rehab and collision). Many-to-many via allocations.

### 5.8 Import scoping [P]

Replace "full export" semantics with explicit coverage:

- A run declares `(import_source_id, entity kinds, date window, location ids, complete)`.
- Absence closes nothing. A receivable missing from a covered, complete run becomes `suspected_settled`: calls stop pending confirmation, it does **not** become recovered, and it requires either a later remittance or a staff confirmation to reach `paid_in_full`. Retain today's mass-absence guard (50 percent and 10 items) and add a per-source baseline so a source that normally returns 200 rows and returns 20 is held.
- Receivable identity is `(practice_id, source_id, invoice_number)`, not claim number. Line-level rows no longer merge across invoices. Dental keeps its existing merge for a single claim.

### 5.9 Outcome dimensions [P]

Separate records, never one overloaded status:

| Dimension | Storage | Example values |
|---|---|---|
| What the rep said | `call_facts` kind `rep_statement` | "invoice received 2026-09-14", "approved at $1,820", "payment issued, cheque, payee X" |
| Commitments | `call_facts` kind `commitment` | `payment_promised`, `payment_issued`, `resubmit_requested`, `document_requested`, `callback_promised` |
| Recommended action | `recovery_tasks` + decision log | proposed by the model, advisory only |
| System decision | `claim_recovery_events` generalized | derived by rules from typed facts, not by model text |
| Payment reality | `payment_allocations` | only from remittance, export insurer-paid amount, or staff confirmation |
| Balance change cause | `payment_allocations.kind` | payment, adjustment, write-off, reversal, unknown |
| Attribution | `recovery_attributions` | below |

`recovery_attributions(id, payment_allocation_id, class, first_touch_at, commitment_fact_id nullable, window_days, rule_version)`:

| Class | Rule (initial, configurable in the policy pack) |
|---|---|
| `attributed` | A CollectRx call produced a documented payment commitment or a corrected-status action (e.g. "not received", then resubmitted, then paid), the payment reference matches or the amount matches within tolerance, and payment issue date is after that call and inside the attribution window |
| `assisted` | A CollectRx call occurred in the window but no commitment link exists |
| `organic` | Payment issued before first CollectRx touch, or within the program's normal expected-pay window of the invoice date with no intervening commitment |
| `unclassified` | Evidence insufficient (balance delta only, issue date unknown). Never counted as recovery |

Reporting rule: show **verified receipts** (all reconciled insurer payments on engaged tasks) and **attributed recovery** (class `attributed` only) as separate numbers. `assisted` is shown as "collected during engagement," not as recovery. Historic `PAYMENT_VERIFIED_SYNC` events are relabeled `legacy_unclassified` and left immutable.

### 5.10 Identity and sensitive information [P]

Generalize the vault, do not weaken it.

- Keep `PhiVaultEntry` encryption, per-tenant RLS and TTL. Add `bundle_kind` (`patient_member`, `claimant_vehicle`, `claimant_property`, `worker_wsib`, `employer_account`) and a per-field `sensitivity` registry.
- **Treat vehicle, property and employment identifiers as sensitive by default.** A VIN or plate, a property address with a loss date, or an employer and injury detail are personal information tied to an identifiable person. Whether a given industry is under PHIPA, PIPEDA or a provincial private-sector statute is **[X]** and needs counsel. The engineering default is to give every bundle the same protections as health identity.
- **Objective field allowlist:** each objective pack declares exactly which bundle fields may be injected as ephemeral Vapi variables. The dispatch service builds variables from that allowlist. Data minimization becomes server code, not prompt text.
- Metadata still carries tokens only. Add a lint test that fails if any variable not on the allowlist appears in the payload.
- Transcript scrubbing patterns (`PHI_TRANSCRIPT_PATTERNS`) extend per bundle kind (VIN, plate, address, WSIB claim number formats).

### 5.11 Shared knowledge scoping [P]

Add to `CarrierLesson`, `CarrierSubmissionChannel`, `HumanAssistedCarrierProfile` (or successors):
`scope_kind` (`platform`, `payer_program`, `tenant`, `case`), `payer_program_id`, `department`, `jurisdiction`, `practice_id` nullable, `insurance_case_id` nullable.

- Unique constraints include scope (`payer_program_id`, `department`, `scope_kind`, `practice_id`), replacing the single `[carrierId, channelType]` slot for new rows. Legacy rows get `scope_kind = platform`.
- Writes default to `tenant` scope. A case-specific destination (adjuster fax, claim upload link) is always `case` scope and never promoted.
- Promotion `tenant -> payer_program`: at least N distinct tenants confirm the same destination on validated calls, no tenant or case tokens in text, and human approval. N and the review rule are product decisions.
- RLS: `platform` and `payer_program` rows readable by all tenants; `tenant` and `case` rows readable only by owner.

---

## 6. Domain adaptation matrix

Reading guide. **Automation tier** per objective: **E** = squad can execute end to end, **W** = needs a domain workflow (gates, documents, staff step) around the call, **J** = requires staff judgment, squad prepares and hands off. Policy values below (windows, intervals) are starting configuration to be set in the policy pack, not claims about what any insurer requires. Outside facts are tagged [X].

### 6.1 Dentistry (retained)

| Dimension | Content |
|---|---|
| Identifiers | Member ID, group, claim number, DOB, provider number, CDT codes (existing) |
| Contact pattern | Six carriers via IVR to provider claims lines; TELUS needs underlying TPA |
| Objectives | status_check (E), payment_trace (E), documentation_request (W), CDCP reconsideration (W/J) |
| Blockers | Missing documentation, resubmission, annual max, CDCP rules |
| Follow-up | 30 to 90 days, 3 attempts, 72h processing recall, 14d trace (existing, becomes policy pack `dental_v1`) |
| Staff escalation | Over 90 days, denial appeal, x-rays |
| Reconciliation | PMS export balance (existing) plus new allocation records |
| Change | None in behavior. Adapter shadow-writes cases and receivables. |

### 6.2 Auto rehabilitation and allied healthcare

Providers: physiotherapy, multidisciplinary rehab, chiropractic, psychology, occupational therapy, speech-language pathology, massage therapy. Three payment workflows share the same clinic.

| Dimension | Motor vehicle accident (Ontario SABS) | Extended health benefits (EHB) | Workers' compensation (WSIB) |
|---|---|---|---|
| Legal debtor | Typically the claimant's auto insurer for approved benefits; claimant or no one for unapproved portions | Insurer for covered portion; patient for the balance | WSIB for authorized services |
| Insurer or administrator | Auto insurer and its assigned adjuster | Group insurer or TPA (the same carriers already supported, plus others) | Workplace Safety and Insurance Board |
| Case identifiers | Claim number, policy, loss date, claimant identity, treatment plan and invoice identifiers | Member ID, group, patient identity, service codes | WSIB claim number, worker identity, employer, WSIB provider billing number |
| Receivable kinds | Treatment invoice, assessment invoice | Treatment invoice (direct-billed) | Treatment invoice, report fee |
| Contact pattern | Adjuster direct line or claims unit; plan approval status via adjuster | Provider services IVR (existing pattern) | Provider billing support line; electronic billing status first [X] |
| Call objectives | confirm receipt of invoice (E), payment status (E), why short-paid vs approved plan (W), request payment trace or reissue (E), plan approval status (W) | Claim status (E), rejected or pending reason (E), resubmission channel (W) | Bill status (E), reason for rejection or adjustment (W) |
| Blockers | Plan not approved or partially approved, insurer exam pending, benefit exhausted, dispute with tribunal pending, claimant represented | Eligibility or coverage maxed, missing receipt, coordination of benefits | Authorization missing, billing outside time limit |
| Follow-up rule (starting) | Pay window anchored on invoice receipt [X: FSRA states invoices are to be paid within 30 days of receipt under the SABS, and overdue amounts carry interest at 1 percent per month, per FSRA material; re-verify against the current regulation before encoding] | Existing dental-style window, per program | Bill window anchored on electronic submission [X: archived WSIB policy states bills must be submitted within 6 months of service with escalating penalties; confirm currency] |
| Staff escalations (J) | Any coverage or plan dispute; any mention of lawyer, tribunal or litigation; represented claimant; insurer asks to reduce | Appeals and COB disputes | Entitlement or authorization decisions |
| Reconciliation | One insurer payment often covers several invoices across several patients. Needs `remittances` and many-to-many allocation. Invoices typed by plan and invoice id. | Same as dental: statement or export balance | WSIB remittance statement via electronic billing if exported [X] |
| Platform dependency | The Ontario auto health claim system is a separate electronic submission channel (HCAI) that is evolving [X: FSRA reviewing the system; form versions changed for July 2026]; do not build an integration. Treat as an import source. | Existing | Do not build an integration. Import source only. |

Reuse and fit: EHB reuses the existing squad and carriers almost unchanged and is the shortest path to a non-dental vertical. MVA introduces adjuster-led contact, multi-invoice remittances and represented-claimant rules.

### 6.3 Property restoration and emergency housing

| Dimension | Content |
|---|---|
| Who is the customer | Independent restoration contractors, franchise operators, temporary accommodation providers |
| Legal debtor | Usually the property owner (the contract is with the owner). The insurer is the funding source, not necessarily the debtor. This is the sharpest difference from dentistry. |
| Parties | Policyholder, insurer, assigned adjuster (staff or independent firm), TPA, mortgagee (may be a joint payee), public adjuster or lawyer if retained |
| Identifiers | Insurer claim number, policy, loss date and cause, property address, adjuster name and contact, job or work-order number, estimate and invoice numbers, deductible amount |
| Receivable kinds | Progress invoice, completed-work invoice, supplement, emergency mitigation invoice, accommodation period invoice (time-based) |
| Contact pattern | Mostly a named adjuster, direct line or queue, not an IVR tree. Contact route often `case` scope. Callback-heavy, voicemail-heavy. |
| Objectives | confirm invoice received by adjuster (E), approved or pending amount (E where adjuster states it), payment issue details including payees and delivery (E), supplement or scope approval status (W), schedule of inspection (W), recoverable holdback release conditions (W) |
| Blockers | Adjuster inspection pending, scope disputed, depreciation holdback pending completion, coverage position undecided, joint payee endorsement needed, deductible not collected |
| Follow-up rule (starting) | Event-driven rather than fixed: follow up after invoice receipt confirmation, then after each promised date, with a cap on repeated "adjuster away" outcomes before staff takes over |
| Staff escalations (J) | Scope or price dispute, supplement negotiation, anything touching liens or legal remedies [X: Ontario construction lien timing and prompt-payment rules exist and must be reviewed by counsel; the squad never advises on them], represented insured, request to reduce or release |
| Reconciliation | Payment is often a cheque made out to the insured and contractor (and possibly mortgagee) delivered to the insured. The insurer says "paid" before the contractor has money. Reconciliation requires `payment_recipient`, delivery status, and a contractor-side deposit record. Allocate across progress invoices, hold back, deductible. |
| Accommodation providers | Time-based `accrual_schedule`, authorization number or letter of authority from insurer or TPA, approved nights versus billed nights, and the date authorization ends. |

### 6.4 Collision repair, towing and storage

| Dimension | Content |
|---|---|
| Customers | Independent shops, multi-location operators, towing and recovery companies, storage facilities |
| Case structure | One insurance claim, several invoices from possibly several tenants (a tow company and a body shop each chase the same insurer for different invoices on the same claim) |
| Legal debtor | Mixed: vehicle owner for the deductible and non-covered items; insurer by direction or assignment for the rest; sometimes the insurer by its own authorization (tow and storage) |
| Identifiers | Insurer claim number, policy, VIN, plate, loss date, adjuster or appraiser, estimate and supplement ids, tow authorization or PO number, storage start date and daily rate |
| Receivable kinds | Repair invoice, supplement(s), tow charge, storage charge (accruing), possibly a deductible receivable owed by the owner |
| Contact pattern | Assigned adjuster or appraiser, insurer claims unit, sometimes direct repair program coordinator. Adjuster direct line is `case` scope. |
| Objectives | confirm each invoice received and its status (E), supplement approval status (W), storage authorization and release or total-loss decision (J/W), payment issue details (E), request payment of tow and storage separately from repair (E) |
| Blockers | Supplement not approved, vehicle assessment pending, total loss decision pending, storage authorization expired, rate dispute, owner dispute |
| Follow-up rule (starting) | Faster cadence for accruing storage (each day outstanding grows); stop-and-escalate trigger when accrued storage crosses a configured share of vehicle value or a business-set cap |
| Staff escalations (J) | Total loss versus repair, rate disputes, who authorizes continued storage, lien or sale actions [X: statutory storage and repair lien rules are provincial and need counsel] |
| Reconciliation | Insurer pays net of deductible, often one payment to the shop that includes tow and storage it advanced. Allocation must split the single payment across invoices and across the two tenants' books when a shop pays a tow company out of the insurer cheque (out of scope: model the allocation only against the tenant's own receivables). |

### 6.5 Medical equipment, pharmacy, hearing and disability-related services

Two different things are mixed in the brief and must stay separate.

**A. Existing unpaid receivables** fit the thesis: equipment supplier invoices, orthotics, audiology clinic claims, pharmacy claims that were rejected, pended or short-paid.

**B. Preauthorization for future services** is not an AR chase. Its output is an approval reference and amount, not money. Model as `preauthorizations` (below), with its own objective `preauth_request`, no receivable, no payment attribution.

| Dimension | Content |
|---|---|
| Customers | Equipment suppliers, orthotics providers, audiology clinics, retail and specialty pharmacies |
| Payers | Group insurers and TPAs (reuse), provincial assistive-device or drug programs, workers' compensation, auto insurers [X: which government programs accept provider phone follow-up is unverified and program-specific; I am not asserting any] |
| Identifiers | Member ID, group, authorization or preauth number, device or drug identifiers, prescriber where required, invoice and claim numbers |
| Contact pattern | Provider services IVR (EHB), program-specific lines |
| Objectives (A) | Claim status (E), rejection reason (E), pend reason (W), resubmission channel (W) |
| Objectives (B) | Is preauth required (E), what must be submitted (W), status of a submitted request (E), validity period and approved amount (E) |
| Blockers | Missing prescription or assessment, authorization expired, coverage exclusions, benefit maximum |
| Staff escalations (J) | Clinical justification, appeals, anything that requires clinician input |
| Reconciliation | Remittance statements per batch; rejects need re-adjudication, not a payment |
| Fit warning | Where adjudication is real-time and electronic, unpaid receivables are fewer and phone follow-up is a smaller workload. Pharmacy is the weakest fit pending evidence from the product itself (human-assisted logging). Do not build for pharmacy before the first verticals produce data. |

`preauthorizations(id, practice_id, insurance_case_id nullable, payer_program_id, subject, status, reference, approved_amount_cents, valid_from, valid_to, call_attempt_id)`.

**Employer HR and disability administration (separate assessment).** Employers deal with insurers about their staff's disability and leave, accommodation, claim forms and benefits enrolment. In most of those workflows the business is **not** chasing payment for its own services, so there is no receivable and the thesis (reducing staff time chasing outstanding insurance AR) does not apply. The architecture could host it as another objective family, but it is a different product with different privacy exposure (health information about employees). **Recommendation: exclude from this expansion.** One narrow sub-case does fit: an employer that advanced salary continuance or benefits and awaits reimbursement from an insurer, where a real receivable exists. Treat that as an `equipment_pharmacy`-style receivable only if demanded. [X: whether this fits any customer is not established here.]

### 6.6 What the squad executes, by tier

| Objective family | Dental | Rehab (EHB) | Rehab (MVA) | WSIB | Restoration | Collision/tow/storage | Equipment/hearing |
|---|---|---|---|---|---|---|---|
| Hold wait and rep detection | E | E | E | E | E | E | E |
| Invoice or claim status | E | E | E | E | E | E | E |
| Payment trace details | E | E | E | E | E | E | E |
| Resubmission channel | W | W | W | W | W | W | W |
| Document request | W | W | W | W | W | W | W |
| Scope, price, coverage dispute | J | J | J | J | J | J | J |
| Storage or accommodation authorization | n/a | n/a | n/a | n/a | W/J | W/J | n/a |
| Preauthorization | n/a | n/a | n/a | n/a | n/a | n/a | E |
| Legal, lien, represented party | J | J | J | J | J | J | J |

---

## 7. Squad design

### 7.1 Role reuse

| Role | Disposition |
|---|---|
| IVR_Navigator (silent, DTMF only) | Reuse. Inputs change from `carrier_ivr_instructions` string to a structured `contact_route.ivr_path` plus language. Adds adjuster-direct and extension handling: if the route is a direct line with no IVR, the squad starts at Hold_Sentinel or goes straight to the rep agent. |
| Hold_Sentinel (silent, hands back on first human) | Reuse unchanged. Highest cross-vertical labor saver. Add voicemail detection and handling hook (7.4). |
| Claims_Agent | Refactor into `Representative_Agent` composed per call from the **objective pack** (7.2). Same behavior discipline (reference capture, refusal protocol, deadline lock-in, no settlements, no US law citations). Remove dental text from the common core. |
| Escalation_Closer | Generalize to `Documentation_Closer`: confirms what must be sent, where, by when, and which staff role owns it. Keep a clinical or technical documentation variant. |
| Resolution_Closer | Keep. Emits the typed outcome envelope (7.3). |
| Claims_Scribe (human-assisted) | Reuse. Bring its prompt and tool schema into the repository (today dashboard-only). |

Do not add a new role until a measured need exists. A "Voicemail_Agent" is a behavior of the Representative_Agent under a voicemail policy, not a new squad member.

### 7.2 Objective packs [P]

A pack is a versioned, tested bundle stored in the repository and loaded by the dispatch service:

```
objectives/<objective>/<vertical>/v<N>/
  prompt.fragment.md       domain scenario text (appended to the common core)
  identity.allowlist.json  fields that may be injected as variables
  tools.json               tool names permitted (e.g. verify_amount, request_staff_handoff, submit_call_outcome)
  outcome.schema.json      typed outcome envelope extension for this objective
  voicemail.policy.json    NONE | MINIMAL | SCRIPTED, with text
  escalation.triggers.json phrases/conditions that force handoff (lawyer, tribunal, dispute, deceased...)
  tests/                   golden transcripts + schema validation cases
```

Assembly is server-side at dispatch: the squad itself stays generic; the per-call overrides carry the assembled prompt fragment and variable set. Today `assistantOverrides` already carries `variableValues` and `metadata`; whether Vapi allows per-call prompt/tool overrides across squad members is an **[X]** to confirm in staging before relying on it. Fallback is one squad per vertical, created from the same pack bundle.

What varies by domain:

| Element | Varies? | Notes |
|---|---|---|
| Disclosure and refusal protocol | No | Common core (also CRTC conservative disclosure text [X: legal review remains an open item per repo compliance docs]) |
| Authentication fields spoken to rep | Yes | Allowlist: claim number, policy, loss date, VIN, address, WSIB claim, provider number |
| Scenarios | Yes | Per objective and vertical |
| Tool set | Partly | Payment verification for AR objectives; none for preauth |
| Outcome schema | Yes | Typed extension per objective |
| Tone and terminology | Yes | Adjuster conversations versus IVR rep conversations |
| Voicemail behavior | Yes | Policy per pack |

### 7.3 Typed outcomes [P]

Replace regex inference as the primary path with a tool-submitted, schema-validated envelope. Regex classification remains only as a fallback flagged `source = inferred` and never auto-resolves anything financial (consistent with today's financial gate in `resolveGatedClaimStatus`).

```json
{
  "schemaVersion": 2,
  "objective": "status_check",
  "contact": { "repName": "...", "role": "adjuster", "department": "...", "referenceNumber": "..." },
  "statements": [
    { "kind": "invoice_status", "value": "received", "date": "2026-09-14", "confidence": "stated" },
    { "kind": "approved_amount_cents", "value": 182000, "confidence": "stated" }
  ],
  "commitments": [
    { "kind": "payment_issued", "method": "cheque", "date": "2026-09-30", "amountCents": 182000, "payee": "...", "reference": "...", "evidence": "rep_statement" }
  ],
  "blockers": [{ "kind": "document_requested", "detail": "...", "deadline": "..." }],
  "callbacks": [{ "from": "adjuster", "window": "2026-10-14 pm" }],
  "flags": { "automationSuspicion": false, "represented": false, "dispute": false },
  "unresolved": []
}
```

The server validates against the pack schema, writes `call_facts`, then the **decision engine** (rules, in code, unit tested) derives the task state. The model proposes; the server decides. A commitment of kind `payment_issued` creates an expectation to verify, not a reconciled payment.

### 7.4 Voicemail and callback handling [P]

| Case | Behavior |
|---|---|
| Voicemail reached | Policy from pack. Default `MINIMAL`: business name, that it is an automated call on behalf of the business, callback number, and a non-identifying reference token. No claimant name, no amounts, no case details. Never leave identity data on voicemail. Record `voicemail_left` as a fact. Count against the attempt cap but with a distinct longer cooldown. |
| Rep promises a callback | Create `callback_expectations(recovery_task_id, expected_from, window, number_given)`. The number given is the business billing phone (today's `practice_phone`). Task state `awaiting_callback`; no redial inside the window; staff are notified on window expiry. |
| Inbound callback arrives at the business | Staff UI logs the inbound call against the task (the same typed envelope, `mode = staff_led_scribe` with no Vapi). Inbound squad is out of scope for this phase. |
| Adjuster says "email me" | Recorded as a `documentation_request` commitment with the address as a `case`-scope route. Never promoted. |

### 7.5 Server-controlled permissions (capability grant) [P]

Prompts are advisory. Permissions are issued by the server per call and enforced at the tool server and in the decision engine.

`capability_grants` snapshot per call attempt:

| Capability | Examples |
|---|---|
| Mode | `autonomous`, `hold_assist`, `staff_led_scribe`. Determined by one function (see 7.7) |
| Disclosure fields | The allowlist fields only |
| Allowed commitments to request | Trace, reissue, resubmission, document list. Never settle, reduce, agree to payment plan, concede liability, agree to a scope |
| Allowed tools | From the pack |
| Forced handoff triggers | Lawyer, tribunal, dispute, represented, deceased, minor, threat, complaint |
| Max duration, max attempts, quiet hours | From policy pack and carrier timeouts |

The tool endpoints (`log_call_outcome`, `verify_amount`, `request_staff_handoff`, new `submit_call_outcome`) reject outputs outside the grant, e.g. an outcome claiming a settlement. Today `verify_payment_amount` already reads the expected amount from the DB rather than trusting the model; this extends that stance to all tools.

### 7.6 Human-assisted mode as the discovery instrument

The brief rules out interviews as a prerequisite. The product already contains the substitute: in `hold_assist` / `staff_led_scribe`, Claims_Scribe records what the rep actually said (`HumanAssistedCallLog`), and a synthesis job folds it into per-carrier playbooks. Every new vertical should launch in human-assisted mode so that call-by-call evidence sets the policy packs (windows, typical blockers, correct routes, voicemail behavior) before any autonomous graduation. This is consistent with ADR 0003. Scoping fix: logs and profiles must carry the new scope fields (5.11).

### 7.7 One mode decision function

```
resolveMode(plan tier, vertical entitlement, practice setting,
            objective pack maxMode, route verification level, payer-program block state)
  -> mode
```

Rules: lowest of what the plan allows, what the pack allows, and what the route's verification level allows. `autonomous` stays unavailable until a plan includes `autonomous_calls` and a payer program has passed graduation criteria (ADR 0003). The function lives in `dispatch/`, is called by every trigger, and is the **only** place mode is chosen.

Distinguish three layers explicitly in code and in docs:

| Layer | Meaning | Today |
|---|---|---|
| Implemented capability | The squad can do it | Autonomous squad config exists in repo; human-assisted squad is dashboard-only |
| Commercial entitlement | The plan includes it | `autonomous_calls` on no plan |
| Enabled workflow capability | This practice, payer program and objective are switched on and authorized | Per-practice setting and per-carrier authorization; manual trigger ignores part of this |

---

## 8. End-to-end examples

Names and figures are synthetic.

### 8.1 Rehabilitation invoice (Ontario MVA)

Tenant: "Lakeside Physio" (`rehab_allied`). Source: HCAI-style export imported as a CSV (an import source, not an integration).

1. **Import.** Source `sources/hcai_export`. Row: invoice `INV-4471`, claim number `AX-88213` (insurer file), billed $1,820.00, date issued 2026-09-04. Create `insurance_case` (payer program "Auto, Ontario SABS", case number `AX-88213`), `receivable` kind `treatment_invoice` (legal debtor party: insurer for the approved portion, recipient: clinic). Identity token holds claimant name, DOB, policy number.
2. **Policy.** Policy pack `rehab_mva_v1` sets first follow-up 14 days after issue (starting value), expected pay window from invoice receipt [X: 30 days under the SABS per FSRA material, to verify], max 3 attempts, cooldown 3 business days. A `recovery_task` (`status_check`) is created, due 2026-09-18.
3. **Dispatch.** Task due; dispatch service evaluates: authorization grant (`billing_agent_letter` for this program, valid), no block on the payer program, route found: case-scope adjuster line given by staff at intake (`staff_attested`, unverified in the call sense), so mode resolves to `hold_assist`. Capability grant built; variables limited to claim number, policy number, loss date, provider number, invoice number and amount. Intent READY -> SENDING -> Vapi (idempotent) -> CONFIRMED with `CallAttempt`.
4. **Call.** Direct line goes to adjuster voicemail. Hold_Sentinel detects voicemail; pack policy `MINIMAL`: leaves business name, automated nature, callback number, reference token. Fact `voicemail_left`. Task state `awaiting_callback`, cooldown 3 business days.
5. **Second attempt.** Adjuster's assistant answers; staff takes the line (hold_assist). Claims_Scribe logs: invoice received 2026-09-08, approved $1,640.00 of $1,820.00, difference "above rate guideline for service", payment cheque issued 2026-09-17, reference `CHQ-55120`. Typed envelope: statements and a `payment_issued` commitment. `flags.dispute = false`.
6. **Decision.** Rules: `payment_issued` commitment plus short-pay of $180.00. The $1,640.00 gets a verification expectation (look for payment by 2026-09-27); the $180.00 shortfall creates a staff review task (`J`, dispute or write-down decision). The system never agrees to the reduction.
7. **Reconciliation.** Next import shows a remittance (one cheque `CHQ-55120`, $4,310.00) covering `INV-4471` and three other invoices. Allocation splits the cheque across four receivables. Attribution for `INV-4471`: payment issue date 2026-09-17 follows a call that recorded the commitment and cheque reference matches, class `attributed`. The other three invoices were not touched by CollectRx: `organic`. Verified receipts: $4,310.00. Attributed recovery: $1,640.00.
8. **What the report says.** Time ledger: machine seconds for IVR and hold, staff talk minutes for call 2, review minutes for the short-pay task.

### 8.2 Restoration invoice

Tenant: "Northfield Restoration" (`property_restoration`). Source: job-costing export (progress invoices) and a separate accommodation ledger (two sources, section 5.8).

1. **Import.** Case: insurer claim `PR-203918`, property at a masked address, loss date 2026-08-11, adjuster "R. Mehta" (independent adjusting firm, `administrator`). Receivables: `PI-1` progress invoice $18,400 (issued 2026-09-01), `CW-1` completed-work invoice $22,900 (issued 2026-09-28), `SUP-1` supplement $3,100 (disputed scope). Parties: legal debtor = policyholder; insurer = named insurer; administrator = adjusting firm; payment recipient = policyholder (joint payee with contractor, mortgagee unknown). Identity bundle `claimant_property`.
2. **Tasks.** Task per case (`status_check`) covering `PI-1` and `CW-1`; `SUP-1` is excluded from automated calls because `scope_status = disputed` (staff gate `scope_dispute` created at import).
3. **Dispatch.** Route is the adjuster's direct number (case scope). Mode `hold_assist`. Variables: claim number, policy, loss date, property address (minimization: only street and city if the objective allowlist says so), invoice numbers and amounts. Not the owner's DOB or phone.
4. **Call.** Staff-led with scribe. The adjuster says `PI-1` was approved at $15,200 (depreciation holdback $3,200 recoverable on completion), payment is being issued as a cheque payable to the insured and the contractor, mailed to the insured. Envelope: approved amount, `payment_issued` commitment with payee text, delivery to insured, `blockers`: holdback release condition (certificate of completion).
5. **Decision.** `PI-1`: expect $15,200; verification due date; "delivery risk" flag because the cheque goes to the insured. Staff task: contact policyholder about endorsement and forwarding (outside the squad's remit). `CW-1`: adjuster "has not yet inspected"; commitment: callback by 2026-10-12. `callback_expectation` created.
6. **Reconciliation.** Contractor's deposit shows $15,200 on 2026-10-09 in the next import: allocation `insurer_payment` $15,200 to `PI-1`, evidence `export_insurer_paid_amount`. The $3,200 holdback is a `holdback_release` receivable segment pending the completion document; not "written off," not "owed by insurer yet."
7. **Attribution.** The commitment came from a call after the invoice had passed the expected window and the payment followed within the attribution window: `attributed` for $15,200. The $3,200 holdback is not attributable until released.
8. **Staff judgment preserved.** Scope dispute on `SUP-1`, holdback negotiation, and anything about liens remain with staff. The squad never negotiates.

### 8.3 Collision and towing case with multiple invoices

Shared insurance claim `CL-77001`, two tenants: "Eastgate Collision" (repair and storage) and "Riverside Towing" (tow). Each tenant sees only its own receivables (RLS); there is no cross-tenant sharing of the case.

Eastgate's case: receivables `REP-1` repair $9,860, `SUP-1` supplement $1,240 (found after teardown), `STO-1` storage accruing at $45 per day from 2026-09-20 (accrual schedule), and a deductible receivable of $500 owed by the owner (`legal_debtor = vehicle owner`, not part of any insurer call).

1. **Task design.** One case-level task with several receivables in scope. Objective `status_check`. Cadence for storage: every 5 business days while accruing (starting value).
2. **Call.** Route: insurer claims unit via IVR, then adjuster. Variables: claim number, policy, VIN (allowlisted for this objective), loss date, invoices and amounts. IVR_Navigator reaches the claims unit, Hold_Sentinel waits 31 minutes (machine time), a rep answers and Claims_Agent (or staff in hold_assist) asks per invoice. Envelope per receivable:
   - `REP-1`: approved, payment batched.
   - `SUP-1`: pending adjuster review (task `W`: supplement documentation request, staff sends photos).
   - `STO-1`: storage authorized through 2026-10-05; beyond that requires re-authorization. `blocker`: authorization expiry. The grant forbids the squad from agreeing to extend or stop storage (that is `J`).
3. **Decision.** `STO-1` becomes a high-priority staff task with the accrued amount and the date the insurer's authorization ends. Without staff action, accrual after 2026-10-05 has no payer.
4. **Reconciliation.** Insurer pays one amount of $9,360 on 2026-10-14 (net of the $500 deductible) referencing the claim. Allocation: `REP-1` $9,360 (insurer), `REP-1` $500 expected from owner (not paid; stays with owner receivable). Storage and supplement remain open. Attribution: `REP-1` payment issued before the second call and within the program's normal window: `organic`. A recovery of the supplement approved after the call chain: `attributed` only if a commitment is on file.
5. **Why the old model fails here.** `mergeClaimRows` would have summed `REP-1`, `SUP-1`, `STO-1` into one balance. A payment of $9,360 would have shown as a partial payment of one claim, triggered the 7-day trace and the "balance reduced, confirm what was paid" action.

### 8.4 Equipment or pharmacy receivable

Tenant: "Clearsound Hearing" (`equipment_pharmacy`). Two tasks illustrate the split.

**A. Existing receivable.** Invoice `HA-902` for a hearing aid fitting $2,950, submitted to a group insurer, pended 40 days. Route: provider services IVR (platform route, reused carrier infrastructure). Objective `status_check`, mode `hold_assist` first. Rep says: claim pended for a missing audiogram; resubmit by fax. Envelope: blocker `document_requested`, commitment `resubmit_requested` with channel; knowledge write is tenant scope (the fax number is the program's published channel only after N tenants confirm). Gate `PRACTICE_DOCS`-equivalent opens for staff to attach the audiogram. Later import shows insurer payment of $2,360 (coverage cap); the $590 difference is a `customer_or_patient` balance reclassified through `legal_debtor`. No false attribution of the $590.

**B. Preauthorization (no receivable).** Patient is a candidate for a high-cost device. Task `preauth_request` with its own pack: ask whether preauthorization is required, what must be submitted, and the status of an already submitted request. Output: `preauthorizations` row with reference, approved amount, validity. No payment allocation, no recovery attribution, and the time-saved ledger records it as a distinct task type.

---

## 9. Migration plan (additive, dentistry preserved)

Principles: expand, then dual-write, then flip reads per tenant, then (much later, maybe never) contract. No renaming of `practiceId`. No change to the `CarrierId` enum. No deletion of dental tables. Each step has a flag and a rollback.

| Step | Change | Rollback |
|---|---|---|
| M1 | Create new tables (`payers`, `payer_programs`, `policy_packs`, `contact_routes`, `authorization_grants`, `import_sources`, `import_coverage`, `insurance_cases`, `receivables`, `receivable_lines`, `accrual_schedules`, `parties`, `case_party_roles`, `remittances`, `payment_allocations`, `recovery_attributions`, `recovery_tasks`, `call_facts`, `capability_grants`, `case_evidence`, `preauthorizations`, `callback_expectations`, `practice_verticals`). All with RLS templates and tests in the `tests/rls.strict.test.ts` style. | Drop unused tables; nothing reads them yet |
| M2 | Seed `payers` and `payer_programs` for six dental carriers with `legacy_carrier_id`; seed `contact_routes` (platform scope) from `CARRIER_PHONE_MAP` plus CDCP line; seed `policy_packs.dental_v1` from the constants in `adapter.ts` (30, 90, 3, Eastern window) and `claimRouter.ts` intervals. A parity test asserts the pack reproduces today's decisions on a fixture matrix. | Ignore seeds |
| M3 | Dental dual-write: importer writes `insurance_cases` + `receivables` in the same transaction as `InsuranceClaim` (the importer already runs inside one `$transaction`, `pmsImportPipeline.ts`). Backfill job (idempotent, resumable) creates them for history, `legacy_claim_id` set. | Flag off; dual-write stops; legacy unaffected |
| M4 | `call_attempts` gains `practice_id` (nullable, backfilled, then NOT NULL), `recovery_task_id`, `contact_route_id`, `objective`, `mode`, measured-seconds columns. RLS for `call_attempts` keeps its join policy until `practice_id` is verified, then switches to the direct policy. | Columns unused if flag off |
| M5 | Shadow `recovery_tasks` created 1:1 from `call_queue` for dental, `legacy_queue_id` linked. Dispatch service (WP-1) reads tasks but writes both. | Revert dispatch to legacy path by flag |
| M6 | Knowledge tables gain scope columns, default `platform` for legacy rows; new unique constraints coexist with the old one (`NOT VALID` first, then validate). | Columns nullable; old reads continue |
| M7 | `claim_id` on `call_attempts` and recovery tables relaxed to nullable only when the first non-dental task is enabled (WP-8). | Not reverted once non-dental rows exist; gate by vertical flag until then |
| M8 | Payment allocations backfill: for existing `claim_recovery_events` of types `PAYMENT_VERIFIED_SYNC`, `PARTIAL_PAYMENT_SYNC`, `MANUAL_PAYMENT_CONFIRMED`, create allocations with `evidence_kind = balance_delta_only` or the stronger evidence if the event metadata recorded it, and attribution `unclassified` (historic). Existing events untouched. | Allocations are additive |
| M9 | Flip reads (priority queue, dashboards) to the new ledger per tenant behind `FeatureFlag` (already a model). Dental keeps `InsuranceClaim` as source of truth until parity is proven, then the direction of the dual-write can reverse. | Flag |

What is **not** migrated in this plan: patient token structure for historic dental claims (kept), `PhiVaultEntry` contents (kept), existing events (immutable), and the `Practice` model (tenant boundary stays).

Risk notes from the code that affect the order: `CarrierId` is used in about 119 source files and `practiceId` in about 211, which is why neither is changed; the importer's strict carrier mapping rejects whole files, so the non-dental import path must be a separate pipeline that targets the ledger first (WP-3) rather than a loosened dental pipeline.

---

## 10. Implementation sequence and acceptance criteria

Dependencies shown as `needs`. Each package ends with rollback.

### WP-0: Manual trigger safety patch (small, immediate, no new architecture)

Scope: in `routes/insurance.ts` trigger route, apply `effectiveHumanAssisted` and pass `squadId`, set `isHumanAssisted` on the attempt, use the TELUS resolver and refuse the placeholder number, and apply plan `essentialOnly`. Reuse functions already used by the scheduler.
Acceptance:
- Unit test: practice on a plan without `autonomous_calls` triggers a call, assert `squadId` equals the human-assisted squad and attempt `isHumanAssisted = true`.
- TELUS claim with unresolved TPA: trigger returns a deferral or escalation, no `initiateCall`.
- Parity table in this document (3.5A) has no remaining "not applied" cells for mode, TELUS and attempt flag.
Rollback: revert the route change.

### WP-1: Single dispatch service, intents in production (needs WP-0)

Scope: `dispatch/dispatchService.ts` implementing `dispatch(taskOrClaim, trigger)`: lock, authorization, policy, block, concurrency, entitlement, mode, route, intent READY/SENDING/CONFIRMED, vapi call, attempt creation in a single transaction. Scheduler and manual route become thin callers. Wire `reconcileStaleDispatchIntents` to the worker schedule.
Acceptance:
- One code path creates `CallAttempt` rows (the webhook-born creation in `vapiDeskEvents.ts` is reduced to a reconcile-only fallback that logs a defect metric).
- Concurrency test with Postgres (the `dispatch-intent-postgres.integration.test.ts` style): 20 parallel triggers on one claim produce at most one vendor call (mock Vapi counting requests) and at most one `CONFIRMED` intent.
- Ambiguous timeout (mock timeout after send): intent `AMBIGUOUS`, queue `BLOCKED`, no automatic redial, staff-visible reason.
- Process kill between `SENDING` and confirm: stale reconciler marks ambiguous, never READY again.
- Scheduled and manual produce identical `capability`, `mode` and `squadId` for the same input (property test over combinations of tier and setting).
- Dental behavior parity: replay fixture claims through old and new path; same guard decisions.
Rollback: flag `DISPATCH_V2`, per practice; old paths retained one release.

### WP-2: Payment allocation and attribution ledger for dental (needs WP-1 not required; can run in parallel after M1)

Scope: `payment_allocations`, `recovery_attributions`, classifier, changes to `paymentVerification.ts` to write allocations and classify; relabel the dashboard "Dollars recovered" into two numbers.
Acceptance:
- Fixture: claim in `IN_QUEUE`, export shows insurer-paid amount, no call ever: class `organic`, **not** counted in attributed recovery.
- Fixture: call recorded `payment_issued` with reference, later payment: `attributed`.
- Fixture: balance drops to zero with only a write-off: allocation `write_off`, zero recovery.
- Fixture: payment issue date earlier than first touch: `organic`.
- Historic events keep their original `PAYMENT_VERIFIED_SYNC` rows and appear as `legacy_unclassified`.
Rollback: stop writing new tables; old report still computed.

### WP-3: Ledger and import identity (needs M1, M3)

Scope: `insurance_cases`, `receivables`, import sources and coverage, new non-dental import pipeline (CSV first), absence handling replaced by `suspected_settled`.
Acceptance:
- Import two sources into one tenant; a full-coverage run on source A does not affect receivables of source B.
- A collision case with four invoices under one claim number stays four receivables and reconciles a single payment across them.
- Mass-absence guard and per-source baseline hold a truncated export.
- Reimporting the same file is idempotent (no duplicate receivables, no re-minted vault tokens beyond what is needed).
Rollback: vertical flag off; dental untouched.

### WP-4: Registry: payers, programs, contact routes, authorization (needs M1, M2, WP-1)

Scope: the registry module, destination guard reading `contact_routes`, authorization grants replacing settings JSON for new tenants (dental continues reading settings with a bridge).
Acceptance:
- All six legacy numbers dial exactly as before (route parity test).
- A number not in scope for the tenant is refused with an auditable reason.
- Case-scope route cannot be read by another tenant (RLS test).
- Authorization scope that excludes an objective blocks that objective.
Rollback: guard falls back to the static allowlist behind a flag.

### WP-5: Objectives, typed outcomes, capability grants (needs WP-1, WP-4)

Scope: objective pack loader, `submit_call_outcome` tool, schema validation, decision engine, capability grant enforcement at tool endpoints; Claims_Scribe prompt and tools brought into the repository; `vapiSquadConfig.test.ts` extended to cover the human-assisted squad.
Acceptance:
- Pack schema tests; golden transcript tests per pack.
- A tool call outside the grant is rejected and logged.
- An outcome claiming settlement never changes task state.
- Regex-inferred outcomes never auto-close financial states.
- Variable allowlist lint fails the build when a non-allowlisted field is sent to Vapi.
Rollback: dental continues on the existing prompt and classifier until each pack is promoted.

### WP-6: Knowledge scoping (needs M6)

Acceptance: a case-scope submission destination is not returned for another tenant's call (integration test); promotion needs N confirmations and review; legacy channel behavior unchanged for dental.

### WP-7: Identity bundles and allowlists (needs WP-5)

Acceptance: bundle kinds for vehicle, property, WSIB; transcript scrubbing patterns tested; no persistence of plaintext in logs (existing logger scrub tests extended).

### WP-8: First non-dental vertical, human-assisted only (needs WP-1 to WP-7)

Order on engineering-reuse grounds, which is a build ordering, not a market judgment: (1) rehab with EHB payers (reuses existing carrier infrastructure); (2) rehab with MVA; (3) collision, tow and storage (forces multi-invoice and accrual); (4) restoration (forces the full party model); (5) equipment and hearing with preauthorization. The commercial order is your call.
Acceptance per vertical: a pack, a policy pack, a route set, a golden transcript suite, an end-to-end test of the matching example in section 8 against a mock Vapi, an RLS test for each new table, and the graduation criteria for leaving human-assisted mode defined and measured by `call_facts`.

### WP-9: Measurement ledger (needs WP-2, WP-5)

Acceptance: time ledger separates machine, staff, review, estimated; reports never present estimated as measured (labels tested); hold seconds are persisted (add the model columns, and obtain a reliable source for hold segments from Vapi events **[X: verify which Vapi events carry squad handoff timestamps]**).

### Cross-cutting protections

| Risk | Protection |
|---|---|
| Duplicate calls | Intent ledger in production, vendor idempotency key, row lock, one dispatch code path, stale reconciler, ambiguous state never auto-redials |
| False payment attribution | Allocation kinds, evidence kinds, attribution classes, separate verified receipts and attributed recovery, conservative `unclassified` |
| Cross-tenant leakage | RLS on every new table, scope fields on knowledge, route scope, test per table |
| Premature autonomy | Single mode function, plan entitlement, pack max mode, graduation criteria |
| Wrong closure from partial exports | Coverage-scoped absence, `suspected_settled`, per-source baseline |

---

## 11. Value measurement [P]

Replace `completedCalls x 18` with a ledger per task and attempt.

| Bucket | Definition | Source | Label in UI |
|---|---|---|---|
| Machine time | IVR seconds, hold seconds, bot talk seconds | Vapi call timeline; `call_attempts.*_seconds` | Measured |
| Staff participation | Seconds staff were on the line (`hold_assist`, takeover) | Handoff and takeover timestamps (`takenOverByStaffAt` exists) plus call end | Measured |
| Review work | Time between a review task opening and closing, or a fixed per-type allowance | Task timestamps | Measured if task timer exists, else Estimated |
| Manual-equivalent baseline | What a person would have spent: configured per objective and payer program, including expected hold | Policy pack | Estimated (always labeled) |
| Net staff time saved | `baseline - staff participation - review` | Derived | Estimated, displayed with the components |

Report hold time absorbed as its own measured number: it is the clearest honest claim, because it is observed, not assumed. Show unanswered or failed attempts as cost, not as savings. Keep the old 18-minute figure only for historic dental reports, labeled as a fixed estimate.

---

## 12. Pitch boundary

### 12.1 What the current code supports saying today

Accurate and defensible from the repository (not proof of production behavior):

- CollectRx navigates carrier phone menus, waits on hold, and either speaks with the rep (autonomous squad, commercially disabled today) or hands the live rep to practice staff while a scribe logs the outcome (Hold Sentinel mode).
- It imports receivables by CSV, ranks them, places calls inside a rules window with attempt caps, and reconciles balances from later imports.
- PHI is tokenized and AES-256-GCM encrypted, tenant rows are isolated by row level security, Vapi metadata carries tokens only.
- Payment is only credited when there is carrier confirmation or an insurer-paid amount on the export, and zero balance alone is not counted.
- Six Canadian dental carriers are configured, with TELUS requiring underlying plan identification.

### 12.2 What must not be said yet

| Do not claim | Reason |
|---|---|
| "Works across dental, rehab, auto repair, restoration..." | Data model, route registry, objective packs and import identity for those do not exist. |
| "Recovers $X for you" as a causal claim | Attribution is not implemented; today's number is verified receipts. |
| "No duplicate calls" as a guarantee | Intent ledger is unused in production; protection is vendor key plus queue state, and the manual route has a different guard set. |
| "Hold Sentinel only on all entry points" | Enforced at the scheduler, not the manual trigger. |
| Integrations with HCAI, WSIB, insurers' portals, pharmacy switches, accounting systems | None exist. Do not imply. |
| "Saves 18 minutes per call" | Fixed dental estimate, counts non-conversations. |

### 12.3 What the expansion requires building (mapped to work packages)

| Pitch claim | Requires |
|---|---|
| "We handle the follow-up calls for rehab clinics billing insurers" | WP-0, WP-1, WP-3, WP-4, WP-5, WP-8 (rehab) |
| "Multi-invoice claims for body shops and tow yards" | WP-3 (case, receivable, accrual), WP-2, WP-8 |
| "Property restoration with adjusters" | Full party model (5.5), case-scope routes, voicemail and callback handling (7.4), WP-8 |
| "Verified recovery, not just activity" | WP-2 plus WP-9 |
| "Safe by design across tenants and industries" | WP-4, WP-6, WP-7 |

---

## 13. Unresolved external dependencies

None of these block the architecture. Each needs resolution before the dependent feature is enabled.

| # | Dependency | Needed for | How to settle without interviews |
|---|---|---|---|
| 1 | Vapi: per-call prompt, tool and squad member overrides; event timestamps for squad handoffs; voicemail detection signal | Objective packs, hold seconds, voicemail policy | Staging test against Vapi, no insurer contact |
| 2 | Legal review of outbound automated calls to non-dental counterparties, disclosure wording, call recording and transcription, and which privacy regime applies per industry | Enabling each vertical | Counsel, using the existing CRTC and PHI compliance docs as the baseline |
| 3 | Current Ontario SABS payment timelines, interest, form rules, and current HCAI status and specification | Rehab MVA policy pack | Primary regulator pages; initial search showed 30 days and 1 percent monthly interest in FSRA material, HCAI still operating with an FSRA review and July 2026 form changes. Re-verify against the regulation before encoding. |
| 4 | WSIB current provider billing rules and payment timing | WSIB policy pack | Initial search found electronic billing via an external processor and a 6-month billing limit in an archived policy page; payment turnaround was **not** found. Use only WSIB primary pages. |
| 5 | Construction lien, repair and storage lien, and prompt-payment rules (Ontario, then other provinces) | Restoration and collision escalation rules | Counsel; squad never advises |
| 6 | Public contact routes for auto and property insurers and adjusting firms | Route registry seed | Collect from published provider pages; start empty and fill from human-assisted calls |
| 7 | Whether any provincial assistive-device, drug or federal program accepts provider phone follow-up | Equipment and pharmacy scope | Published program documents; defer vertical |
| 8 | Payments flow: whether tenants can export remittance advice | Reconciliation quality | Test with the customer's own exports at onboarding |
| 9 | Province-by-province variance for expansion across Canada | Policy packs and routes | `payer_programs.jurisdiction` and effective dating make this data, not code |

---

## 14. Founder-facing explanation

**The recommendation in one paragraph.** Keep building inside the application you already have. Do not add services. Teach it three new ideas: an insurance case can hold many invoices, each invoice has its own chain of who owes, who pays and who you call, and a "recovered dollar" has to be provable. Everything else (IVR navigation, hold waiting, the human-assisted handoff, tenant isolation, the PHI boundary) already works and carries over. The squad's five roles stay; what changes is that each call is assembled from a version-controlled objective pack, and the server, not the prompt, decides what the call may disclose and agree to.

**Where the squad wins in each new industry.** Waiting on hold and reaching the right department is the same labor everywhere. Status and payment-trace facts are straightforward conversations. Disputes, scope, price, coverage, storage extensions and anything legal are staff judgment, and the architecture treats them that way on purpose: the squad collects the facts and hands over a packet.

**The most important changes, in order of consequence:**

1. Make one dispatch service the only way to start a call, and use the durable intent ledger in production. Today the manual trigger and the scheduler apply different rules, the intent ledger is unused, and a manual trigger on a TELUS claim reaches a placeholder number.
2. Separate "insurance case", "invoice" and "payment" so one claim can carry a repair invoice, a supplement, a tow charge and a storage charge, and one cheque can pay many invoices.
3. Stop calling a balance drop a recovery. Record what was paid, by what evidence, and whether a CollectRx call preceded and caused it. Report verified receipts and attributed recovery as two numbers.
4. Move contact routes, authorizations and policy windows from constants and settings JSON into data, scoped to platform, tenant or case, so an adjuster's direct line never becomes shared knowledge.
5. Launch every new vertical in human-assisted mode. It is both safer and your best source of facts about each payer, because each call is logged by a person who actually heard it.

**First implementation work package.** WP-0 then WP-1. WP-0 is a small patch (days, not weeks) that makes the manual trigger obey the same mode, TELUS and attempt-flag rules as the scheduler. WP-1 consolidates dispatch behind one service with the intent ledger live. Together they fix a real inconsistency today, are invisible to dental customers, and are the foundation under every new vertical because they set the single place where authorization, mode, concurrency, idempotency and retry rules are enforced.

**Open questions for you (decisions, not research):**

- Which vertical goes first commercially. I ordered builds by reuse (rehab with extended health, then rehab MVA, collision and tow, restoration, equipment and hearing). Your pitch path may reverse that.
- How many independent tenants must confirm a destination before it becomes shared platform knowledge (my starting value is a small number such as 3, needs your risk view).
- Whether employer HR and disability administration stays out. I recommend it does, because there is no receivable to chase.

**What I did not do.** No code change, no deployment, no live call, no prospect contact. Facts about Ontario auto and WSIB came from a quick public search and are listed as external dependencies, not rules.

### Sources used for external statements

- FSRA, SABS payment of invoices and interest: [fsrao.ca/media/6796/download](https://fsrao.ca/media/6796/download)
- HCAI form overview: [hcaiinfo.ca form overview](https://www.hcaiinfo.ca/insurers/adjuster-support/form-overview)
- FSRA HCAI page and system review: [fsrao.ca health claims auto insurance HCAI](https://www.fsrao.ca/industry/auto-insurance/health-claims-auto-insurance-hcai)
- Form changes after July 1, 2026 (third-party summary, unverified): [practiceperfectemr.com HCAI update](https://practiceperfectemr.com/blog/hcai-update-july-1-2026/)
- WSIB billing instructions and archived health care fees policy: [wsib.ca health care fees (archived)](https://www.wsib.ca/en/operational-policy-manual/health-care-fees-archived-december-5-2024), [TELUS WSIB direct billing](https://telus.com/health/health-professionals/allied-healthcare-professionals/wsib)
