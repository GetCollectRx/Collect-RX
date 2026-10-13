# Implementation prompt: close the privacy control gaps in the dental product

Date: 2026-10-13. For a fresh Claude Code session. The prompt is inside the fence.

Scope note: this covers PHIPA, PIPEDA and Quebec Law 25 controls that code can implement. "HIPAA" is US law and does not apply to Ontario practices. Out of scope here, each needing its own prompt: telecom (recipient-local hours, voicemail detection, hangup timing), licensing (debtor-kind gate, scope lint), vendor route changes, and every non-dental workflow.

```text
GOAL
Implement the code-fixable privacy controls identified in the policy research for the shipping dental product in Collect-RX-main/. You are closing gaps, not declaring compliance. Never write the words "compliant" or "certified" in code, comments, docs or PR text. Say "implements control X for obligation Y" and cite the research row.

READ FIRST (in this order, before touching code)
The research is on branch claude/gallant-gates-3skltb (draft PR in GetCollectRx/Collect-RX). Fetch it and read from there:
 1. /CLAUDE.md and Collect-RX-main/CLAUDE.md (standing rules, PHI boundary, no hardcoded practice names, CARRIER_BLOCK, two agent prompt trees that drift).
 2. research/2026-10-10-architecture/policy-research/SYNTHESIS.md (sections 1, 3, 4, 10, 11).
 3. policy-research/health-privacy.md and private-sector-privacy.md (obligation tables, with row numbers HP#n and PS#n).
 4. Collect-RX-main/docs/compliance/ (PHI-VAPI-BOUNDARY.md, PHIPA-MANUAL-PROCESS-RUNBOOK.md, PHIPA-DELETION-TEST-GUIDE.md, HIA-Alberta-Clause.md, Quebec-Law25-PIA.md, VENDOR-AGREEMENTS.md).
 5. The code each workstream names below. Read it before planning. Verify every claim in the research against the code yourself; if the code differs, say so and follow the code.

HARD RULES
 - No deployment, no live Vapi API writes, no calls to carriers, no changes to any Vapi assistant or squad in production, no production database access. Config and prompt changes stay in the repo only.
 - Migrations are additive only (new tables, new nullable columns, defaults that preserve current behaviour). Preserve FORCE RLS: read src/server/db/rlsContext.ts and the existing policies, and add policies for every new tenant table. Never edit an applied migration.
 - Fail closed. A missing attestation, permission, or PIA reference blocks dispatch with a logged reason code and a visible deferral message. Do not add silent defaults that allow calls.
 - Every new behaviour ships behind a flag that defaults to the CURRENT behaviour, except where a workstream says otherwise, so merging cannot change production. Name the flag, document it, and write the enable steps in the PR.
   Exception (founder statement 2026-10-13, not verified by me): no practice is live with real patient data. Before relying on it, check the repo, seeds and deployment config (fly.toml, environment settings, migrations) for any non-test practice or live Vapi configuration. If you can show there is none, the new fail-closed controls (W2, W3, W6, W9) may default ON. If you cannot confirm it, keep every flag off by default and say so in the PR.
 - Destructive operations (retention purge, deletion) must have dry-run mode and must not be enabled by this work.
 - PHI never in logs, error messages, test fixtures or snapshots. Use synthetic data only. Add a log-scan test where you touch logging.
 - Standing rule: no hardcoded practice names, emails or credentials anywhere, including tests and docs.
 - Agent prompts exist in two trees (Collect-RX-main/agents/ ships; /agents root has frontmatter). Any prompt text change must be applied to both and diffed. Squad config changes stay in vapi-squad-config.json and are not synced to Vapi.
 - If a decision needs counsel (wording, retention periods, de-identification standard), implement the mechanism with a placeholder value read from config, mark it PENDING_COUNSEL in code and docs, and list it in the PR. Do not invent legal wording.
 - No em dashes or en dashes in anything you write.

PROCESS
 1. Create a working branch off the default branch (name it claude/privacy-controls-<suffix>). Do not push to claude/gallant-gates-3skltb.
 2. Write plan.md in the scratch area first: for each workstream, files to change, migration, flag, tests, and what you could not verify. Then proceed without waiting for approval, workstream by workstream.
 3. One pull request per workstream, opened as draft, small enough to review. After each: run the checks from Collect-RX-main (npm run ci:collectrx or the individual lint, typecheck, test and build commands) and show the output. Do not open the next PR if checks fail.
 4. After pushing, subscribe to PR activity, fix CI failures and review comments, and re-diagnose until green.
 5. At the end, write a status table: each research row (HP#n, PS#n) as DONE, PARTIAL, or NOT DONE with the PR link and the reason.

WORKSTREAMS (in this order)

W1. Documentation corrections only (no code). Fix, citing the statute text in health-privacy.md:
   - PHIPA runbook: remove the "ss.65-68, 14-day" breach claim (PHIPA s.12(2) says first reasonable opportunity; ss.65-68 are damages and Commissioner powers) and the "ss.37-39" deletion claim (no erasure right; access and correction in Part V; disposal in s.13).
   - HIA-Alberta-Clause: s.66 is the information manager agreement; affiliate breach notice is s.60.1.
   - Quebec-Law25-PIA: remove "72 hours" (enacted s.3.5 says promptly), remove retired patient payment collection and Stripe, correct "identifiers never reach voice agents" to match the ephemeral-variable design, and mark the retention claim PENDING_COUNSEL.
   - PHI-VAPI-BOUNDARY: change "Closed (Option B)" to a status that reflects open legal controls; keep the unchecked boxes.
   - Add a banner to each: "Reviewed against research 2026-10-13; not legal advice; see policy-research/SYNTHESIS.md."
   Acceptance: a grep for the removed claims returns nothing; no doc says compliant.

W2. Consent attestation and agent permission record (HP#1, HP#9, SYNTHESIS H1, H2).
   - Add a tenant-scoped, versioned record: practice attests that patients' express, knowledgeable consent covers insurer communications; separate record of agent permission scoped to purpose "claim status inquiry" with a secondary-use permission flag defaulting to false. Store attestation text version, signer name and role, timestamp. Wording is PENDING_COUNSEL, read from config.
   - Shape the record to match the planned authorization_grants table so it migrates without rework: kind (patient_consent_attestation, agent_permission), scope, signer name, signer role, wording version, evidence reference, effective_from, effective_to, revoked_at. See ARCHITECTURE-PROPOSAL.md section 5.6 and 18.2 on the research branch.
   - Enforce in dispatch preflight (queueEngine scheduled path AND the manual trigger path, which diverge; fix both through one shared check): practices with the health profile and no valid attestation are not dispatched; log a deferral code and show the next action in the existing dispatch deferral fields.
   - Flag defaults OFF in code but add a migration-safe backfill plan in the PR (do not backfill attestations; existing practices must attest).
   - Write audit events for attestation create, revoke and version change.
   - Tests: no attestation blocks both paths; revoked blocks; valid allows; cross-tenant isolation under RLS; audit event written.

W3. Learning pipeline default-deny (HP#14, PS#15, PS section 4, SYNTHESIS F12, H12).
   - Add per-practice learningContribution and learningConsumption flags, default false. Read src/server/learning/carrierLessons.ts, humanAssistedProfiles.ts, submissionChannelMemory.ts and practiceCarrierFeed.ts and gate each: a transcript from a practice with contribution false never reaches the lesson extractor (and is never sent to the model provider); a practice with consumption false is shown no shared lessons.
   - Add an automated identifier and tenant-fingerprint scan on lesson text before it can reach PROPOSED (names, numbers, phone patterns, the contributing practice's name and known identifiers); reject and log the reason code, not the text.
   - Add provenance expiry: a job that nulls sourceCallAttemptId on approved lessons after a configurable period (dry run first).
   - Keep human-assisted calls excluded from learning as they are today.
   - Tests: property tests with seeded fake names and numbers; opt-out tenant yields zero learning rows and zero outbound model calls (mock the client and assert it is not called); consumption false returns empty.

W4. Breach register and custodian packet (HP#2, HP#3, HP#4, PS#12, PS#13).
   - Extend PHIPABreachNotification (or add a new model and migrate) to capture every breach, not only high risk, with the fields in the Breach of Security Safeguards Regulations s.2(1)(a) to (g): circumstances, period, personal information involved, number of individuals, steps to reduce harm, notification steps, contact. Add province, discovery time, real-risk-of-significant-harm assessment, and custodian notification timestamps.
   - Exempt breach records from the retention job and keep them at least 24 months.
   - Authenticated admin routes: create, update, list; plus a generator that outputs a practice-facing breach packet (affected tokens, data elements, timeline, vendors involved) with no direct identifiers, plus a yearly per-category counter export (O. Reg. 329/04 s.6.4).
   - Do not build patient notification; the custodian does that.
   - Tests: required fields enforced; packet contains no identifiers; retention job skips breach rows; RLS isolation.

W5. Data minimization for call variables (HP#10, PS#9, SYNTHESIS H3).
   - Read src/vapi/client.ts around initiateCall. Introduce a per-call-type, per-agent allowlist of variables with a contract test that asserts the exact variable set sent. Remove variables no agent prompt references. Do not change which identifiers an agent speaks.
   - Prepare, but do not sync, prompt changes so identifiers are spoken only after the rep asks (apply to both prompt trees, diff them, and list the change for the pre-launch-audit agent). The IVR_Navigator policy-number reading is the known case; confirm by reading the prompt.
   - Tests: allowlist contract test per call type; no variable outside the allowlist; metadata still UUID-only (existing boundary test must stay green).

W6. Truthful recording and transcription notices (TR#2, TR#19, PS#17).
   - The Claims_Agent opener and src/server/vapi/missedHandoff.ts say "may be recorded" while recordingEnabled is false and transcripts are still produced. Replace with a single constant that states what actually happens (transcription), read from config, wording PENDING_COUNSEL; use it in both places and in both prompt trees.
   - Human-assisted mode: add a per-practice switch that disables transcription by Claims_Scribe, default current behaviour, and record the staff consent basis field. Do not add speech to the Scribe in this PR; document the open notice-to-rep decision as PENDING_COUNSEL.
   - Tests: the constant is the only source of the statement; opener text test.

W7. Retention coverage with dry run (HP#12, PS#10).
   - Read src/server/jobs/dataRetentionJob.ts. Extend coverage to HumanAssistedCallLog, CarrierLesson provenance links, unresolved and abandoned claims and imports, and the orphan columns its header lists, each behind configurable periods read from config (placeholders PENDING_COUNSEL). Add a legal-hold flag that skips a claim. Add a dry-run report mode that outputs counts per table and logs nothing sensitive.
   - Do not enable purge. Do not change the default.
   - Tests on a seeded database: nothing deleted in dry run; legal hold skipped; breach rows never touched; deletion happens only at the configured cutoff; certificate row written.

W8. Sub-processor register and CI check (PS#1, HP#7, HP#11, VG#4).
   - Add a machine-readable register (data file) with vendor, role, data classes handled, region (unknown allowed), contract reference (blank allowed), last review date. Seed from vapi-squad-config.json and the Gemini and Twilio code paths.
   - CI test fails if a provider named in vapi-squad-config.json, or a vendor domain called from server code, is missing from the register. Do not fill contract references; leave them blank.
   - Add a script that prints the register as a table for the vendor questions.

W9. Quebec dispatch gate (PS#3, PS#4, SYNTHESIS H11).
   - Read the schema for practice location fields. If no province field exists, add a nullable one. For practices flagged Quebec, require a PIA reference and agreement reference per outbound vendor before dispatch; fail closed with a deferral code. Flag default off.
   - Tests: Quebec practice without references blocked; with references allowed; other provinces unaffected.

W10. Audit trail coverage (HP#6).
   - List every code path that detokenizes, reads a transcript, exports, or imports PHI. Verify each writes a PhiAccessEvent. Add missing writes and a test that enumerates the paths so a new unlogged path fails CI.

NOT IN SCOPE (write these as follow-ups in the final table, do not start them)
 Subject access export and deletion endpoints; Alberta and BC provincial specifics; vendor route changes and contract questions; voicemail detection, hangup timing, recipient-local hours; debtor-kind gate and scope lint; every non-dental workflow.

DONE MEANS
 Each workstream merged-ready as a draft PR with green checks, tests listed, flag documented, PENDING_COUNSEL items listed, and the final status table written. Say plainly anything you could not verify or finish.
```
