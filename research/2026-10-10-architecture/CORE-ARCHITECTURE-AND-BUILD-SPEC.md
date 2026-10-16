# Core architecture and required technical builds

Date: 2026-10-16. Prepared for Khalid. Status: design and sequencing only. No application code was changed by this document.

This consolidates ARCHITECTURE-PROPOSAL.md sections 4, 5, 9, 10, 15 to 19 and the policy research into one definition of what is in the shared core, what each module owns, and which builds are required in what order. Where it conflicts with those sections, this document wins; the proposal keeps the reasoning and the evidence.

Tags: [F] observed in the repository on 2026-10-16 (checkout of branch claude/gallant-gates-3skltb, which predates the in-flight privacy PRs), [P] proposed, [X] external or unverified.

---

## 1. The principle

One engine, many modules. The engine is what turns a receivable owed by a payer into a safe, evidenced, billed phone call and reconciles the result. A module is a bundle of data and rules around that engine for one kind of work. A module never contains call machinery and never bypasses the compliance gate.

A component belongs in the core only if two or more modules need it, or a statute requires it for every module. Everything else is owned by a module and built when that module's gates are green.

State of the codebase that drives this [F]:

- The case, the invoice and the dispatchable work item are one record, `InsuranceClaim`, unique on practice and claim number (prisma/schema.prisma). That breaks for multi-invoice cases.
- `CallDispatchIntent` helpers exist in `src/server/frontDesk/dispatchIntent.ts` and nothing else in `src` imports them. Duplicate-call protection today is the vendor idempotency key plus queue state.
- The scheduler and the manual trigger run different safeguards.
- No `authorization_grants` or `regime_determination` exists anywhere in the schema or source.
- The fleet slot budget is two environment variables read in `queueEngine.ts` (limit 10, reserve 2). The carrier concurrency limit of 5 lives in `src/billing/tiers.ts`.
- The squad config contains five roles (IVR_Navigator, Hold_Sentinel, Claims_Agent, Escalation_Closer, Resolution_Closer). Claims_Scribe exists only in the live Vapi account.
- Privacy and legal-policy work is in flight on separate branches (privacy-controls-w1 to w4, legal-policy-l1 to l5). I have not reviewed their contents.

---

## 2. Layered architecture

```text
 L6  MODULES        W1 claims-line status | W2 MVA invoice trace | W3 government programs
                    W4 property restoration | W5 collision tow storage | W6 preauthorization
                    (manifest, policy pack, objective packs, ledger extension, import adapters)
 ----------------------------------------------------------------------------------------------
 L5  MEASUREMENT    payment allocation | attribution classes | time ledger | evidence ledger
     AND BILLING    entitlement ledger | capacity and route semaphores | COGS breaker with overage
 L4  KNOWLEDGE      scoped carrier knowledge (platform, tenant, case) | promotion rules | learning flags
 L3  EXECUTION      dispatch service | call profiles | role library | objective pack runtime
                    typed outcomes | capability grants | webhook ingestion | decision engine
 L2  WORK           recovery tasks | scheduler (deadline aware, fair) | import pipelines
 L1  LEDGER AND     cases | receivables | parties | payers | programs | contact routes
     REGISTRY
 L0  GOVERNANCE     regime determination | data classes | authorization grants | policy packs with
                    evidence status | profile gate | audit trail | breach register | retention
 L-1 PLATFORM       tenancy (practiceId + FORCE RLS) | PII vault | identity bundles | feature flags
                    sub-processor register | policy lint | traceability checks
```

Rules between layers: a layer may call down, never up. Modules (L6) call the engine through the dispatch service only. Governance (L0) is consulted by dispatch before every call and by modules at activation.

---

## 3. Core inclusions

