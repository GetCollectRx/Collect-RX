# Council report: Skeptical staff engineer / systems architect

Date: 2026-10-13. Lens: coupling, migration risk, Prisma and Postgres RLS reality, backward compatibility with the live dental product.
Scope: read-only. No code changed, no calls made. Paths are relative to `/home/user/Collect-RX/Collect-RX-main/` unless stated.

Evidence labels: CODE (file and line I read), REASONING (premise stated), OPINION. SOURCE is not used: I did no web research, and the two research files are search excerpts that I treat as unverified, as the brief says.

## 0. Bottom line

The direction (one engine, thin modules, fix defects first, human-assisted launches, measured graduation) is sound. The mechanisms the council brief proposes to hold it together are mostly aspirational as written. Three of them cannot be satisfied on day one by the current code: P5 (module may not change dispatch/vault/engine), P3 (two consumers required before anything is core), and P6 (cap of about eight). P4 (JSON attributes) is a reasonable tool for a narrow class of fields and a harmful default for the class the proposal most wants it for (identity and sensitive fields).

The deepest finding: there is no "shared call engine" in the code today that a module could plug into. There is a dental application whose dispatch, webhook, vault and outcome code is dental-shaped in about 49 source files. P1 is a refactor project that has to happen before modules mean anything, and the proposal prices it as an addition.

## 1. Facts I checked in code (used throughout)

| Fact | Evidence |
|---|---|
| `CarrierId` is a Postgres enum with 6 values. It is non-null on 15 models (InsuranceClaim, CarrierBlockEvent, InsurancePlan, EligibilitySnapshot, AppointmentVerification, ScheduledAppointment, AdjudicationEvent, CallEscalation, CarrierLesson, CarrierSubmissionChannel, CarrierDiscoveryRun, CarrierNavigationSnapshot, CarrierNavigationProposal, HumanAssistedCallLog, HumanAssistedCarrierProfile), nullable on WorkItem | CODE `prisma/schema.prisma:562-571` and the field lines (682, 1192, 1285, 1308, 1331, 1356, 1375, 1494, 1664, 2202, 2237, 2282, 2303, 2323, 2363, 2413) |
| The "119 files" figure is about right for a case-insensitive match: 120 `src/` files mention carrierId/CarrierId; a strict word match on the type name gives 54 in `src/` and 65 including tests and scripts | CODE, my grep |
| Only 8 places use an exhaustive `Record<CarrierId,...>`: `billing/tiers.ts`, `carriers/adapter.ts`, `services/arEngine/schemas.ts`, `services/priorityScoring.ts`, `vapi/client.ts` | CODE, grep |
| RLS has one tenant primitive: `app_rls_practice_allowed(row_practice_id)` = bypass flag OR `row == current_setting('app.practice_id')`. `call_attempts` is the exception: its policy joins through `insurance_claims` | CODE `prisma/migrations/20260712000000_rls_and_phi_vault_practice/migration.sql:32-58` |
| `feature_flags` already shows the "global row" pattern: global rows (practice_id NULL) are visible only under bypass | CODE same migration, after line 120 |
| The newest RLS migration records known unresolved RLS holes (Practice create under RLS; join-scoped PHI-adjacent tables left at app-layer scoping) | CODE `prisma/migrations/20260926200000_multi_practice_rls_coverage/migration.sql:1-40` |
| 98 Prisma models, 30 enums, 90 migration directories | CODE, grep |
| 15 models carry an FK to `InsuranceClaim`, mostly `onDelete: Cascade` | CODE schema lines 454, 811, 857, 879, 899, 918, 996, 1014, 1071, 1102, 1224, 2430 plus relations on the model itself (`schema.prisma:679-745`) |
| `InsuranceClaim` has no Json column. All its fields are typed | CODE `schema.prisma:679-745` |
| Writers to `insuranceClaim` (create/update/upsert/delete): 34 call sites in 15 files, plus at least 1 raw SQL reference | CODE, grep (`routes/insurance.ts` 7, `recovery/transitionClaimRecovery.ts` 5, `frontDesk/queueEngine.ts` 5, and 12 more files) |
| 57 `src/` files reference `InsuranceClaim`; 43 read `outstandingAmount` | CODE, grep |
| `validateDispatch` hardcodes 30 days, 90 days, 3 attempts, Mon to Fri 08:00 to 17:00 Eastern, takes `CarrierId` and `ClaimStatus`, and does a claim-keyed gate lookup | CODE `carriers/adapter.ts:~404-490` |
| `initiateCall` builds a fixed dental `variableValues` map (patient_name, patient_dob, treatment_codes, practice_npi, provider_number, etc.) | CODE `vapi/client.ts:412-450` |
| A second call builder hardcodes "a dental practice" into the spoken disclosure | CODE `vapi/client.ts:546-549` |
| `PatientPHI` is a closed interface (name, DOB, subscriberId, group, health card) | CODE `pii-vault.ts:71-83` |
| Vault is capped fleet-wide: `PHI_VAULT_MAX_TOKENS` default 100,000 and `tokenize()` throws at the cap | CODE `pii-vault.ts` near the TOKEN_TTL / MAX_VAULT_SIZE block |
| Webhook handler talks to `prisma.insuranceClaim`, `prisma.callAttempt`, `prisma.humanAssistedCallLog` directly | CODE `webhooks/vapi.ts` lines 72, 188, 394, 561 |
| `CallOutcome` is a closed Prisma enum of 8 values; the human-assisted resolver maps dental scenario strings (CLAIM_NOT_RECEIVED, MAX_BENEFITS_REACHED, ...) onto it | CODE `schema.prisma:650-661`, `outcome/humanAssistedOutcomeResolver.ts:39-64` |
| The squad config is a static handoff graph by assistant name. Claims_Agent prompt is 17,992 chars of JSON-encoded message, with the generic safety rules (refusal protocol, reference capture, difficult-rep ladder, deadline lock-in, character-by-character reading, endCall) interleaved with dental scenarios A to J | CODE `vapi-squad-config.json` (measured with a script; text around line 235) |
| The only import-boundary lint rule in the repo is "client must not import server" | CODE `eslint.config.js:80-110`. No dependency-cruiser, madge or boundaries plugin in `package.json` |
| `zod` 4 is already a dependency | CODE `package.json:132` |
| 49 `src/` files contain the word "dental" | CODE, grep |

