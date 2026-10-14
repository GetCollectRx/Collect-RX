# 02. Customer agreement addendum (practice terms)

> DRAFT. Not reviewed by a lawyer. Positions per the founder's signed risk register; R1 and R2 are unsigned, so these clauses are OPEN. Open items listed at the end.

## Purpose

Give each practice a written instrument that (a) permits CollectRx to act as its agent for one purpose, claim status inquiry with insurers, (b) records the practice's attestation, warranty and indemnity about patient consent, and (c) fixes breach notice, sub-processor, secondary-use and offboarding terms.

## Who it binds

CollectRx and each practice that accepts the terms. Accepted in-product before calling is enabled.

## Obligations implemented

| Obligation | Source (research file#row) | Tag |
|---|---|---|
| Agent permission scoped to the custodian's purposes; agent acts only as permitted | PHIPA ss.2 "agent", 17(1), (1.1), (2) (health-privacy.md#1; register R1) | VERIFIED |
| Express, knowledgeable consent for disclosure to an insurer | PHIPA ss.18(3)(a), 18(5) (health-privacy.md#9; register R2) | VERIFIED |
| Agent notifies custodian at first reasonable opportunity of theft, loss or unauthorized use or disclosure | PHIPA s.17(4)(b) (health-privacy.md#2) | VERIFIED |
| Contractual comparable protection when processing is transferred | PIPEDA Sched. 1 cl. 4.1.3 (private-sector-privacy.md#1) | VERIFIED |
| Quebec mandate in writing with protection measures, no keeping after expiry | P-39.1 s.18.3 (FSRA-RCDSO-QUEBEC.md#12) | VERIFIED |
| Client must not knowingly use an unregistered collection agency; scope limited to non-individual debtors | CDSA s.24, Reg. 74 s.19.7 (insurance-licensing-collection.md#2, #5; register R8) | VERIFIED |

## Draft clauses

**1. Appointment and scope.** The practice appoints CollectRx as its agent, under the Personal Health Information Protection Act, 2004 and other applicable law, solely to contact insurers and benefit plan administrators about the status of claims the practice has submitted, and to record the results for the practice (the "Permitted Purpose"). CollectRx will collect, use, disclose and retain personal health information only as necessary for the Permitted Purpose and in accordance with any written conditions the practice gives. CollectRx will not contact patients, will not negotiate settlements, argue coverage or make demands on the practice's behalf, and will not call any payer that is an individual, sole proprietor, partnership or guarantor.

**2. Consent attestation.** Before calling is enabled and whenever the attestation wording changes, an authorized person at the practice attests that (a) the practice has obtained each affected patient's express consent to disclose the patient's information to the patient's insurer for claim follow-up, (b) that consent is knowledgeable, in that patients have been told of this purpose, including that an automated service may make the call, and that they may withhold consent, and (c) the practice will not submit to CollectRx any claim for a patient who has withheld or withdrawn that consent. The attestation records the signer's name and role, the date and the wording version.

**3. Warranty and indemnity.** The practice warrants that each attestation is true when made and remains true while claims are submitted. The practice will indemnify CollectRx against claims, penalties and costs arising from the absence of a patient's consent that the practice attested to. CollectRx does not require, and the practice must not upload, copies of patient consent forms.

**4. No secondary use.** CollectRx will not use personal health information, or call content derived from it, for its own purposes, including product improvement, analytics shared with other customers or training of models, except (a) aggregated operational metrics that contain no personal information, and (b) learning contribution if the practice opts in, limited to content that has passed CollectRx's identifier scan. Default: off.

**5. Safeguards and staff.** CollectRx maintains reasonable administrative, technical and physical safeguards, limits staff access to need, and requires staff and service providers who access personal health information to agree to equivalent restrictions.

**6. Service providers.** CollectRx uses the service providers listed in its sub-processor register, including providers that process in the United States. CollectRx will give the practice at least 30 days' notice before adding a provider that receives patient identifiers; the practice may terminate if it objects. CollectRx remains responsible for its providers' handling of the practice's information.

**7. Incidents.** CollectRx will notify the practice at the first reasonable opportunity, and in any case within 72 hours of confirming, that personal health information it handles for the practice was stolen, lost, or used or disclosed without authority, and will provide the incident packet described in policy 05. The practice decides on notice to patients and to the Information and Privacy Commissioner. (The 72 hour figure is a contractual service level, not a statutory period.)

**8. Requests.** CollectRx will help the practice respond to access and correction requests within 10 business days of a request from the practice.

**9. Offboarding and deletion.** On termination CollectRx will, at the practice's choice, export the practice's data in a common machine-readable format and then delete it within 30 days, except data subject to a legal hold or a retention period stated in policy 06, which is deleted when that period ends. CollectRx will confirm deletion in writing.

**10. Quebec.** For a practice in Quebec, this addendum is the written mandate required by section 18.3 of the Act respecting the protection of personal information in the private sector, and calling is not enabled until CollectRx has completed the assessments required by sections 3.3 and 17.

## Open items

1. Register R1 (agent status) and R2 (consent) unsigned.
2. Notice period for new providers (30 days) and incident service level (72 hours): PENDING_FOUNDER_DECISION.
3. Liability cap interaction with the indemnity: needs the main customer terms, which were not reviewed in this workstream.
4. Attestation wording itself is `PENDING_COUNSEL-v0` in W2 (`src/server/compliance/consent-attestation.json`, PR #124). Clause 2 is the proposed replacement text; copy it into that config once signed.

## Code control and test

| Control | Test | Status |
|---|---|---|
| Calling blocked without a current attestation and agent permission | `tests/consentAttestation.gate.test.ts`, `consentAttestation.dispatch.test.ts` | PR #124 (W2) |
| Attestation wording version stored with each attestation | W2 `textVersion` field | PR #124 |
| Secondary use off by default | `tests/learningPolicy.gate.test.ts` | PR #125 (W3) |
| Debtor-kind gate | Not built (SYNTHESIS F1) | Follow-up |
| Offboarding export and delete | Not built (private-sector-privacy.md#19) | Follow-up |