| ID | Component | What it is | Why it is core | Today [F] | Build |
|---|---|---|---|---|---|
| C1 | Tenancy and isolation | `practiceId` on every row, FORCE RLS using `app_rls_practice_allowed`, an RLS test per new table | Every module; statute (privacy) | Exists, 211 files use `practiceId` | extended by every build |
| C2 | PII vault and identity bundles | AES-256-GCM vault, UUID tokens in metadata, identifiers as ephemeral call variables; generalized to bundle kinds (person, vehicle, property, claim reference) with a per-objective variable allowlist | Every module; PHI boundary | Vault exists and is patient-shaped | B8 |
| C3 | Governance layer | `regime_determination` per tenant, `data_class` per field, `authorization_grants` (kinds: patient_consent_attestation, agent_permission, loa, direction_to_pay, licence_status, assignment), profile resolver, policy pack engine with evidence status | Every module; statute | Absent | B3 |
| C4 | Ledger kernel | `insurance_cases`, `receivables`, `receivable_lines`, `payment_allocations` (many-to-many between payments and receivables), `import_sources`, `import_coverage`, and three minimal party roles on every case: legal debtor (payer), payment recipient, contact. Every insurance-facing module needs these, so the kernel is built first and dental is dual-written into it. Module-specific extensions (`parties` with extended roles such as claimant, mortgagee, tow operator; `remittances`; `accrual_schedules`; `preauthorizations`; `callback_expectations`) stay in Wave B | Every module: a case, what is owed on it, what was paid against it, and who the debtor, recipient and contact are | Case, invoice and work item merged in `InsuranceClaim` | B4a (kernel), B4b (extensions) |
| C5 | Registry | `payers`, `payer_programs`, `contact_routes` (scope, hours, recipient time zone, validated concurrency, call-start pacing, block signals, evidence) | Every module; statute (hours) and capacity | Static `CARRIER_PHONE_MAP`, flat carrier cap 5 | B5 |
| C6 | Work engine | `recovery_tasks` shadowing `call_queue`; deadline-aware fair scheduler; per-client entitlement ledger | Every module; capacity promise | Scheduler: single global lease, one call per practice per tick | B2, B10 |
| C7 | Dispatch service | The only code path that starts a call: lock, authorization, profile gate, policy, CARRIER_BLOCK, route semaphore, entitlement, mode, route, intent, vendor call, attempt row | Every module | Two divergent paths; intents unused | B2 |
| C8 | Role library and call profiles | The five roles plus Claims_Scribe in the repository; call profiles compose roles per counterpart type (IVR claims line, adjuster direct line, portal-assisted) | Every module | Dental-shaped Claims_Agent prompt (about 17,500 characters) | B6 |
| C9 | Objective pack runtime | Versioned bundle of prompt, tools and typed outcome schema per call goal; capability grants enforced at tool endpoints; decision engine; scope lint and transcript lint | Every module; licensing exposure | One dental prompt; outcomes inferred by regex | B6 |
| C10 | Ingestion and facts | One attempt-creation path; webhook ingestion; `call_facts`; reconcile job; outcome processor that never auto-closes financial states from inferred text | Every module | Attempt rows created in two places; regex reference-number bug | B2, B6 |
| C11 | Knowledge scoping | Scope (platform, tenant, case) on carrier knowledge; promotion needs N confirmations and review; tenant learning flags default off | Two or more modules; statute (agent purpose limit) | Global per carrier; overwritten by last caller | B7 |
| C12 | Evidence and audit | `case_evidence`, `PhiAccessEvent` coverage test, breach register with prescribed fields, retention job with dry run and legal hold | Every module; statute | Partial; breach model has no route | B1, B13 |
| C13 | Measurement | `payment_allocations` with evidence kinds, `recovery_attributions` (organic, attributed, unclassified), time ledger (machine, staff, review, estimated) | Every module; honest recovery claims | "Dollars recovered" counts organic payments | B9 |
| C14 | Capacity and billing integrity | Capacity configuration verified against the vendor limit, route semaphore, per-client concurrency ceiling, COGS breaker counting authorized overage, daily-minute reservation for Scale | Every module; commercial promise | Constants; breaker ignores overage | B10 |
| C15 | Module runtime | Manifest, validation, lifecycle states, per-tenant activation, CI manifest test, synthetic-data and mock-Vapi harness | Every module | None | B12 |
| C16 | Platform controls | Feature flags (existing `FeatureFlag`), policy lint, traceability check, vendor allowlist CI, subject access export, notice constants | Every module; statute | Partial | B1, B11, B13 |

---

## 4. Module contract