## 2. Verdicts P1 to P13

### P1. One shared call engine with workflow modules around it
Verdict: SUPPORT WITH CHANGES.
Strongest objection: the engine does not exist as a separable unit. Dispatch (`queueEngine.ts`, 1083 lines, imports 25 modules including the TELUS resolver and CDCP-adjacent recovery code), the manual trigger (`routes/insurance.ts`), the webhook (`webhooks/vapi.ts`, direct prisma access to claim and attempt), and the outcome resolvers all assume `InsuranceClaim` + `CarrierId` + patient identity. "Modules around a core" presupposes the core has been extracted. The proposal's WP-0 and WP-1 are the extraction, and WP-1 alone touches the scheduler, the manual route, the intent ledger (no production caller today per proposal 3.4), the webhook-born attempt creation, and Vapi idempotency. That is the real cost of P1, and it is not a module-level cost.
Evidence: CODE rows above (queueEngine imports; webhook direct prisma; 49 dental files).
What would change my mind: a written inventory of which of the roughly 49 dental-tagged files are in the engine path and a bounded estimate to parameterize them. I did not find one.

### P2. About six small prompts, dental prompt frozen as dental_v1
Verdict: SUPPORT WITH CHANGES.
Strongest objection: "small prompt per objective" will not stay small. About half of the current 17.5k Claims_Agent prompt is not dental: the refusal protocol, reference capture gate, difficult-rep ladder, deadline lock-in, privacy pushback, speaking identifiers, end-of-call (CODE, the prompt text). Splitting into six prompts either copies that safety text six times (six chances for drift on the single most safety-critical rule, "refusal protocol, risk of CARRIER_BLOCK") or requires a composition layer (shared core fragment plus per-objective fragment) so each assembled prompt is about as long as today's. That is fine and probably right, but then the benefit is isolation of scenarios, not brevity. Also, the proposal's own squad design is a static handoff graph by assistant name (CODE `vapi-squad-config.json`, `assistantDestinations`), and per-call prompt override is unverified [X] (proposal 16.3). If it fails, each module needs its own squad definition, synced to Vapi, and the repo today cannot even hold the human-assisted squad (proposal 3.4).
Freezing dental as `dental_v1` is correct and cheap. Support that part without reservation.
What would change my mind: a staging test showing per-call prompt fragment override works across squad members, and a composition test that proves the core fragment is byte-identical in every assembled prompt.

