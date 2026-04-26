# PRD — Phase 3: Insurance Eligibility Rules Engine

**Status:** 🔄 In Progress  
**Owner:** Khalid  
**Target:** Pre-treatment estimate capability before pilot expansion  

---

## Problem Statement

Today, when a patient arrives for treatment, the dental office has no reliable way to estimate what insurance will cover before the procedure. Staff manually call carriers or guess based on experience, leading to patient surprises on their balance and delayed collections post-treatment. CollectRx must close this loop by providing real-time pre-treatment eligibility estimates and post-treatment reconciliation across all 6 Canadian carriers.

---

## Goals

- Calculate accurate pre-treatment coverage estimates for any patient/procedure combination
- Map CDT codes to carrier-specific coverage tiers
- Track deductibles and annual maximums in real time
- Reconcile patient balances after insurance adjudication
- Handle coordination of benefits (COB) for patients with dual coverage

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Pre-treatment estimate accuracy vs actual adjudication | ≥ 85% within $50 |
| Time to generate estimate | < 10 seconds |
| CDT codes covered in rules engine | 100% of common dental procedures |
| Carriers supported | 6 (Sun Life, Canada Life, Manulife, Green Shield, RBC, TELUS AdjudiCare) |
| Test suite coverage | 30+ cases passing |

---

## Functional Requirements

### Eligibility Rules Engine
- Carrier-specific benefit tables stored in JSON config (not hardcoded)
- CDT code → coverage tier mapping per carrier
- Annual maximum cap tracking per patient per plan year
- Deductible remaining calculation
- Waiting period enforcement (e.g., no major restorative in first 12 months)

### Pre-Treatment Estimate
- Input: patient ID, CDT code(s), carrier
- Output: estimated patient portion, estimated insurance portion, confidence score
- Edge cases: plan maximums nearly exhausted, deductible not yet met, procedures requiring pre-authorization

### Coordination of Benefits (COB)
- Primary/secondary carrier identification
- Birthday rule for dependent children
- COB calculation: primary pays first, secondary covers remainder up to plan limits

### Post-Insurance Reconciliation
- Compare estimated vs actual adjudication
- Flag significant variances for human review
- Update patient balance in real time after explanation of benefits (EOB) received

### TELUS AdjudiCare Special Handling
- Operates as a clearinghouse/TPA — identify specific underlying TPA from member card before IVR navigation
- Minimum wait period: day 21 (vs. day 32 for Canada Life)

---

## Technical Constraints

- Rules engine logic lives in JSON config — not in application code — for rapid carrier rule updates
- Database migrations required: CDT code seeding, benefit tables, deductible tracking tables
- Opus model used for eligibility agent reasoning (complex edge cases)
- 30+ test cases required before production deployment

---

## Out of Scope

- Real-time carrier API eligibility calls (reliant on IVR agents — no direct API access yet)
- Orthodontic lifetime maximums (deferred)
- Quebec-specific RAMQ coordination (deferred)

---

## Acceptance Criteria

- [ ] Rules engine returns estimate for all 6 carriers given a CDT code + patient plan
- [ ] COB calculation correct for dual-coverage test cases
- [ ] 30+ test cases passing in test suite
- [ ] Deductible and annual max tracked correctly across multiple claims in a plan year
- [ ] TELUS AdjudiCare TPA identification logic working
- [ ] Post-reconciliation variance flagging operational

---

## V2 Execution Layer

### Validation Mode (Mandatory)

- This phase is executed in **single-practice pilot validation mode**.
- Rules coverage focuses on one pilot practice workflow; no multi-practice rule segmentation is allowed before Day-90.

### Scope Lock

**In scope**
- Deterministic rules engine with versioned JSON rule packs by carrier
- Estimate API with confidence scoring and reconciliation hooks
- COB and deductible/max lifecycle logic for supported scenarios

**Out of scope**
- Live insurer API integrations
- Orthodontic lifetime max and province-specific edge programs

### Task Breakdown

| ID | Task | Owner | Estimate | Dependency |
|----|------|-------|----------|------------|
| P3-1 | Define canonical rules JSON schema + validator | Eng | 1 day | none |
| P3-2 | Create carrier rule packs for 6 carriers with version tags | Eng | 1.5 days | P3-1 |
| P3-3 | Build estimate engine core (coverage, deductible, annual max) | Eng | 2 days | P3-1 |
| P3-4 | Implement COB module (primary/secondary flow) | Eng | 1 day | P3-3 |
| P3-5 | Add reconciliation worker (estimate vs adjudication variance) | Eng | 1 day | P3-3 |
| P3-6 | Implement TELUS AdjudiCare TPA selection branch | Eng | 0.5 day | P3-2 |
| P3-7 | Build test fixtures and 30+ deterministic test cases | Eng | 1.5 days | P3-3..P3-6 |

### Test Plan

- **Unit tests**
  - Rule schema validation and version compatibility checks.
  - Deductible depletion and annual max exhaustion boundaries.
  - COB ordering and residual coverage calculations.
- **Integration tests**
  - Estimate API returns stable results for seeded patient plans.
  - Reconciliation marks variance when delta exceeds threshold.
- **Data quality checks**
  - Procedure category mapping coverage for top CDT codes.
  - Rule pack linting in CI before merge.

### Risks & Mitigations

| Risk | Trigger | Mitigation | Fallback |
|------|---------|------------|----------|
| Rule drift across carriers | Frequent plan exceptions appear | Versioned rule packs with effective dates | Manual override table for pilot accounts |
| Low estimate confidence | Wide estimate-to-actual variance | Capture reason codes and confidence downgrade logic | Route low-confidence estimates to staff review |
| COB ambiguity in dependent plans | Conflicting primary/secondary claims | Explicit decision tree and audit trail | Mark as `needs_human` and exclude from auto estimate |

### Operational Runbook

- Publish rule pack changelog for each update.
- Alert when estimate variance > threshold for 3+ cases/day.
- Rollback rule packs by version if regression detected.

### Exit Criteria (Go/No-Go)

- [ ] Rules schema finalized and enforced in CI
- [ ] 6 carrier packs published with version metadata
- [ ] 30+ deterministic tests passing
- [ ] Estimate endpoint P95 response time under 10 seconds
- [ ] Reconciliation variance dashboard live and monitored