A module is registered by a manifest. The CI manifest test fails the build if any field is missing or points at something that does not exist.

```text
module
  id, version, status: draft | pilot | active | suspended | readonly | archived
  requires
    profiles[]            health | commercial (combinable)
    grants[]              grant kinds a tenant must hold before any call
    payerKinds[]          corporation | government | other (individual is blocked at the gate)
    policyPack            id, and minimum status VERIFIED_AND_SIGNED for every blocking parameter
  entities                case kinds, receivable kinds, party roles
  objectives[]            objective pack ids (prompt, tools, outcome schema, max mode)
  gates[]                 extra preflight predicates (pure functions, no side effects)
  handoffs[]              forced human handoff triggers and phrase lists
  reconciliation          rule id
  importAdapters[]        CSV first
  graduation              measured criteria to leave human-assisted mode
```

Two-phase activation:

1. Validate (build time): manifest complete; policy pack present; every blocking parameter has an evidence tag; golden transcripts and an end-to-end mock-Vapi test exist; an RLS test exists for every table the module adds.
2. Activate (per tenant): regime determination recorded; required grants present and unexpired; vendor route decision recorded for the module's data class; feature flag on.

Lifecycle: `suspended` stops new dispatch and keeps data; `readonly` blocks writes; `archived` exports and purges per retention. A module may be suspended by a statute-driven change (for example a policy pack parameter drops from VERIFIED).

What a module may not do:

- call a vendor directly or create a call attempt outside the dispatch service;
- weaken or skip a preflight check;
- store sensitive fields in JSON columns (typed one-to-one extension tables instead, so RLS, retention and access logging apply);
- read another module's tables.

---

## 5. The compliance gate (in the dispatch service)

Preflight order: lock, authorization, **profile gate**, policy, CARRIER_BLOCK, route semaphore, entitlement, mode, route, intent, call. Reasons are stored and shown to staff with a next action.

| Code | Condition |
|---|---|
| ATTESTATION_MISSING | Health profile tenant has no valid consent attestation |
| AGENT_PERMISSION_MISSING | No purpose-scoped agent permission |
| GRANT_MISSING_OR_EXPIRED | Module requires a grant that is absent, expired or revoked |
| DEBTOR_KIND_UNKNOWN_OR_INDIVIDUAL | Payer is not a corporation |
| POLICY_PACK_UNVERIFIED | A blocking pack parameter is not VERIFIED and signed |
| QC_PIA_MISSING | Quebec tenant without impact assessment references |
| OUTSIDE_RECIPIENT_WINDOW (defer) | Outside legal and staffed hours in the recipient's local time |
| ROUTE_CAPACITY_SATURATED (defer) | Route concurrency or pacing limit reached |

---

## 6. Explicitly not in the core

- Separate squads per module. One role library; call profiles compose it.
- Per-module vendor stacks. A vendor route is chosen by data class (section 8, B11), not by industry.
- A second voice provider adapter. Build the interface; defer the implementation until a commercial SLA needs it.
- Autonomous mode for any new module. Human-assisted first; graduation by measured criteria.
- Patient or policyholder contact of any kind, and payment collection from individuals. Out of scope by product boundary and by the debtor-kind gate.
- Employer HR and disability. Not assessed.
- Pharmacy accounts receivable beyond preauthorization pockets (weak fit in the research).
- Policy packs for modules whose rules are unverified (ADP, ODSP vendor billing, Veterans Affairs).
- Provincial policy packs outside Ontario until each statute is read.
- Heavy per-module screens. One generic case and receivable view serves all modules.

---

## 7. Technical builds

Size is relative effort with the reason, not a time estimate. "Needs" lists hard dependencies.

### B0. Stage 0 safety fixes (S)

- Fix the three verified defects: reference-number regex returning "number" or "manager" in `src/outcome/processor.ts`; `CARRIER_TIMEOUTS` keys in `src/billing/tiers.ts` not matching the underscored `CarrierId` values; the reaper that runs after an early return.
- WP-0: bring the manual trigger in `src/routes/insurance.ts` to parity with the scheduler for human-assisted mode selection, TELUS TPA resolution and the placeholder-number refusal.
- Acceptance: unit tests per defect; a parity test for the manual trigger (proposal section 10, WP-0).
- Needs: nothing. Rollback: revert.