### P3. Placement test (core only if dental AND another module need it)
Verdict: OPPOSE as written; SUPPORT a modified version.
Strongest objection: it is circular today. The only live consumer is dental. By the test, nothing is eligible for core until a second module exists, and the second module cannot launch until the engine is extracted. So every piece of the engine would sit "in the dental module" during exactly the period when the engine is being built. If dental is itself "module W1", the core is empty; if dental is "the core", the test never fires for dental-only needs such as persisted hold time, which every module needs. It is also unenforceable: nothing in the repo records which module owns a file, there is no boundary tooling (CODE `eslint.config.js:80`, `package.json`), and "needs" is a prediction about a module that is not written.
Modified version: a two-column rule. (a) Mechanics that are vertical-neutral by construction (idempotent dispatch, intent ledger, RLS, vault, webhook idempotency, hold/IVR timing, block protocol) are core now, justified by a written "no vertical vocabulary" criterion, not by consumer count. (b) Anything carrying domain vocabulary (outcome names, identifier sets, windows, prompt text) starts in a module and is promoted on the second real consumer. Enforce (b) with a CI check (see section 6).
What would change my mind: a stated owner map for the current tree (which directories are core, which are dental module).

### P4. Typed, validated attribute fields (JSON schema per module) instead of tables per vertical
Verdict: SUPPORT WITH CHANGES (narrow scope), OPPOSE as the default for identity and sensitive fields.

Does it work with this stack? Mechanically yes, with limits.
- Prisma supports `Json` (the schema already has about 45 Json fields, CODE grep) and zod 4 is present, so validate-on-write in the app is feasible. Postgres core has no per-row JSON schema CHECK; the `pg_jsonschema` extension is not something I can assume on the managed Postgres here (REASONING; unverified). So validation is application-layer only, and the application has 34 write sites into `InsuranceClaim` across 15 files plus raw SQL (CODE). Any writer that skips the module validator can persist an invalid blob. Typed columns are enforced by the database for all of those writers.
- Prisma cannot express expression or GIN indexes on JSON paths in `schema.prisma`; they live in hand-written migration SQL. My understanding is that this creates drift noise with `prisma migrate` (OPINION; verify before relying). Anything you filter on (loss date, VIN, case number) needs an index and will be queried in dashboards, so those fields should be real columns.
- RLS is unaffected: the row is protected regardless of its JSON content (CODE, policy is by `practice_id`).

Why it is the wrong default for the proposal's use case: the proposal itself says VIN, plate, property address, WSIB number, employer are sensitive by default and should get vault-grade handling (proposal 5.10). JSON attributes on `Receivable` or `InsuranceCase` are the easiest place to leak them: the PHI log scrubber, retention job, export code and the CSV mapper all key off known column names (REASONING; I checked that `InsuranceClaim` is fully typed and that the vault stores a closed `PatientPHI` interface). A bag of attributes hides identifiers from every column-driven control. Either the JSON holds only tokens (then it is a pointer, and the vault shape `PatientPHI` still has to change), or it holds plaintext sensitive data (a compliance regression).

Also, P4 does not touch the problem the brief ties it to. The 119-file `CarrierId` coupling is the payer axis, not the attribute axis. JSON attributes leave 15 non-null `CarrierId` columns (including `HumanAssistedCallLog`, `CarrierBlockEvent`, `CarrierLesson`) untouched; a non-enum payer cannot be written to those tables without nullable `carrierId` plus a `payerProgramId`, or an enum extension. The proposal's `legacy_carrier_id` mapping solves lookup, not writes into those 15 tables.

