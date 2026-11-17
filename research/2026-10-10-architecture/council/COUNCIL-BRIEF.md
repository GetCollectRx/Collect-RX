# Council brief: the proposition under review (2026-10-13)

Product: CollectRx, Canadian SaaS. AI phone agents (Vapi squad over Twilio) call insurers, administrators and adjusters for businesses to follow up unpaid insurance-related invoices. Dental only today (Collect-RX-main/). Considering expansion to: auto rehab and allied health, property restoration and emergency housing, collision/tow/storage, equipment/pharmacy/hearing. Ontario first, then Canada. Founder fears bloat and inconsistency; wants custom workflows where needed and shared plumbing where applicable; wants features backed by evidence, not assumptions.

## Read before judging
- research/2026-10-10-architecture/ARCHITECTURE-PROPOSAL.md (sections 3, 5, 7, 10, 15, 16, 17 especially)
- research/2026-10-10-architecture/EVIDENCE-BACKED-FEATURES.md
- research/2026-10-10-architecture/domain-research/ and feature-research/ (evidence quality: search excerpts only; nothing verified on source pages unless the file says so)
- The code the proposition touches: Collect-RX-main/src/server/frontDesk/queueEngine.ts, src/carriers/adapter.ts, src/routes/insurance.ts, src/vapi/client.ts, vapi-squad-config.json, src/webhooks/vapi.ts, src/outcome/*, src/server/recovery/*, src/pii-vault.ts, prisma/schema.prisma, src/server/pms/*

## The proposition (judge each numbered item)
P1. One shared call engine (IVR navigation, hold waiting, disclosure, handoff, closing, tenant isolation, vault, typed outcome logging, dispatch) with workflow modules around it, not a separate agent system per industry and not one mega-prompt.
P2. One small prompt per call objective (about six modules, W1 claims line, W2 MVA invoice trace, W3 government programs, W4 restoration, W5 collision/tow, W6 preauthorization), replacing the single 17.5k-character dental Claims_Agent prompt. The dental prompt is frozen as dental_v1, not edited in place.
P3. Placement test: a capability goes in the shared core only if dental AND at least one other module need it; if only one module needs it, it lives in that module; if no evidence anyone needs it, it is not built.
P4. Modules extend shared records through typed, validated attribute fields (JSON schema per module), not new tables per vertical.
P5. A module contract: each module must supply an objective pack, an import mapper, policy values (data), outcome-to-action rules, stop triggers, and a passing test suite; a module may not change dispatch, the vault, or the call engine.
P6. A cap of roughly eight shared core entities, exceeded only with a written reason.
P7. Retirement rule: a module with too few calls after a set time is removed.
P8. Cut for now: party-roles table (use fields), accrual schedules, preauthorization and remittance tables, number pool and per-payer budgets until volume forces them, customer-facing QA scoring, anything with no evidence.
P9. First non-dental module is W1 (extended-health claim status for rehab and hearing), because it reuses the most plumbing; if it forces changes to the core, the core is shaped wrong.
P10. Build order: defect fixes in the existing system first (single dispatch path including the manual trigger, honest recovery attribution, disclosure proof, squad in repo, hold time persisted), then buyer-gate compliance items, then narrow human-assisted tests (MVA payment trace, restoration receipt and payee capture), then expand only on call-log evidence.
P11. Every new module launches in human-assisted mode and graduates on measured criteria; call logs are the demand evidence.
P12. Hallucination controls: server supplies every number spoken; outcomes are tool calls with closed enums that always include "unclear"; reference numbers read back; post-call check that each extracted fact appears in the transcript; humans confirm money states; golden-transcript test suite per pack gating releases; model and prompt changes rerun it; packs are versioned and each call records pack version, model and settings.
P13. Shared knowledge is scoped (platform, payer, tenant, case); health-custodian tenants default to tenant-only to protect PHIPA agent status.

## Reviewer ground rules
- You are an adversarial reviewer. Do not agree to be agreeable. Try to break each proposition. If you cannot, say so plainly.
- For each of P1 to P13: verdict (SUPPORT, SUPPORT WITH CHANGES, OPPOSE, CANNOT JUDGE), your strongest objection, evidence for it, and what would change your mind.
- Evidence labels on every claim: CODE (cite file and line you read), SOURCE (URL and quote), REASONING (state the premise), OPINION. Do not present opinion as fact.
- Find what the author MISSED: at least five issues not in the brief, ranked by severity.
- Say which parts of the proposition are over-engineered for the evidence, and which are under-engineered.
- Offer at least one concrete alternative design for the weakest proposition.
- Do not use em dashes or en dashes. No code changes. No live calls or contact with anyone.
- Write your report to /home/user/Collect-RX/research/2026-10-10-architecture/council/<your lens>.md and finish with a message under 250 words.