### B1. Privacy controls (L; in flight)

Scope is FIX-PROMPT-PRIVACY-GAPS.md workstreams W1 to W10: documentation corrections, consent attestation and agent permission, learning default-deny, breach register, variable allowlist, truthful notices, retention coverage with dry run, sub-processor register, Quebec gate, audit coverage.

Design constraint from this spec: the attestation and permission records must be shaped as `authorization_grants` rows so B3 absorbs them without migration rework.

Status: branches privacy-controls-w1 to w4 exist; contents not reviewed by me.

### B2. Dispatch service (L)

- One module `dispatch/dispatchService.ts` implementing `dispatch(task, trigger)` with the preflight chain in section 5. Intents are written for every call (READY, SENDING, CONFIRMED, AMBIGUOUS). The scheduler and the manual route become thin callers. Wire `reconcileStaleDispatchIntents` to the worker schedule.
- A single attempt-creation path; the webhook-born creation in `src/server/frontDesk/vapiDeskEvents.ts` becomes a reconcile-only fallback that logs a defect metric.
- Per-client concurrency ceiling replacing the all-or-nothing practice lock, keeping claim-level idempotency.
- Flag `DISPATCH_V2`, per practice; old paths retained one release.
- Acceptance (proposal WP-1): 20 parallel triggers on one claim produce at most one vendor call and one confirmed intent; ambiguous timeout leaves intent AMBIGUOUS and the queue BLOCKED with no redial; killed process between SENDING and confirm is reconciled to ambiguous; scheduled and manual paths yield identical capability, mode and squad for the same input (property test); dental decisions replay identically.
- Task contract (case and receivable targets) agreed with B4a before coding; dispatch is built against tasks, not claim rows.
- Needs: B0; contract with B4a.

### B3. Governance layer (L)

- Tables: `regime_determination`, `authorization_grants` (kinds in C3), `policy_packs` and `policy_pack_parameters` (statute, section, consolidation date, evidence tag, counsel or founder signature, signed at), `data_class` metadata on vault fields and import columns.
- Profile resolver: given tenant and workflow, returns required grants and the stricter of any conflicting rules; UNDETERMINED behaves as CONFIRMED.
- Gate predicates for every code in section 5, as pure functions with unit tests.
- Admin screens: regime determination, grants (create, revoke, expiry), policy pack status.
- Acceptance: each gate code blocks or defers in an integration test through the dispatch service; revocation takes effect before the next dial; an RLS test per table; a parameter whose status drops from VERIFIED suspends the module.
- Needs: B2 for gate integration; B1 for attestation records; B4a for payer kind and case dates.

### B4a. Ledger kernel (L; universal; starts in Stage 1, in parallel with B2)

The ledger is a baseline requirement for every insurance-facing module, and three other builds depend on it, so it is not deferred. Without it, B2 would be built against `InsuranceClaim` and re-pointed later, B9 has nothing to allocate payments to, policy pack clocks have no fields to run from (invoice received date, loss date), and the debtor-kind gate has no payer entity to inspect.

- Tables: `insurance_cases`, `receivables`, `receivable_lines`, `payment_allocations`, `import_sources`, `import_coverage`, plus a minimal `case_party_roles` carrying three roles (legal debtor, payment recipient, contact) as effective-dated facts, with the payer linked to `payers` (B5 minimal).
- Task contract fixed with B2: a `recovery_task` targets a `case_id` and one or more `receivable_id`s, not a claim row. Dental `call_queue` rows shadow into tasks 1:1; `legacy_claim_id` and `legacy_queue_id` link back.
- Dental dual-write from the existing importer inside its existing transaction; idempotent, resumable backfill; reads stay on `InsuranceClaim` until parity is proven, then flip per tenant behind `FeatureFlag`.
- New non-dental CSV import pipeline targeting the ledger directly, separate from the strict dental carrier-mapping importer.
- Absence handling replaced by `suspected_settled`, scoped by import coverage and per-source baseline.
- Data classes (`HEALTH`, `PERSONAL`, `FINANCIAL`, `GENERAL`) assigned to every kernel column from the start; sensitive fields in typed columns, not JSON.
- RLS and an RLS test for every table.
- Acceptance (proposal WP-3): two sources in one tenant do not affect each other's receivables; a collision case with four invoices stays four receivables and reconciles one payment across them; truncated exports do not mass-close; re-import is idempotent; replaying dental fixtures through ledger and legacy reads produces the same decisions.
- Needs: B0. Gate predicates in B3 that depend on payer kind or dates read the kernel.