Concrete alternative in section 7.

### P5. Module contract (objective pack, import mapper, policy data, outcome rules, stop triggers, tests; may not change dispatch, vault, engine)
Verdict: SUPPORT the list; OPPOSE the prohibition as a day-one rule.
Strongest objection: three of the six required deliverables cannot be supplied without changing the things the module is forbidden to change.
- Policy values as data: the 30, 90, 3-attempt and Eastern-hours rules are constants inside `validateDispatch` (CODE `carriers/adapter.ts:~455-490`). Making them module data is itself a change to dispatch.
- Identity/allowlist: `initiateCall` sends a fixed dental `variableValues` map (CODE `vapi/client.ts:412-450`) and the vault is a closed `PatientPHI` type (CODE `pii-vault.ts:71`). A module needing loss date, VIN or policy-only identity needs vault and call-builder changes.
- Outcome-to-action rules: the shared `CallOutcome` enum has 8 values and the resolver is a dental scenario table (CODE). A module-specific outcome set must map onto the shared enum and `ClaimStatus`, or extend them, and recovery routing has a CDCP branch (proposal 3.3).
- Stop triggers: carrier-block phrases are a global regex list (CODE `outcome/processor.ts`, `frontDesk/carrierBlockPhrases.ts`); legal-edge triggers are proposed as pack data but enforced where? The tool endpoints, not the prompt, must enforce them, and those live in `webhooks/vapi.ts`.
- Webhook: `webhooks/vapi.ts` reads and writes claims and attempts directly (CODE lines 72, 188, 394, 561), so there is no module seam for "outcome ingestion" yet.
So the first non-dental module will change the core. The prohibition is only credible after a core refactor, and then it needs a change process for the core (an owner and a review gate), not a flat ban.
"Passing test suite" gating releases is good but see P12 on what the golden transcripts can be.
What would change my mind: a thin vertical slice (one dental objective re-expressed as a pack through the new interfaces with byte-identical behavior), demonstrating the seams exist.

### P6. Cap of about eight shared core entities
Verdict: OPPOSE the number, SUPPORT a mechanical cap on a defined set.
Count from the proposal (REASONING from the document): section 9 M1 lists 23 new tables (payers, payer_programs, policy_packs, contact_routes, authorization_grants, import_sources, import_coverage, insurance_cases, receivables, receivable_lines, accrual_schedules, parties, case_party_roles, remittances, payment_allocations, recovery_attributions, recovery_tasks, call_facts, capability_grants, case_evidence, preauthorizations, callback_expectations, practice_verticals). Section 15.2 adds `phone_number_pool` (24). Section 5.11 adds scope columns to three knowledge tables. Under P8's cuts (parties, case_party_roles, accrual_schedules, preauthorizations, remittances, number pool) about 18 new tables remain. Existing tables the dispatch path already touches and that any module depends on: Practice, InsuranceClaim, CallQueue, CallAttempt, CallDispatchIntent, PhiVaultEntry, CarrierBlockEvent, ClaimRecoveryAction, ClaimRecoveryEvent, HumanAssistedCallLog, WorkItem, CarrierLesson, CarrierSubmissionChannel, HumanAssistedCarrierProfile, UsagePeriod, AuditLog, the webhook idempotency ledger: about 17. Honest shared-entity count after P8 is roughly 30 to 35, against a cap of 8.
What "real core" looks like if you draw the line by "carries vertical-variant shape": Practice (tenant), Case/Claim, Receivable, Recovery task or queue row, Call attempt, Call fact (typed outcome), Payer (+ program), Policy/Route. That is 8, but it leaves out vault, intents, blocks, events, audit and usage, which are the pieces most likely to break tenant isolation. So a cap of 8 is either wrong or defines "entity" so narrowly it excludes the dangerous ones.
Enforceability: mechanically possible (tag core models with a doc comment such as `/// @core` and add a vitest that parses `schema.prisma` and fails on count change without a matching entry in a registry file). Without that it is a sentence. Also "exceed with a written reason" is a soft gate that, in a one-founder repo, is satisfied by writing the reason.
What would change my mind: a definition of "core entity" and the tagged list.

