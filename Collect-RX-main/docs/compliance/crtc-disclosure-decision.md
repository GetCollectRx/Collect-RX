# CRTC Compliance Decision — AI Disclosure Architecture

**Status:** Resolved — CLAUDE.md governs  
**Date:** 2026-06-23  
**Supersedes:** Any Validation Playbook language instructing human-sounding AI behavior  
**Referenced by:** CLAUDE.md Section 8

---

## Decision

CollectRx operates under CRTC Unsolicited Telecommunications Rules (UTR) Part IV Rule 4 (ADAD — non-solicitation). This is a B2B call from a dental practice to an insurance carrier's provider/claims business line. It is not telemarketing, is not subject to the National DNCL, and is not subject to CASL (voice).

**ADAD Rule 4 requires, within the first 10 seconds of a live representative answering:**
- Identify the automated nature of the call
- State the name of the practice on whose behalf the call is made
- Provide a callback number

**CLAUDE.md governs on all operational and compliance decisions.** Any prior document — including any version of a Validation Playbook, early-stage agent prompts, or training materials — that instructs an AI agent to sound human, obscure its automated nature, or evade identification is invalid for use in Canada and must not be deployed.

---

## Canonical Disclosure Script

The following script is the approved CRTC-compliant disclosure. It is implemented in `vapi-squad-config.json` as `Claims_Agent.firstMessage` and fires the moment a human representative answers (after IVR navigation is complete).

```
"Thank you for taking my call. I am an automated calling system on behalf of 
[Practice Name]'s billing department. You can reach us at [Practice Phone]. 
This call may be recorded for quality purposes. I am following up on a claim 
that was submitted [N] days ago."
```

**Sequencing rationale:** Purpose is stated before the AI label to reduce hang-ups, per CLAUDE.md Section 7 guidance. The ADAD identification still occurs within the first sentence of the live-rep interaction.

---

## Current Agent Disclosure Architecture

| Agent | Disclosure Behavior | Status |
|---|---|---|
| IVR_Navigator | No disclosure during IVR navigation — talking to a machine | Correct |
| Claims_Agent | Discloses automated nature + practice name + callback in `firstMessage` | Compliant |
| Escalation_Closer | Inherits call context; does not re-disclose (rep already knows) | Acceptable |
| Resolution_Closer | Inherits call context; does not re-disclose (rep already knows) | Acceptable |

**IVR_Navigator `firstMessage` uses `{{disclosure_message}}` variable.** This must resolve to an empty string or a silent/ambient wait state during IVR navigation — it must never trigger a verbal disclosure to an IVR machine. Verify the `initiateCall()` function in `src/vapi/client.ts` sets this to an empty string before Kill Test 1.

---

## Invalid Validation Playbook Sections

The following categories of language are invalid for any Canadian deployment regardless of which document they appear in:

| Category | Status |
|---|---|
| Instructions to sound human or avoid sounding automated | INVALID — violates CRTC UTR Part IV Rule 4 |
| Instructions to not identify as AI if asked | INVALID — violates CRTC UTR Part IV Rule 4 |
| US carrier phone numbers or IVR scripts | INVALID — not applicable to Canadian operations |
| Flat $500/month pricing references | INVALID — superseded by docs/pricing/pricing-model-v1.md |
| Resolution rate threshold other than CLAUDE.md current value | INVALID — CLAUDE.md governs |

No Validation Playbook file was found in the repository as of 2026-06-23. If one exists outside the repo, treat all sections above as archived.

---

## CRTC Monitoring

CRTC Notice 2026-132 introduced potential additional requirements for AI voice agents on business lines. **Monitor monthly at:** https://www.crtc.gc.ca/eng/publications/notices/

If AI voice is added to the regulated ADAD framework as a distinct class, the disclosure script may require amendment. No change required as of this document's date.

---

## Regulatory Lane Reference

Full compliance lane analysis (including BAAL requirements, CASL scope, PHIPA interaction) is in `docs/compliance/REGULATORY-LANES.md`. This document covers the CRTC disclosure decision only.

---

## Related Documents

- `docs/compliance/REGULATORY-LANES.md` — full lane analysis
- `docs/compliance/carrier-tos-research.md` — carrier-level AI call policy research
- `vapi-squad-config.json` — live agent squad with disclosure wiring
- `vapi-system-prompt.md` — reference disclosure template
- `CLAUDE.md` Section 8 — pointer to this document