### B4b. Ledger extensions (module-owned, Wave B)

Built at module time and only for the modules that need them: extended `parties` roles and `case_party_roles`, `remittances` (one remittance covering many invoices), `accrual_schedules` (storage and accommodation), `preauthorizations`, `callback_expectations`. Each ships with typed extension tables, RLS tests and the module's golden transcripts.

### B5. Registry (M)

- `payers`, `payer_programs`, `contact_routes` with scope (platform, tenant, case), operating hours and cutoff, recipient time zone (including Newfoundland half-hour and Saskatchewan no-DST), validated simultaneous-call limit, call-start pacing, block and answer-rate signals, effective date, evidence reference.
- Destination guard reads `contact_routes`; seeded from `CARRIER_PHONE_MAP` and the six dental carriers with `legacy_carrier_id`; route parity test proves the six legacy numbers dial as before.
- Replaces the Eastern-hours constant in `src/carriers/adapter.ts` with the intersection of legal hours and route hours in recipient-local time.
- Acceptance: parity test; an out-of-scope number is refused with an auditable reason; a case-scope route cannot be read by another tenant (RLS test).
- Needs: B2, B3; payer link shared with B4a.

### B6. Objective packs, roles and typed outcomes (L)

- Pack loader and schema; `submit_call_outcome` tool with schema validation; capability grants enforced at tool endpoints; decision engine; outcomes never close a financial state from inferred text.
- Bring Claims_Scribe's prompt and tools (`log_call_outcome`, `request_staff_handoff`) into the repository; extend `vapiSquadConfig.test.ts` to the human-assisted squad.
- Scope lint on prompts (no negotiation, no legal conclusions, no interest or limitation advice, no demand language) and a transcript lint that fails on the same.
- Voicemail detection in config and an answered-by handler; hangup latency measured.
- Opening-identification test per pack (automation, principal, callback number, address, truthful recording statement).
- Variable allowlist lint fails the build when a non-allowlisted field goes to Vapi.
- Both prompt trees (`Collect-RX-main/agents/` and `/agents`) edited and diffed.
- Acceptance: pack schema tests; golden transcripts per pack; a tool call outside the grant is rejected and logged.
- Needs: B2, B5.

### B7. Knowledge scoping (M)

- Scope columns on carrier knowledge (default platform for legacy rows), new unique constraints coexisting with the old (NOT VALID then validate), promotion needs N confirmations and review, learning flags per tenant, tenant-scoped default for custodian tenants.
- Acceptance: a case-scope destination never returns for another tenant; opt-out tenant yields zero learning rows and zero outbound model calls.
- Needs: B1 (flags), B5.

### B8. Identity bundles (M)

- Bundle kinds for person, vehicle (VIN, plate), property (address, policy), WSIB and program references; per-objective allowlists; transcript scrubbing patterns for the new identifier shapes.
- Acceptance: no plaintext in logs (existing logger scrub tests extended); allowlist contract test per call type.
- Needs: B6.

### B9. Payment allocation and attribution (M)

- `payment_allocations` with evidence kinds, `recovery_attributions`, a classifier; changes to `paymentVerification.ts`; dashboard "Dollars recovered" split into verified receipts and attributed recovery.
- Acceptance (proposal WP-2): an insurer-paid claim with no call is organic and excluded from attributed recovery; a call-recorded payment issue date then payment is attributed; write-offs allocate as zero recovery; historic events appear as legacy unclassified.
- Needs: B4a. It can start on dental as soon as the kernel tables exist.

### B10. Capacity and billing integrity (M)

