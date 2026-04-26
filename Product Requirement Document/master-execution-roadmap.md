# CollectRx Master Execution Roadmap (Day-by-Day)

## Plan Assumptions

- Work cadence: 5 focused days/week
- Goal: pilot-safe **single-practice** launch with measurable assumption validation
- Dependencies: Dr. Hasan availability for schema session, CI signing credentials ready

## Validation Guardrail (Non-Negotiable)

- Operate in **single-practice validation mode** through Day-90.
- No multi-practice roadmap execution, onboarding, or feature work before a recorded Day-90 decision (`scale`, `hold`, or `pivot`).

## Week 1 — Security + Platform Reliability Baseline

### Day 1
- Finalize PHI data classification and outbound field allowlist.
- Confirm secret inventory and rotation checklist.
- Lock scope for Phase 0 and Phase 1-2 (no net-new features).
- Deliverable: signed security scope and task board.

### Day 2
- Implement/enforce UUID-only outbound payload handling.
- Add webhook signature validation and replay protections.
- Add tests for invalid signature and payload sanitization.
- Deliverable: passing signature + PHI boundary tests.

### Day 3
- Wire AWS Parameter Store-backed credentials in staging.
- Add structured audit logging with PII scrubbing.
- Validate end-to-end audit trail (initiation to outcome).
- Deliverable: evidence pack draft (logs/config/test output).

### Day 4
- Harden Electron IPC boundaries and tray lifecycle behavior.
- Add service crash telemetry + single-instance stability checks.
- Deliverable: stable desktop shell acceptance in QA.

### Day 5
- Finalize Windows Service lifecycle and recovery policy.
- Validate dashboard load/retry behavior in shell under degraded network.
- Deliverable: Phase 0 + 1-2 readiness checkpoint.

## Week 2 — Eligibility Engine + Installer Readiness

### Day 6
- Define canonical eligibility rules JSON schema + validator.
- Start carrier rule packs (Sun Life, Canada Life, Manulife).
- Deliverable: schema linting in CI.

### Day 7
- Complete remaining carrier packs (Green Shield, RBC, TELUS AdjudiCare).
- Implement core estimate engine (coverage, deductible, annual max).
- Deliverable: deterministic baseline calculations.

### Day 8
- Implement COB logic and TELUS TPA handling path.
- Add reconciliation hooks for estimate vs adjudication variance.
- Deliverable: reconciliation events generated in test env.

### Day 9
- Build 30+ deterministic rules-engine test cases with fixtures.
- Run regression and tune confidence score thresholds.
- Deliverable: test suite passing + variance dashboard feed.

### Day 10
- Execute schema discovery prep and session protocol with Dr. Hasan.
- Run `discover-schema.js`, collect signed schema artifact.
- Deliverable: approved schema snapshot.

## Week 3 — Windows Packaging + UX Redesign

### Day 11
- Update sync query mapper with discovered schema.
- Run sync dry-run against live/source-comparable data.
- Deliverable: validated sync with row-count parity.

### Day 12
- Finalize installer CI build/sign/artifact release flow.
- Test install/uninstall + reboot service start on clean VM.
- Deliverable: signed installer candidate.

### Day 13
- Build Tailwind token system and component primitives.
- Set Storybook baseline for reusable components.
- Deliverable: design system v1 live.

### Day 14
- Rebuild dashboard + balances + patient AR views.
- Integrate dark mode and error/empty/loading states.
- Deliverable: primary operator flows complete.

### Day 15
- Rebuild estimate + analytics + admin views.
- Run accessibility checks and UX polish pass.
- Deliverable: full UI pass with Lighthouse target trajectory.

## Week 4 — Pilot Go-Live + Validation Operations

### Day 16
- Instrument pilot telemetry events and KPI formulas.
- Build weekly report pipeline/template.
- Deliverable: KPI scorecard v1 with validated definitions.

### Day 17
- Execute go-live checklist and day-1 on-call protocol.
- Confirm live sync, first call batch, dashboard data health.
- Deliverable: week-1 pilot launch complete.

### Day 18
- Run incident simulation drills (webhook failure, sync failure, carrier block).
- Tune alerting thresholds and escalation runbook.
- Deliverable: on-call runbook finalized.

### Day 19
- Conduct stakeholder review and UX acceptance with Dr. Hasan.
- Apply rapid-fix patch for blocker findings.
- Deliverable: pilot acceptance sign-off.

### Day 20
- Publish first weekly pilot report and decision log.
- Lock KPI baseline for Day 30 checkpoint.
- Deliverable: operational steady-state established.

## Checkpoint Cadence (Post-Day 20)

- Day 30: assumption checkpoint #1 (carrier acceptance + early resolution trend)
- Day 60: assumption checkpoint #2 (sustained resolution + ROI signal)
- Day 90: final validation + pricing continuation decision

## Stop/Go Gates

- Do not advance to pilot if:
  - security exit criteria are incomplete,
  - installer/service reliability is unproven on target environment,
  - rules engine deterministic tests fail,
  - dashboard/operator UX blocks day-to-day workflow.
- Do not start multi-practice expansion if:
  - Day-90 decision is not recorded, or
  - any pilot kill condition is triggered and unresolved.
