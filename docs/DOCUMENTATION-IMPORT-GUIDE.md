# CollectRx Documentation Import Guide

**Status:** Critical documentation exists on user's local Desktop. This guide maps which files should be uploaded to the project and where.

**Generate date:** 2026-07-19

---

## Priority 1: CRITICAL — Upload to `/docs/audits/`

These are technical audits that both Claudes MUST reference. They contain infrastructure decisions, compliance gaps, and known issues that are load-bearing for all future work.

### 1.1 Engineering Execution Audit (2026-07-04)
**Source:** `~/Desktop/Dentist/Collect-RX/ENGINEERING-AUDIT-2026-07-04.md`  
**Upload to:** `docs/audits/ENGINEERING-AUDIT-2026-07-04.md`  
**Why:** Documents the Railway→Fly migration, identifies stale documentation, exposes dead endpoints (`/api/insurance/claims/import`, `/api/patients/balances`, `/api/work-queue/sync`), and re-scopes the AbelDent connector task. Without this, the other Claude will repeat misguidedly on endpoints that don't exist.

**Action items tracked:**
- [ ] Verify Fly volume encryption via `fly volumes list`
- [ ] Fix SPF/DKIM/DMARC (DNS records)
- [ ] Create staging environment on Fly
- [ ] Rotate secrets (all currently copied verbatim from Railway, not regenerated)
- [ ] Test database restore RTO
- [ ] Add WCAG label fixes to login forms

---

### 1.2 Full Security Audit (2026-05-29)
**Source:** `~/Desktop/Dentist/Collect-RX/FULL-SECURITY-AUDIT-2026-05-29.md`  
**Upload to:** `docs/audits/FULL-SECURITY-AUDIT-2026-05-29.md`  
**Why:** Verdict: "well-engineered for security, no critical or high findings." Lists all fixes that have been applied (outcome confidence gating, auth fail-open fixed, JWT algorithm pinned, XSS in reports fixed). Hardening recommendations for future work (CSP, token hashing, SAST in CI).

**Action items tracked:**
- [ ] `npm audit fix` (production runtime: `qs` moderate DoS)
- [ ] Enable Content-Security-Policy (currently disabled)
- [ ] Hash password-reset tokens at rest
- [ ] Add regression tests for outcome-confidence gating

---

## Priority 2: CRITICAL — Upload to `/docs/compliance/`

Compliance is the binding constraint. Both Claudes must follow these.

### 2.1 Compliance Code Handoff (2026-06-15)
**Source:** `~/Desktop/Dentist/collectrx-code-handoff-compliance.md`  
**Upload to:** `docs/compliance/CODE-HANDOFF-COMPLIANCE.md`  
**Why:** Four targeted changes required before any live carrier calls. This is not optional. Specifies exact code changes (CarrierConfig fields, Vapi payload injection, PHI audit logging).

**Acceptance criteria:** All four changes **must** be complete before any deployment to production calling any carrier. See the document for the full checklist.

---

### 2.2 Access Control System (2026-05-20)
**Source:** `~/Desktop/Dentist/collectrx-access-control-handoff.md`  
**Upload to:** `docs/compliance/ACCESS-CONTROL.md`  
**Why:** Defines RBAC roles (front_desk, practice_owner, billing_ops_manager, platform_dev) and their permissions. This is the security boundary for multi-tenant access. Do not code any access checks without reading this.

---

### 2.3 PHIPA Compliance Tracker
**Source:** `~/Desktop/Dentist/PHIPA\ Compliance/PHIPA_Compliance_Tracker.md`  
**Upload to:** `docs/compliance/PHIPA-COMPLIANCE-TRACKER.md`  
**Why:** Tracks PHIPA compliance requirements status (data breach notification plan, DPA review, vendor audits). Keep this up-to-date as vendors are onboarded or contracts evolve.

---

### 2.4 Vendor DPA Review Checklist
**Source:** `~/Desktop/Dentist/PHIPA\ Compliance/Vendor_DPA_Review_Checklist.md`  
**Upload to:** `docs/compliance/VENDOR-DPA-REVIEW-CHECKLIST.md`  
**Why:** Procedure for vetting new vendors (Vapi, Twilio, SendGrid, Stripe, any LLM provider). Before any third-party integration, run this checklist.

---

## Priority 3: STRATEGIC — Upload to `/docs/strategy/`

These are business/product decisions that should inform engineering prioritization.

### 3.1 Strategic Analysis (2026-06-26)
**Source:** `~/Desktop/Dentist/CollectRx_Strategic_Analysis.md`  
**Upload to:** `docs/strategy/STRATEGIC-ANALYSIS-2026-06-26.md`  
**Why:** Market research on Canadian dental AI RCM space. Identifies Toothy AI as the primary competitor (YC W25, 12–24 month window to build moat). Details four strategic pivots: Adjudication Graph, Shadow Ledger, self-hosted SLMs, DSO enterprise motion. Provides TAM/SAM/SOM estimates and risk analysis.

**Key for engineering:** CDCP expansion (2026) is about to double claim volume. Adjudication Graph (mining call data for claim-outcome predictability) is the most durable moat. This should inform what signals to log during Vapi calls.

---

### 3.2 Strategic Roadmap (2026)
**Source:** `~/Desktop/Dentist/CollectRx_Strategic_Roadmap_2026.docx`  
**Upload to:** `docs/strategy/ROADMAP-2026.docx` (or convert to .md if readable)  
**Why:** Captures product roadmap for 2026. Needed context for prioritization.

---

## Priority 4: OPERATIONAL — Upload to `/docs/operations/`

Day-to-day runbooks and procedures.