- Capacity configuration read from one source and verified against the vendor-reported limit; shared reserve scales with total slots; fleet constant removed.
- Per-client entitlement ledger (daily minutes allocated, dispatched, consumed, remaining) and a deadline-aware fair scheduler with borrow and reclaim.
- Route semaphore using `contact_routes` limits and pacing.
- COGS breaker counts authorized overage revenue; overage pre-authorization with a spend limit.
- Scale daily-minute reservation as a plan field.
- Instrumentation: hourly concurrency per route and per client, saturation, entitlement deficit, call duration, calls blocked by each limit.
- Acceptance: simulated mix of clients and routes never exceeds a route limit; a client behind its entitlement is scheduled ahead of one that is ahead; Hold Sentinel with approved overage is not paused at 1,773 minutes; a 600-minute day is deliverable for a Scale tenant.
- Needs: B2, B5. Do not sell a daily-minute guarantee before this ships.

### B11. Vendor route abstraction (S to M, gated on vendor answers)

- Dispatch selects Vapi credentials by data class (health route, commercial route) if the vendor answers confirm that HIPAA mode and zero data retention are organization-level; otherwise one route.
- Provider allowlist CI: every provider in the squad config must be in the sub-processor register.
- Interface for a second execution provider; implementation deferred.
- On the health route without vendor-side analysis, outcomes come only from server-received tool calls.
- Needs: written answers to VAPI-QUESTIONS V1 to V6. Do not build before.

### B12. Module runtime and test harness (M)

- Manifest schema, registry, validation, lifecycle states, per-tenant activation, the CI manifest test.
- Synthetic-data generator per module; mock Vapi that records requests and replays scripted conversations; end-to-end test runner; the refusal demo (each gate code produces a visible refusal).
- Needs: B2, B3.

### B13. Evidence, observability, controls (M)

- `case_evidence` and `call_facts` writers; PhiAccessEvent path-coverage test; breach register routes; subject access export and deletion workflow; policy lint script in CI; traceability check (obligation to policy to control to test, fails on dangling references).
- Needs: B1; the legal-policy L4 and L5 branches may already cover the lint and traceability pieces; check before building.

### B14. Generic UI (M)

- Unified work queue across modules; case and receivable detail; compliance gate reasons shown to staff with the next action; grants and attestation management; module settings; policy pack status view for admins.
- One generic case view, not per-module screens.
- Needs: B3, B4a.

### B15. First module slice: collision, tow and storage on synthetic data (L)

- Built on B2 to B6, B12: thin ledger extension (one case, several invoices, storage accrual), two contact routes, a W5 policy pack containing only VERIFIED rows (RSLA ss. 3, 4, 15 to 18, 24; O. Reg. 427/15; TSSEA ss. 20 to 32, 60), a payment-trace objective pack with status-only scope, forced handoff on disputes and liens, golden transcripts, an end-to-end mock-Vapi test, and the refusal demo.
- Purpose: show the shared engine carries a different entity shape and counterpart without forking. It does not prove demand or counterpart engagement.
- Needs: B2, B3, B4a, B4b (slice), B5, B6, B12.

### Per-module recipe (B16 onward, one module at a time)

1. Cowork reads for the module's unverified sources; update tags.
2. Founder signs the register rows that block the module.
3. Policy pack: only VERIFIED and signed parameters drive agent speech; the rest are staff alerts.
4. Objective packs with scope lint, golden transcripts.
5. Wave B ledger tables with RLS tests.
6. Import adapter (CSV first).
7. End-to-end mock-Vapi test and the refusal demo.
8. Human-assisted pilot with measurement; graduation criteria written before launch.

---

## 8. Dependencies and order

```text
B0 --> B2 --+--> B3 --> B6 --> B8
 |          |     |       \--> B15
 |          |     \--> B5 -+--> B7
 |          |              \--> B10
 |          \--> B12 -------------> B15
 +--> B4a --+--> B9 (payment allocation on dental first)
 |          +--> B3 gate predicates (payer kind, case dates)
 |          \--> B4b (module extensions) --> B15
 B1 (parallel; feeds B3, B7, B13)
 B11 (blocked on vendor answers)
 B13, B14 (parallel from B3/B4a)
```

Mapping to earlier plans:

