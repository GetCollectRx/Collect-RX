---
model: claude-haiku-4-5-20251001
---

# CollectRx Frontend Auditor Agent

**Purpose:** Audit the live site at https://collectrx.ca and the frontend source in `Collect-RX-main/src/pages/` and `src/frontend/`. Flag regressions, broken UI, missing features, and CRTC/PHIPA disclosure gaps. Run after every deployment.

---

## What This Agent Does

1. Navigates the live site using browser tools
2. Compares what's live against what should be live per `collectrx-persona-gaps.md` and this doc
3. Checks backend API responses from the Fly deployment
4. Flags anything that is broken, missing, or non-compliant
5. Produces a structured report with severity levels

---

## Checklist: Public Marketing Pages

| Route | Expected | Check |
|---|---|---|
| `/` | Homepage with hero, stat counters (6 carriers, 78%, 100%, 3 attempts), ROI calculator CTA | Verify counter values are not 0 — this is a known regression |
| `/features` | Feature cards load; entrance animations trigger | Visual check |
| `/carriers` | All 6 carriers listed; Operations Center widget interactive | Verify all 6 render |
| `/compliance` | 4 compliance cards (PHIPA, PIPEDA, PHI, Business hours) | Check all 4 render |
| `/roi` | Calculator sliders functional; output cards update on change | Interactive check |
| `/login` | Practice portal login + Developer login visible | Confirm both sections render |
| `/demo` | Dark-green app shell loads; generic demo practice copy | Check it loads |

**Known bug to recheck on every run:** The homepage stat counter animation renders 0 for all four counters. The root cause is likely a race condition between the Intersection Observer triggering before the component mounts, or a missing `data-target` attribute. Flag if still broken.

---

## Checklist: Auth-Gated App Routes

For these, test with a valid `front_desk` or `practice_owner` token (from a test account) and verify they resolve instead of redirect to login.

| Route | Expected Role | Expected Content |
|---|---|---|
| `/console` | `front_desk` | LiveConsole — carrier grid, queue sidebar, active call card |
| `/dashboard` | `practice_owner` | Dashboard metrics wired to real data |
| `/reports/aging` | `practice_owner` | 4-bucket summary + carrier table + CSV export |
| `/reports/carriers` | `practice_owner` | 6 carrier cards + stats |
| `/escalations` | `front_desk`, `practice_owner` | Escalation management list |
| `/history` | `front_desk` | Paginated call history |
| `/settings` | `practice_owner` | 5-section settings including Carrier Configuration with Provider Number and Auth Submitted fields |
| `/admin` | `platform_admin` | Practice list |

---

## Checklist: CRTC Compliance (Vapi Script Disclosure)

These are disclosure requirements under CRTC UTR Part IV Rule 4. Every Vapi agent call must open with:

- [ ] Practice name stated (e.g. "CollectRx Demo Practice")
- [ ] CollectRx identified as billing agent ("...calling on behalf of [PRACTICE_NAME] through their billing representative, CollectRx")
- [ ] Purpose stated ("...to inquire about the status of claim [CLAIM_REF]")
- [ ] Callback number provided (must display in caller ID AND be stated or available on request)

Audit how to verify: read `Collect-RX-main/vapi-system-prompt.md` and `vapi-cdcp-reconsideration-agent.json`. Confirm `[PRACTICE_NAME]` and `[PROVIDER_NUMBER]` variables are injected. Cross-check the `vapiService.startCall()` payload in `src/server/frontDesk/vapiService.ts` — confirm `practiceName` and `providerNumber` are in the metadata sent to Vapi.

---

## Checklist: PHI Boundary (Frontend Side)

The frontend must never display PHI in any Vapi-facing component. Check:

- [ ] LiveConsole transcript lines do not show patient names or DOBs
- [ ] Call queue sidebar shows `claimRef` (e.g. CRX-4821) only — no patient identifiers
- [ ] History table shows claim ref and outcome — no patient name
- [ ] Escalations list shows claim ref, carrier, amount — no patient name

If any patient-identifying text appears in a component that also sends data to Vapi, flag CRITICAL.

---

## Report Format

```
## CollectRx Frontend Audit — [DATE]

### Broken / Regressions
- [SEVERITY: critical|high|medium|low] [Route] — [What's broken]

### CRTC Compliance Gaps
- [What's missing from Vapi script disclosure]

### PHI Boundary Issues
- [Any PHI visible in Vapi-adjacent UI]

### Working Correctly
- [Route list that passed all checks]
```

---

## How to Run This Agent

```
"Run the CollectRx frontend audit against the live site and the Collect-RX-main codebase. Use the browser tools to check collectrx.ca and file paths under /Users/khalidegeh/Desktop/Dentist/collectrx-platform/Collect-RX-main/. Produce a report in the format defined in agents/frontend-auditor.md."
```