### 4.1 Build Briefs (Customer-facing)
**Source:**
- `~/Desktop/Dentist/collectrx-build-brief.md`
- `~/Desktop/Dentist/front-desk-build-brief.md`
- `~/Desktop/Dentist/practice-owner-build-brief.md`

**Upload to:**
- `docs/operations/BUILD-BRIEF-MAIN.md`
- `docs/operations/BUILD-BRIEF-FRONT-DESK.md`
- `docs/operations/BUILD-BRIEF-PRACTICE-OWNER.md`

**Why:** Define feature sets for each role. These are product specs. Useful for context on what the UI should support and why.

---

### 4.2 Platform Health Dashboard Spec
**Source:** `~/Desktop/Dentist/platform-health-dashboard-spec.md`  
**Upload to:** `docs/operations/PLATFORM-HEALTH-DASHBOARD-SPEC.md`  
**Why:** Specification for the admin/observability dashboard. Defines what metrics, alerts, and data should be exposed.

---

## Priority 5: NOT UPLOADING (Keep local or skip)

### Skip: Word/Excel Files with Vendor/Legal Content
- `collectrx-billing-agent-authorization.docx` — legal doc, not engineer-actionable
- `collectrx_dpa.docx` — vendor DPA, keep in legal folder, not repo
- `collectrx_risk_acceptance_vapi.docx` — risk doc, reference only
- `collectrx_privacy_policy.docx` — compliance doc, reference only
- `collectrx-phipa-agent-agreement.docx` — contract, keep signed version elsewhere
- `collectrx-vapi-script-disclosure.docx` — Vapi system prompt, managed in Vapi dashboard
- `collectrx-persona-gaps.md` — marketing-internal, not engineering
- `collectrx-email-templates.md` — operations, not code
- `collectrx-sales-funnel-strategy.md` — business, not code
- `collectrx-tiering-strategy.md` — pricing, not code
- `collectrx-strategic-brief-2026-06-18.md` — superseded by newer strategic analysis
- `collectrx-prospect-tracker.xlsx` — sales tracking, not engineering

### Skip: AI Disclosure (reference, not actionable code)
- `~/Desktop/Dentist/PHIPA\ Compliance/AI_Disclosure_Paragraph.txt` — approved language for customer privacy notices; reference only, keep in compliance folder

---

## How Both Claudes Should Use These Docs

### On startup:
1. **Check for missing docs:** If you're about to work on compliance or infrastructure, read the relevant audit first.
2. **Check for stale docs:** If a doc is older than 2 weeks, verify its claims against the current code/git log before citing it.
3. **Reference, not gospel:** Audits identify gaps and risks. Don't treat them as complete specifications — specs live in CLAUDE.md and code.

### When blocked or uncertain:
- Check the relevant audit (if exist): it may have already identified the issue and the fix.
- Check the compliance documents: they define what's off-limits.
- Check the strategic docs: they may reframe the priority.

### When updating:
- If you fix something identified in an audit (e.g., "SPF is broken"), update the audit doc to mark it as fixed and the date.
- If you discover a new compliance gap, add it to the compliance tracker.
- If you change the architecture or roadmap, update the strategic docs.

---

## Upload Steps (for other Claude)

When setting up the new account, run:

```bash
cd ~/Desktop/Dentist/collectrx-platform

# Create directories if missing
mkdir -p docs/audits docs/compliance docs/strategy docs/operations

# Copy priority 1–4 files
cp ~/Desktop/Dentist/Collect-RX/ENGINEERING-AUDIT-2026-07-04.md docs/audits/
cp ~/Desktop/Dentist/Collect-RX/FULL-SECURITY-AUDIT-2026-05-29.md docs/audits/
cp ~/Desktop/Dentist/collectrx-code-handoff-compliance.md docs/compliance/CODE-HANDOFF-COMPLIANCE.md
cp ~/Desktop/Dentist/collectrx-access-control-handoff.md docs/compliance/ACCESS-CONTROL.md
cp ~/Desktop/Dentist/PHIPA\ Compliance/PHIPA_Compliance_Tracker.md docs/compliance/
cp ~/Desktop/Dentist/PHIPA\ Compliance/Vendor_DPA_Review_Checklist.md docs/compliance/
cp ~/Desktop/Dentist/CollectRx_Strategic_Analysis.md docs/strategy/
cp ~/Desktop/Dentist/collectrx-build-brief.md docs/operations/BUILD-BRIEF-MAIN.md
cp ~/Desktop/Dentist/front-desk-build-brief.md docs/operations/
cp ~/Desktop/Dentist/practice-owner-build-brief.md docs/operations/
cp ~/Desktop/Dentist/platform-health-dashboard-spec.md docs/operations/

# Commit
git add docs/
git commit -m "docs: Add critical audits, compliance, and strategic docs

Imported:
- Engineering execution audit (Fly migration, stale docs, dead endpoints, action items)
- Security audit (fixes applied, hardening recommendations)
- Compliance code handoff (4 required changes before live carrier calls)
- Access control (RBAC model for multi-tenant)
- PHIPA compliance tracker and vendor DPA checklist
- Strategic analysis (market, competition, strategic pivots)
- Build briefs and platform health spec

These docs are load-bearing for all future work. See DOCUMENTATION-IMPORT-GUIDE.md.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"

# Push
git push origin main
```

---

## Notes for Khalid

- **Secrets:** None of these docs contain API keys, database URLs, or credentials. All are safe to commit.
- **Currency:** The audits are from May–July 2026. Verify any action item listed is still relevant by checking `git log` and current code state.
- **Handoffs:** Both Claudes should read the audits on startup. The other Claude will use the compliance docs as law — do not override them without updating the docs and committing the reason.
- **Next steps:** After importing, create a task/issue for each audit action item so it's tracked and not forgotten.

---

*Generated by Claude Code | For the multi-Claude handoff protocol*