### P7. Retirement rule
Verdict: SUPPORT WITH CHANGES.
Strongest objection: removing a module is not deleting code. Rows, call transcripts, tokens in the vault, audit logs and PHIPA retention obligations outlive the module (REASONING; `dataRetentionJob` and `phipa_deletion_requests` exist per the RLS migration list). A retired module needs a data-disposition plan, not just a deploy removal. Second, "too few calls after a set time" is near-meaningless in human-assisted mode with a handful of tenants; low volume is the expected state, not a failure signal, and calls per module is a poor proxy for demand (staff may be using the scribe log for something else). Third, it can conflict with the founder's constraint of "custom where needed": a tiny but high-value vertical looks identical to a dead one.
Alternative: retire on cost, not volume. Define per-module carrying cost (open pack versions, golden suite maintenance, legal review currency) and a sunset review at 6 months with a default of "freeze, no new tenants" rather than delete.

### P8. Cuts
Verdict: SUPPORT, with one reservation.
Cutting accrual schedules, preauthorization and remittance tables, number pool, per-payer budgets and QA scoring is consistent with the evidence file (those are Tier C) and with schema risk. Reservation: cutting party roles ("use fields") is safe only if the fields land on `Receivable` as typed columns (`legal_debtor_kind`, `payment_recipient_text`), not in the JSON bag (see P4). Restoration and MVA payee rules (direction to pay) drive money states; hiding them in an untyped blob invites the inconsistency the founder fears.

### P9. W1 first, and "if it forces core changes the core is shaped wrong"
Verdict: SUPPORT W1 first, OPPOSE the test as stated.
W1 is the right first module: it can reuse `InsuranceClaim` unchanged (rehab/hearing extended-health claims are claim-shaped), the six carriers, and the existing squad. But W1 will force core changes, and I can name them from code: the disclosure text hardcodes "dental practice" (CODE `vapi/client.ts:547`, plus a missed-handoff fallback string per proposal 16.2); Claims_Agent prompt is dental (CODE); provider identity is a `Dentist` with a 9-digit CDA number checked on import (proposal 3.3); `treatmentCodes` are CDT (CODE schema comment); carrier authorization (BAAL) is per carrier in practice settings (proposal 3.3), and whether a physio clinic needs its own authorization letter with each carrier is open [X]. If any core change falsifies the shape of the core, the core is already falsified. The test as phrased will fail on first use, so it will either be ignored or used to justify a rewrite.
Better test: W1 may change the core only by parameterizing, never by forking. Count the changes, require each to be a removal of a dental constant or word, and require dental parity tests (golden replay of existing claims) to stay green.

