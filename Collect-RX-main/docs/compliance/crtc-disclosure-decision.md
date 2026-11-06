# Automated-call disclosure safety decision

**Status:** Conservative product control; legal applicability remains jurisdiction/workflow-specific
**Date:** 2026-06-23  
**Supersedes:** Any Validation Playbook language instructing human-sounding AI behavior  
**Referenced by:** CLAUDE.md Section 8

---

## Decision

CollectRx calls insurance-carrier provider lines for claims-status follow-up. The CRTC's automated-calling and identification rules may apply depending on the technology and workflow; AI/synthetic-voice treatment is also the subject of an active CRTC proceeding. CollectRx therefore uses a conservative disclosure without claiming that every call has received a definitive legal classification.

The product requires the opening human-facing disclosure to:
- Identify the automated nature of the call
- State the name of the practice on whose behalf the call is made
- Provide a callback number

The rules' ten-second provision addresses disconnection after the called party hangs up; it is not used here as proof of a universal disclosure deadline. Any prior instruction to sound human, obscure automation, or evade identification remains invalid and must not be deployed.

---

## Canonical Disclosure Script

The following script is the mandatory CollectRx safety disclosure. It is implemented in `vapi-squad-config.json` as `Claims_Agent.firstMessage` and is intended to fire at the start of a human interaction (after IVR navigation is complete). It is not represented as a legal certification; applicability and consent obligations can vary by workflow and jurisdiction.

```
"Thank you for taking my call. I am an automated calling system on behalf of 
[Practice Name]'s billing department. You can reach us at [Practice Phone]. 
This call may be recorded for quality purposes. I am following up on a claim 
that was submitted [N] days ago."
```

**Sequencing requirement:** automation, practice identity, claims-status purpose, callback information, and recording/transcription notice must be delivered at the start of the live-representative interaction.

---

## Current Agent Disclosure Architecture

| Agent | Disclosure Behavior | Status |
|---|---|---|
| IVR_Navigator | No disclosure during IVR navigation — talking to a machine | Correct |
| Claims_Agent | Discloses automated nature + practice name + purpose + callback in `firstMessage` | Required product control |
| Escalation_Closer | Inherits call context; does not re-disclose (rep already knows) | Requires transcript evidence of initial disclosure |
| Resolution_Closer | Inherits call context; does not re-disclose (rep already knows) | Requires transcript evidence of initial disclosure |

**IVR_Navigator `firstMessage` uses `{{disclosure_message}}` variable.** This must resolve to an empty string or a silent/ambient wait state during IVR navigation — it must never trigger a verbal disclosure to an IVR machine. Verify the `initiateCall()` function in `src/vapi/client.ts` sets this to an empty string before Kill Test 1.

---

## Invalid Validation Playbook Sections

The following categories of language are invalid for any Canadian deployment regardless of which document they appear in:

| Category | Status |
|---|---|
| Instructions to sound human or avoid sounding automated | INVALID — violates CollectRx disclosure policy and creates regulatory risk |
| Instructions to not identify as AI if asked | INVALID — violates CollectRx disclosure policy and creates regulatory risk |
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
