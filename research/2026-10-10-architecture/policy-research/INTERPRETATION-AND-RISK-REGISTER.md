# Interpretation memos and founder risk-acceptance register

Date: 2026-10-13. Owner of every decision: Khalid (founder). Prepared by Claude from primary text read in this research. This is not a legal opinion and does not claim to be one; neither is a founder's own reading. It is a written record of what the law says, the reading adopted, the reading that goes the other way, and the risk Khalid accepts by proceeding. Where a source could not be read, the row says so and the decision stays open until it is read (Cowork prompt) or Khalid accepts the gap in writing.

Direction recorded: counsel is optional, not a gate. The questions below were previously labelled "counsel questions." They are interpretation questions. The engineering default is the cheapest control that holds under either reading.

How to use a row: read the quoted provisions, check the adopted reading, and either sign it or change it. A signed row is the product's legal position. Review dates are triggers to re-read, not approvals.

---

## R1. Is CollectRx a PHIPA agent of the practice, and what follows?

- Text read (VERIFIED, ontario.ca/laws PHIPA): s. 2 "agent": a person who, with the custodian's authorization, acts for or on behalf of the custodian in respect of PHI "for the purposes of the custodian, and not the agent's own purposes." s. 17(1) to (3): custodian remains responsible; may permit an agent to collect, use, disclose, retain or dispose of PHI only as necessary for the agent's duties; agent may not act beyond what the custodian permits. s. 17(4)(b): agent notifies custodian at first reasonable opportunity of theft, loss or unauthorized use or disclosure. s. 10(4) and O. Reg. 329/04 s. 6: a non-agent electronic service provider may not use or disclose PHI except as necessary to provide the service, and its staff must agree to the same restriction.
- Adopted reading: when CollectRx makes claim-status calls for a practice, it acts for the custodian's purposes and is an agent. Any use of that content for CollectRx's own purposes (carrier lessons shared across practices, product improvement) is outside the agent definition.
- Contrary reading: CollectRx is a non-agent electronic service provider, which carries narrower duties and a similar bar on own-purpose use.
- Both readings agree on one point: own-purpose use of identifiable content is not permitted. So the control that holds under either: practice-scoped agent permission, purpose limit, learning off by default.
- Risk accepted by proceeding: PHIPA offences up to $200,000 and 1 year for an individual, up to $1,000,000 for an organization (s. 72, VERIFIED); administrative penalty cap $500,000 for an organization (O. Reg. 329/04). Exposure sits with the custodian first, then CollectRx as agent.
- Unread: IPC decisions on agents and vendors.
- Decision: ______ (sign / change)  Date: ______  Re-read by: ______

## R2. Consent for disclosure to the insurer

- Text read (VERIFIED): s. 18(3)(a) disclosure to a non-custodian requires express consent (not implied); s. 18(5) consent must be knowledgeable (purposes known, may give or withhold). s. 38(1)(b) payment permission covers disclosure to the Minister, another custodian or the Agency, which does not include a private insurer. s. 37(1)(i) permits USE for obtaining payment or processing claims.
- Adopted reading: each practice must hold the patient's express consent for communications with the insurer. A signed claim form usually carries it; the practice, not CollectRx, collects it.
- Contrary reading: consent already on the insurer's claim form covers all follow-up. This is plausible and probably common, but it depends on the form's wording, which CollectRx never sees.
- Default control: practice attests at onboarding that its consent covers insurer communications and AI-assisted calling; attestation versioned and audited; no attestation, no dispatch.
- Risk accepted: a practice that attests without having consent carries the primary exposure; CollectRx carries exposure as the party that made the call.
- Decision: ______  Date: ______

## R3. Out-of-Ontario processing

- Text read (VERIFIED): s. 50(1)(a) disclosure outside Ontario with consent; s. 50(1)(f) permitted where "reasonably necessary for the administration of payments in connection with the provision of health care ... or for contractual or legal requirements in that connection."
- Adopted reading: sending identifiers to US-processed voice and model vendors for the purpose of a payment follow-up fits s. 50(1)(f) at least arguably, because the call is for payment administration.
- Contrary reading: sub-processor hosting is a separate disclosure that needs consent under s. 50(1)(a).
- Default control: record each vendor's region; disclose US processing in the practice-facing notice; do not claim Canadian residency anywhere.
- Unread: every vendor page (Vapi, Anthropic, ElevenLabs, Deepgram, Google, Twilio, Fly); needed to state regions as fact.
- Risk accepted: moderate; turns on a reading of "reasonably necessary" that has not been tested in anything I read.
- Decision: ______

## R4. Sub-processors in the agent chain

