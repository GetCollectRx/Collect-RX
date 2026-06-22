# CollectRx Practice Onboarding Validator Agent

**Purpose:** Validate that a new practice is fully configured and ready to go live before the first call is placed. Nothing goes live without passing this checklist. Run once per new practice at the end of onboarding.

---

## Context

A misconfigured practice can cause: calls to wrong carriers, PHI boundary violations, CRTC non-compliance (calling without authorization letter), billing overcharges, or calls that fail immediately because carrier config is missing. This agent is the go/no-go gate.

---

## Pre-Launch Checklist

### Identity and Account

- [ ] Practice has a `practiceId` in the database
- [ ] Practice name is set (required for CRTC caller identification in Vapi prompt)
- [ ] Practice phone number is set (`practice_phone` variable in Vapi opening disclosure)
- [ ] At least one user account exists for this practice with role `practice_owner` or `office_manager`
- [ ] Login works for that user (test auth flow)

### Data Import

At least one of the following must be true:

**Option A — CSV Import**
- [ ] At least one CSV has been uploaded successfully
- [ ] Zero validation errors on import (or all errors reviewed and accepted)
- [ ] At least 1 claim record exists in `insuranceClaim` table for this practice
- [ ] At least 1 claim is ≥30 days old (otherwise nothing will enter the queue immediately)
- [ ] Check for claims >90 days old — these will be immediately escalated, not queued. Alert the practice if a large proportion of their claims are already >90 days.

**Option B — AbelDent Connector**
- [ ] `ABELDENT_SCHEMA_MAP` is set and points to a valid schema map file
- [ ] `abeldent-sync.js` has run at least once successfully (check sync log)
- [ ] Claim data is present in database

### Carrier Configuration

For each carrier the practice wants to use:

- [ ] `carrierId` is set to a valid value (one of: `sun_life`, `canada_life`, `manulife`, `green_shield`, `rbc_insurance`, `telus_adjudicare`)
- [ ] `enabled: true` is set for at least one carrier
- [ ] `providerNumber` is populated (required for CRTC caller identification — cannot be empty string for any enabled carrier)
- [ ] `authorizationSubmitted: true` for each enabled carrier (Billing Agent Authorization Letter submitted)
- [ ] `minimumClaimAgeDays` ≥ 32 for all carriers except TELUS (≥ 21 for TELUS)
- [ ] `maxAttempts` is 1, 2, or 3 (never 0 or >3)
- [ ] `callWindowStart` is `'08:00'` or later, `callWindowEnd` is `'17:00'` or earlier (Eastern)

If TELUS AdjudiCare is enabled:
- [ ] At least one `telusTpaMappings` entry exists (group prefix → TPA name). Without this, TELUS calls cannot be routed.

### Escalation Configuration

- [ ] `escalationPhoneNumber` is set to a valid E.164 number (`/^\+[1-9]\d{7,14}$/`)
- [ ] The escalation number is staffed during call hours (confirm with practice)

### Voice Agent (Vapi)

- [ ] `voiceAgentEnabled: true` in practice settings
- [ ] PHI decision is resolved (see `vapi-squad-auditor.md`) — either PHI-free design confirmed OR BAA with Vapi is signed
- [ ] For each enabled carrier: a test call simulation has been run against a test claim (not a real carrier call — a dry-run through the queue engine to verify dispatch logic fires correctly)

### Billing / Tier

- [ ] Practice is on a paid tier (or trial with explicit acknowledgment of 500 min / 50 min/day hard stop)
- [ ] Stripe customer ID is set (for paid tiers)
- [ ] Practice has been told: their tier, their monthly minute allowance, what happens when they hit the cap

### Test Claim

Before going fully live, run one real call on the lowest-value eligible claim:
- [ ] Claim age ≥ 32 days (≥ 21 for TELUS)
- [ ] Amount < $500 (start small)
- [ ] `front_desk` or `office_manager` is watching the LiveConsole during the call
- [ ] Call completes without `ivr_failure` or `CARRIER_BLOCK`
- [ ] Outcome is logged and visible in Call History

---

## Blockers (Cannot Go Live Until Resolved)

Any of these is a hard stop:

| Blocker | Why |
|---|---|
| `providerNumber` empty for an enabled carrier | CRTC identification requirement fails |
| `authorizationSubmitted: false` for any enabled carrier | Calling without authorization — CRTC/carrier risk |
| No `escalationPhoneNumber` set | Human takeover and warm transfer will fail |
| Zero claims in database | Nothing to queue |
| TELUS enabled with no TPA mapping | Every TELUS call will fail |
| PHI decision not resolved (see Vapi Squad Auditor) | PHIPA violation risk |

---

## Report Format

```
## Practice Onboarding Validation — [PRACTICE_NAME] — [DATE]

### Status: GO / NO-GO

### Blockers (must resolve before go-live)
- [List]

### Warnings (should resolve soon)
- [List]

### Passed Checks
- [List]

### First Call Recommendation
- Suggested claim: [claimRef] — [carrier] — [amount] — [age] days
```

---

## How to Run This Agent

```
"Run the CollectRx practice onboarding validation for [PRACTICE_NAME] (practiceId: [ID]). Query their practice settings, claim count, carrier configs, and billing tier. Work through agents/practice-onboarding-validator.md. Flag all blockers. Produce a GO/NO-GO report."
```