| This spec | Proposal | Other prompts |
|---|---|---|
| B0 | WP-0, defect fixes | Stage 0 |
| B1 | (new, policy) | FIX-PROMPT W1 to W10 |
| B2 | WP-1 | |
| B3 | section 5.6, 18.2 | |
| B4a, B4b | WP-3, M1 to M3 (kernel pulled earlier; extensions per module) | |
| B5 | WP-4 | |
| B6 | WP-5 | |
| B7 | WP-6 | |
| B8 | WP-7 | |
| B9 | WP-2, WP-9 | |
| B10 | section 18.8 | capacity review |
| B11 | section 18.6 | VAPI-QUESTIONS |
| B12, B14 | (new) | |
| B13 | | LEGAL-POLICY L4 and L5 |
| B15 | WP-8 (first vertical) | |

Stage mapping (90-day plan, proposal section 19):

| Stage | Builds |
|---|---|
| 0 | B0, B1 |
| 1 | B2, B4a (kernel, in parallel with B2), B3 (core), B9, vendor answers, Cowork reads |
| 2 | B5, B6, B7, B8, B10, B12, B13, B14 |
| 3 | B15 (synthetic demo), then the first real module in human-assisted mode |
| 4 | Further modules; graduation by measured criteria |

Critical path to the demo: B0, B2 with B4a, B3, B5, B6, B12, B4b (slice), B15. B1 runs beside it. B10 is on the critical path to any commercial promise, not to the demo.

---

## 9. Engineering standards that apply to every build

- Additive migrations only; flags default to current behaviour unless the founder's pre-launch statement is confirmed from the repo, in which case fail-closed controls may default on.
- RLS and an RLS test for every new table; policies match the existing `app_rls_practice_allowed` pattern.
- Idempotency at every external effect; vendor idempotency key kept.
- No PHI in logs, errors, fixtures or snapshots; synthetic data only.
- Test layers: parity tests against dental behaviour, property tests for concurrency and mode decisions, golden transcripts per pack, end-to-end tests against a mock Vapi, log-scan tests.
- CI gates: manifest test, vendor allowlist, policy lint, traceability check, dash lint on policy documents.
- No product or code text says compliant, HIPAA compliant, or Canadian data residency.
- Two prompt trees are edited together and diffed.

---

## 10. Risks and unknowns

| Risk | Effect | Mitigation |
|---|---|---|
| Vapi HIPAA and ZDR may be organization-level and exclusive [X] | Possible two-organization route; health route loses vendor analysis | B11 waits for written answers; B6 already moves outcomes to tool calls |
| First non-dental module forces generalization of ledger, registry and packs | Largest engineering cost lands there | Pick the lowest compliance-load vertical for the first real module; demo on synthetic data first |
| Carrier concurrency cap binds before vendor slots | Slots beyond about 30 unusable on six carriers | B5 route capacity fields; measure hourly concurrency per route first |
| Policy pack parameters drift as statutes change | Silent wrong behaviour | Consolidation date and evidence tag per parameter; watch list; suspend on status drop |
| Counterparts may refuse AI callers | Module delivers no value | Human-assisted first; measure answer and engagement rates |
| Demand beyond phone-residual work is unproven | Build for a thin market | Public-data demand model; do not scale modules before evidence |
| Quality of in-flight privacy work unreviewed (one session was on a small model at medium effort) | Weak controls in the base everything builds on | Review W2, W3, W4 before B3 absorbs them |
| Cowork and vendor facts unread | Several gates rest on unverified rules | Run the Cowork reads; keep unverified rows as staff alerts, never agent speech |

---

## 11. Decisions needed

From Khalid:

1. Accept the core inclusions in section 3 and the exclusions in section 6.
2. Confirm B15 (collision, tow and storage) as the synthetic demo module.
3. Confirm the first real module after the demo (I recommend W1 allied health on compliance load; commercial value is your call).
4. Decide whether B10 (capacity and billing integrity) is required before any customer-facing daily-minute commitment (I recommend yes).
5. Answer the open questions: who builds beyond Claude Code sessions and how much review time you have; whether any dental practice has committed; tool versus agent operation; raise stage.

From vendors: VAPI-QUESTIONS V1 to V6 before B11.