- Text read: PHIPA s. 17 does not address sub-agents expressly in the text read (HP report). Vendor agreements are blank in the repo.
- Adopted reading: CollectRx remains responsible for its vendors' handling because it chose them and passed them the data; flow-down terms are required to show reasonable safeguards (s. 12(1)).
- Default control: sub-processor register, request each vendor's DPA, record answers; send the free Vapi written questions.
- Risk accepted: vendors without a signed agreement or confirmed no-training and retention terms hold identifiers. With nothing live this is a future risk, not a present one.
- Decision: ______

## R5. Cross-tenant learning

- Text read: agent definition above; s. 11.2 bars re-identification of de-identified data; s. 4(2) identifying information includes information from which an individual could reasonably be identified alone or with other information (VERIFIED per HP).
- Adopted reading: learning from practice call content is a CollectRx purpose, outside the agent definition, unless the content is de-identified.
- Default control: contribution and consumption flags off; identifier scan on lesson text; shared knowledge only about carrier behavior, never case content.
- Risk accepted: if the scan misses an identifier, the lesson is a disclosure of PHI beyond the agent's purpose.
- Decision: ______

## R6. Recording and transcription (Criminal Code)

- Text read (VERIFIED, Justice Laws): s. 183 "intercept" includes to listen to, record or acquire a communication or its substance. s. 184(1) offence to intercept a private communication by device. s. 184(2)(a) no offence where the interceptor has the express or implied consent of the originator or the intended recipient. s. 183.1 where a communication is originated by or intended for more than one person, the consent of any one of them is sufficient.
- Adopted reading: in autonomous mode the practice, acting through CollectRx, originates the call and is a party, so its consent is sufficient. In human-assisted mode practice staff are a party to the conversation with the carrier rep; a one-party consent reading covers Claims_Scribe's transcription. The carrier rep is not a consenting party but one-party consent is enough under the text.
- Separate issue, not criminal: notice to the rep as a privacy practice under PIPEDA principles 4.2 and 4.3. Those principles were not read as primary text in the telecom file.
- Default control: make the notice statement true (transcription, not recording); notice in human-assisted mode at or before handoff.
- Risk accepted: low on the criminal reading; unknown on the privacy-notice reading.
- This is the best-supported row in the register; the statute text is plain.
- Decision: ______

## R7. Retention periods

- Text read: PHIPA sets no fixed retention period; s. 13 requires secure retention, transfer and disposal as prescribed. PIPEDA Schedule 1 cl. 4.5 requires retention schedules and destruction. Quebec requires retention for one year after use in a decision and destruction when no longer needed. BC PIPA s. 35 is similar (all VERIFIED per PS).
- Adopted reading: choose and document a period per data type; the repo's 12 month default is a placeholder.
- Unread: college record-keeping standards (for example dental records), which may set a longer minimum. Until read, do not purge anything.
- Default control: purge stays off; dry-run report; periods in config.
- Decision: ______

## R8. Is a call to an insurer a "collection" activity (CDSA)?

- Text read (VERIFIED): CDSA s. 1(1) definition of collection agency; Reg. 74 s. 19.7: the Act does not apply to collecting a debt from a person other than an individual, including an individual who owns a sole proprietorship, is a partner, or has given a personal guarantee. s. 24: no person shall knowingly use an unregistered agency.
- Adopted reading: calls to an incorporated insurer about a client's receivable fall outside the Act on the text. Calls to individuals do not.
- Contrary reading: the real debtor is the patient; a regulator could look through to substance (s. 2.1).
- Default control: debtor-kind gate; no patient contact.
- Decision: ______

## R9. Adjuster licensing and the motor/SABS negotiation ban

- Text read (VERIFIED): Insurance Act s. 1(1) "adjuster"; s. 397 offence for acting as an adjuster without a licence; s. 398 bans negotiating or attempting to negotiate for compensation a settlement of a motor vehicle claim on behalf of a claimant, including SABS claims; lawyers excepted.
- Adopted reading: status and date inquiries are not negotiating or adjusting; arguing coverage, disputing a decision or proposing an amount would be.
- Contrary reading: any follow-up on a SABS invoice "for compensation" is within s. 398.
- Default control: scope limit in prompts and tool schemas; transcript lint; flat fees, never a percentage of an insurer payment on SABS invoices.
- Unread: FSRA guidance; this is the row where the unread source matters most.
- Decision: ______

## R10. CRTC rules

- Nothing read from CRTC primary sources (all blocked). Cowork batch 1 reads them. Until then no position is adopted. Defaults: identification with address and callback number, hangup timing measurement, recipient-local hours, no voicemail messages.
- Decision: deferred until batch 1 returns.

---

## Founder risk-acceptance log

| Date | Row | Reading adopted | Risk accepted | Signed |
|---|---|---|---|---|
| | | | | |