### P10. Build order (defects first, then buyer gates, then narrow human-assisted tests, then expand on evidence)
Verdict: SUPPORT. I could not break it.
It is the right order, and it matches the code: WP-0 is a small patch to a route that already diverges from the scheduler (CODE `routes/insurance.ts` vs `queueEngine.ts`; proposal 3.5A). One addition: put a characterization test layer under the dispatch path before WP-1 (record current guard decisions on a fixture matrix, as the proposal's M2 parity test suggests), because WP-1 is the highest-risk change to the live product and `tests/dispatch-intent-*` currently test helpers that nothing calls.

### P11. Human-assisted launch and graduation on measured criteria
Verdict: SUPPORT, with a precondition.
The precondition is already in the proposal (16.2): whether Claims_Scribe still hears audio after the staff transfer is unverified and central. If the scribe loses the line, "call logs are the demand evidence" yields empty or staff-typed logs, and graduation criteria computed from them are meaningless. Verify before building anything that depends on the log.

### P12. Hallucination controls
Verdict: SUPPORT WITH CHANGES.
Good: server supplies numbers (the existing `verify_payment_amount` already reads from DB, CODE), closed enums with "unclear", reference read-back (already in the prompt), human confirms money.
Two concrete problems.
1. "Post-call check that each extracted fact appears in the transcript" needs the transcript. The system scrubs transcripts for PHI and deletes after the call (proposal 3.2), and recording is disabled. Substring-matching a spoken amount ("one thousand six hundred forty") against a transcript is an NLP problem (number words, spelled references), not a string check. It will produce false negatives that train staff to ignore the flag. Scope it to reference numbers and dates first.
2. Golden transcripts per pack: for any non-dental pack there are no real transcripts. Synthetic transcripts written by the same author as the prompt test the prompt against the author's expectations, not against reality. Treat them as regression tests only, label them so, and do not let them gate "ready for autonomy". Autonomy gates must come from logged human-assisted calls.
Also: "each call records pack version, model and settings" is cheap and valuable; do it now for dental (a `pack_version` column plus the Vapi assistant/squad id). The existing live squad can drift from the repo copy (proposal 3.4, 16.5), so record what Vapi reports, not what the repo says.

### P13. Scoped knowledge, health-custodian tenants tenant-only
Verdict: SUPPORT. Urgent for the existing dental product.
CODE: `CarrierSubmissionChannel` unique on `[carrierId, channelType]` is one global slot (proposal 3.5E, schema ~2248) and is written by whichever tenant's validated call last stated a destination. This is a live cross-tenant leak path in the shipped product, independent of expansion. RLS cannot express the proposed read rule with the existing helper (see missed issue 2). Do the scope columns and a tenant-default write before any new vertical.

## 3. What the author missed (ranked by severity)

1. `call_attempts` visibility is defined through `insurance_claims`, and 15 other tables FK to `InsuranceClaim` with cascade. The proposal relaxes `call_attempts.claim_id` to nullable (M7) and adds `practice_id` (M4), but the RLS policy `app_rls_call_attempt_allowed(claim_id)` returns false for a null claim, so non-dental attempts would be invisible to their own tenant until the policy is switched (CODE `20260712000000_...migration.sql:45-58`). The same problem exists for every child table that hangs off `claim_id` (recovery actions/events, evidence items, escalations, notifications, submissions, dispatch intents). The proposal handles only `call_attempts`. Severity: high. This is a FORCE RLS change on a live, tenant-isolation-critical table.
2. The RLS "template" does not cover the proposal's shared rows. It says new tables copy the `app_rls_practice_allowed` template (proposal 1.2, section 5). That helper is equality on a single tenant id. `payers`, platform `contact_routes`, platform and payer-program knowledge, and `policy_packs` need "readable by all tenants, writable only with bypass", and case-scoped rows need two-key logic. The only precedent is `feature_flags` (global rows visible only under bypass). Writing these policies wrong either hides the data (broken dispatch) or exposes tenant rows. The bypass flag is process-wide and used by many jobs (CODE `runWithRlsBypass`), so the blast radius of a bad read path is the whole fleet. Severity: high.
3. Dual-write has 34 write sites in 15 files, not one. The proposal's M3 puts the shadow-write in the importer (`pmsImportPipeline.ts`, already a `$transaction`). Status, balance, recovery route and soft-delete are mutated from `transitionClaimRecovery.ts` (5), `queueEngine.ts` (5), `routes/insurance.ts` (7), `escalationService.ts`, `recoveryLoopService.ts`, `absentClaimHandler.ts`, `paymentVerification.ts`, `partialPaymentHandler.ts`, `eobImport.ts`, `dataRetentionJob.ts`, `carrierBlockService.ts`, `manualDispatchCompensation.ts`, `dispatchIntent.ts`, `vapiWebhook.ts` (CODE grep). A shadow `Receivable` written only at import diverges the first time any of these runs. See section 4.
4. The engine is not generic: 49 source files say "dental", the spoken disclosure is hardcoded dental in at least one builder (CODE `vapi/client.ts:547`), and the second `initiateCall` variant also has its own variable set. "Shared engine" is a refactor, and no estimate exists. Severity: high for planning accuracy.
5. Vault scale and shape. `PatientPHI` is a closed interface, and `tokenize()` throws at a fleet-wide cap of 100,000 tokens by default (CODE). New bundle kinds (vehicle, property, WSIB) multiply entries per case, and per-call ephemeral variables for each. The cap and the in-memory structures were sized for a few dental practices. Severity: medium-high; becomes an outage, not a degradation.
6. Copy drift is a demonstrated failure mode of this repo. The root `CLAUDE.md` says the shipped and root agent prompt trees hold the same 29 prompts and drift with no sync check. Six packs plus a frozen dental_v1 plus a human-assisted squad that lives only in the Vapi dashboard is the same pattern at higher stakes. The sync-to-Vapi tooling and a nightly "live equals repo" check are not in the plan as a deliverable of its own. Severity: medium-high.
7. `CallOutcome` and `ClaimStatus` are closed Prisma enums used by many files; module outcome sets need an explicit mapping layer or they will pressure enum extension (a Postgres enum change is a migration plus a deploy-ordering constraint). Severity: medium.
8. Block protocol keyed by carrier: `CarrierBlockEvent.carrierId` is non-null. Scope-aware blocks (proposal 15.2) require a table change that is not additive for existing readers (`checkCarrierBlock` signature takes `CarrierId`, CODE `carriers/adapter.ts`). Severity: medium.
9. Authorizations. Dispatch gates on a per-carrier BAAL/provider-number check stored in practice settings JSON (proposal 3.3). A non-dental tenant needs its own equivalent legal instrument per payer; whether the existing dental authorization satisfies a rehab clinic's use is a legal question, and the data model (`authorization_grants`) is listed but the dispatch gate migration off settings JSON is not scheduled before W1. Severity: medium.
10. Retention. A new module creates new data classes with retention and deletion duties; the retention job and PHIPA deletion code are claim-shaped. P7's retirement rule inherits this. Severity: medium.
11. Team size reality (OPINION). The proposal's 9 migration steps, 9 work packages, 23 tables and a load-test suite are sized for a small team; one founder plus agents will not hold a 24-table parity period with two sources of truth. Severity: medium, and the main reason I recommend the narrower path below.

## 4. What a dual-write migration would really cost

Per the proposal (section 9), M3 to M9. My reading of the work:

- Fixed cost: new schema and RLS for about 18 to 24 tables; RLS tests in the style of `tests/rls.strict.test.ts` for each (the repo's own RLS migration notes show this is where past mistakes happened); backfill job for history (idempotent, resumable) including the vault token behavior: the importer mints a new token on every re-import (proposal 3.1 step 2), so a backfill must not re-tokenize.
- Variable cost, the one that bites: every one of the 34 InsuranceClaim write sites in 15 files must either write the shadow too, or be wrapped by a single service the shadow listens to. Most are outside any shared transaction. So either (a) refactor all writers behind one `ClaimLedger` function first (a large change to the live product), or (b) add DB triggers/outbox to propagate (new infrastructure, harder to test under RLS), or (c) accept eventual consistency with a reconcile job (a drift detector that must itself be correct).
- Read flip (M9): 57 files reference `InsuranceClaim` and 43 read `outstandingAmount`. Per-tenant flipping behind `FeatureFlag` means both read paths stay alive and tested for the entire period.
- Verification: the parity harness (same guard decisions, same balances, same recovery events) is most of the effort and is the only thing that protects dental customers. I would budget it as at least half of the project.
- Rollback: is clean only until M7 (nullable `claim_id`) is exercised by a non-dental row; after that the proposal itself says it is not reverted.
OPINION on size: multi-week for one engineer to reach "dual-write on, parity green for dental", longer to flip reads, and it delivers no customer-visible value to dental. That is a heavy price when the first non-dental module (W1) does not need the new ledger at all.

## 5. Over-engineered and under-engineered

Over-engineered for the evidence (EVIDENCE-BACKED-FEATURES.md puts these in Tier C or unevidenced): the full case/receivable/allocation/attribution ledger for modules with no proven demand; `accrual_schedules`, `preauthorizations`, `callback_expectations`, `phone_number_pool`, `recovery_attributions` classes (the attribution fix for dental can be one column and one report change), `capability_grants` snapshot table (a pack version plus mode column on the attempt carries most of the audit value), effective-dated `policy_packs` as a table before there are two policies that differ.
Under-engineered: the characterization/parity test layer for WP-1 and the migration; a live-equals-repo check for Vapi assets; the definition and enforcement of "core"; the RLS design for shared rows; the ownership/authorization model for non-dental payers; vault capacity; and a runbook for rollback of the RLS change on `call_attempts`.

## 6. Making P3 and P6 enforceable (if the council keeps them)

REASONING: a rule the repo cannot check is a preference. Cheap checks that fit this repo:
- A `core-manifest` file listing core directories and core Prisma models; a vitest that parses `schema.prisma` and fails if the tagged model count or names change without editing the manifest in the same PR (P6).
- An ESLint `no-restricted-imports` or dependency-cruiser rule: `modules/<name>/**` may import only from `core/**` public index and not from each other; `core/**` may not import from `modules/**`. The existing repo already uses `no-restricted-imports` for the client/server split (`eslint.config.js:80`), so the mechanism is known.
- A vocabulary lint on core: fail if core files contain a list of vertical terms (dental, patient as a literal, CDT, EOB) outside the allowlist. This is the real implementation of P3's "no vertical vocabulary" test and it is checkable today (49 files will light up; that is the work list).

## 7. Alternatives

### 7a. Replacement for P4 (weakest of the data-model propositions)
Three tiers by what the field is, not by module:
1. Fields that are queried, joined, sensitive, or drive a money state or a dispatch decision: real typed columns on a 1:1 extension table per module (`claim_ext_w2`, with `claim_id` PK/FK, `practice_id`, RLS template identical to the parent). This keeps DB enforcement, Prisma types, indexes, scrubbing by column, and cascade deletes. A new module adds one table, not a vertical's worth of tables; the "no new tables per vertical" goal is traded for "one extension table per module", which is still an order of magnitude less than 23.
2. Sensitive identifiers (VIN, address, WSIB number): in the vault as a new `bundle_kind`, referenced by token. Not in JSON.
3. Display-only, non-sensitive, never filtered (free-text notes, source-system extras): `attributes jsonb` on the shared row, validated with the module's zod schema at the module write path, with an unknown-key pass-through count metric so drift is visible.
Add one CI test that fails if a field name matching a sensitive-name list appears in any module's JSON schema.

### 7b. Replacement for P5's prohibition
A two-phase contract. Phase 0 (before the first module): extract the seams (policy values, identity allowlist and call-variable builder, outcome mapping, stop triggers) behind interfaces, with dental implemented through them and a parity suite green. Phase 1 (after the freeze): core changes go through a short change record (what, why, which modules affected) and a CODEOWNERS review, and the changes must be parameterizations. The ban applies to modules; the core owner can change the core.

### 7c. A cheaper migration path
Strangler by vertical, not dual-write:
1. Do P10's defect fixes (WP-0, WP-1, attribution honesty on the existing tables, scope columns on the three knowledge tables, hold time persisted).
2. Launch W1 on the existing `InsuranceClaim` unchanged except for parameterizing the dental constants and words (this is also the P9 test, correctly stated).
3. Only when W2 (MVA invoice trace) is a real module, build the new `Case/Receivable/Allocation` tables for new-vertical tenants only, with dental untouched. No shadow of dental, no read flip. Converge dental later only if there is a reason, probably never.
This gives the founder custom workflow where needed (W2 gets a real ledger), shared plumbing where applicable (dispatch, vault, webhook), and no parity period for the live product.

## 8. What I could not break

P10 (build order), the freeze of the dental prompt as `dental_v1` (P2), the principle that every new module starts human-assisted (P11), P13's default of tenant-only knowledge for health custodians, and P8's cuts. I looked for a reason each would fail in this codebase and found none beyond the caveats above.

## 9. Open items I could not check

Whether the managed Postgres supports a JSON schema constraint extension (unverified); how `prisma migrate` treats hand-written expression indexes (unverified, noted as OPINION); Vapi per-call prompt override and squad limits (proposal marks as [X]); whether the live autonomous squad matches the repo copy (proposal 16.5); any production data volumes, which would change the migration cost estimate.
