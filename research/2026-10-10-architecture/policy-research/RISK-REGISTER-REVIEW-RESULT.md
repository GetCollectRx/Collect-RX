# Risk register review: result and verification

Date: 2026-10-13. Subject: the external reviewer's response to RISK-REGISTER-REVIEW-PROMPT.md (a browsing model; identity not recorded). I checked its cited provisions against ontario.ca/laws page text fetched on 2026-10-13 (VERIFIED below means I read it). Where I could not read a source, I say so. This is a founder decision aid, not a legal opinion.

The reviewer tagged nearly every statement VERIFIED. That tag cannot be relied on: several of its quotations and section numbers do not exist in the statute. Its reasoning is still useful where the text supports it.

## 1. Citation audit

| Reviewer claim | What the statute says (VERIFIED) | Verdict |
|---|---|---|
| PHIPA s. 15(1) is a duty to keep a record of processing and uses | s. 15(1): a custodian that is a natural person may designate a contact person | Wrong |
| PHIPA s. 29 is the express-consent rule for non-custodians | s. 29: custodian shall not collect, use or disclose PHI unless it has consent under the Act and the act is necessary for a lawful purpose, or the Act permits it. The express-consent rule for non-custodians is s. 18(3) | Mischaracterized |
| PHIPA s. 11.1 sets de-identification requirements | s. 11.1: custodian shall take reasonable steps to ensure PHI is not collected without authority. Limits on using de-identified information are s. 11.2 | Wrong |
| s. 72(1)(a) quoted as "No person shall collect, use or disclose PHI in contravention of this Act" | s. 72(1)(a): a person is guilty of an offence if the person "wilfully collects, uses or discloses personal health information in contravention of this Act or its regulations" | Misquoted; omits "wilfully" |
| s. 72(1)(b) quoted as "No person shall require or authorize another person to do anything that contravenes this Act" | s. 72(1)(b): makes a request for access or correction under false pretences. No such text | Fabricated |
| Fines up to $200,000 (individual) and $1,000,000 | s. 72(2): natural person up to $200,000 or imprisonment up to 1 year, or both; not a natural person up to $1,000,000 | Correct amounts (real basis for founder exposure is s. 72(3), below) |
| O. Reg. 329/04 s. 6(1)(c) covers agreements with subcontractors | s. 6(1) has numbered paragraphs 1 to 3 only; paragraph 3 covers employees and persons acting on the provider's behalf agreeing to comply. No paragraph (c) | Wrong |
| Non-agent ESP status brings mandatory breach notification under s. 6(1) | Breach notification to custodians is s. 6(3) paragraph 1, and applies only to a "health information network provider" (a provider serving two or more custodians primarily to let them disclose PHI to each other) | Wrong |
| Insurance Act s. 385 is the adjuster licensing requirement | s. 385: Repealed 1999. Adjuster licence is s. 397 | Wrong |
| Insurance Act s. 398(2) carries a fine of up to $200,000 | s. 398(2) is the exception for a barrister or solicitor. s. 398 has no penalty clause of its own | Fabricated |
| Insurance Act penalties | s. 397(7): acting as an adjuster without a licence is an offence. s. 447(3): first conviction fine up to $250,000, subsequent up to $500,000. s. 447(4): directors and officers who caused, authorized, permitted or participated, or failed to take reasonable care, up to $100,000 first and $200,000 subsequent | Reviewer's figure wrong; real figures higher |
| CDSA s. 28(1) quoted with $50,000 or "1 year" and $250,000 for a corporation | Offences are in s. 28(1); penalties are s. 28(2.2): individual up to $50,000 or imprisonment up to two years less a day, or both; corporation up to $250,000. s. 28(2): an officer or director who knowingly concurs is guilty | Section wrong, term wrong (1 year vs two years less a day), quote not verbatim |
| Reg. 74 s. 13 is prohibited collection practices | Reg. 74 heading "Prohibited Practices and Methods in the Collection of Debts" is at ss. 21 onward per my earlier read; s. 13 not confirmed | Unconfirmed, likely wrong |
| Quebec penalties at "s. 17 and 103" | Earlier research read the 2021 Act: penalties are s. 91 ($25M or 4% of worldwide turnover). Reviewer said it could not open Quebec text | Unreliable |
| Telecommunications Act s. 72.01 AMP figures; ADAD in "Part III" | Not read. Our own earlier excerpt places ADAD rules in Part IV | UNVERIFIED either way |
| RCDSO requires 10 year dental record retention | Not read | UNVERIFIED |
| R. v. Duarte on one-party consent | A real Supreme Court of Canada decision on participant surveillance; I did not read it here | Plausible; not verified |

PHIPA s. 50(1)(f), s. 18, s. 2 "agent", s. 17, s. 11.2, s. 4(2), s. 13, Criminal Code ss. 183, 183.1, 184 and Reg. 74 s. 19.7 were not contradicted.

Real founder exposure under PHIPA, which the reviewer never cited: s. 72(3): if a corporation commits an offence, every officer, member, employee or other agent who authorized the offence, or who had the authority to prevent it and knowingly refrained, is a party to the offence and liable to the same penalty, whether or not the corporation is prosecuted. s. 72(5): prosecution needs the Attorney General's consent. s. 72(8): no limitation period under the Provincial Offences Act. The offences in s. 72(1)(a) require wilfulness; good-faith controls matter.

## 2. Row dispositions (my recommendation; Khalid signs)

| Row | Reviewer | My disposition | Reason |
|---|---|---|---|
| R1 | Partly; sign with changes (agent agreement; no cross-practice training) | ACCEPT in substance | A written agent agreement per practice is already a planned control. The stricter learning default is textually supported: using call content for CollectRx's own purposes is outside the agent definition |
| R2 | Agree; sign with changes (indemnity; proof of consent forms on file) | MODIFY | Add a warranty and indemnity to the attestation terms. Reject collecting proof of each patient's consent: it creates new PHI holdings and conflicts with minimum necessary (s. 30). Practice attestation also evidences good faith, which matters because s. 72(1)(a) requires wilfulness |
| R3 | Disagree; says s. 50(1)(f) covers only payors | KEEP the register reading, add a fallback | s. 50(1)(f) text has no limit on who receives the disclosure: "reasonably necessary for the administration of payments in connection with the provision of health care ... or for contractual or legal requirements in that connection." The reviewer's narrowing is not in the text and its claim that the Information and Privacy Commissioner consistently takes the stricter view is unsupported. The risk is still real: whether sending identifiers to a US-hosted vendor is "reasonably necessary" is untested in anything I read. Add the consent route (s. 50(1)(a)) and minimization as fallback |
| R4 | Agree; sign with changes (binding DPAs before routing data) | ACCEPT as a go-live condition | Nothing is live; DPAs must exist before real PHI flows. Replace the reviewer's citations with s. 12(1), s. 17 and O. Reg. 329/04 s. 6(1) para 3 |
| R5 | Agree; sign with changes (no training on PHI) | ACCEPT, with a sharper default | For health tenants, lessons come only from structured non-PHI signals (IVR tree structure, durations, outcome codes), not from transcript text. De-identification remains possible under s. 11.2 but is not the default |
| R6 | Agree; add start-of-call automated disclosure | ACCEPT | Criminal Code reading stands. The notice is a privacy practice, not a criminal requirement; PIPEDA 4.3 text was not read |
| R7 | Agree; 24 hour purge of audio and ephemeral variables | MODIFY | Reject a blanket 24 hour purge of vault data: a claim can need up to three attempts over days, and later attempts need the identifiers. Accept deleting vendor-side artifacts after each call. College record standards remain unread; keep purge off until read |
| R8 | Agree; sign as written | ACCEPT; update penalty citation | s. 28(2.2) and officer/director liability under s. 28(2) |
| R9 | Agree; sign with changes (status only; terminate on dispute) | ACCEPT the control; fix citations | s. 397(7), s. 447(3) and (4). FSRA guidance still unread |
| R10 | Disagree with deferring; blocked | KEEP blocked | The reviewer's substantive claims about CRTC rules were not read and conflict with our earlier excerpt |

## 3. Cross-cutting

- X1 missing rows: CASL for the company's own marketing is a real gap (I had already flagged it). The consumer-protection AI-disclosure claim is unsupported and probably inapplicable to calls between businesses. Carrier representative privacy (PIPEDA 4.3) and acknowledgment of debt (Limitations Act s. 13) were already in my gap list. The Quebec citations are unreliable.
- X2 tool or agent: the reviewer's conclusion is wrong on the point that matters. O. Reg. 329/04 s. 6(1) para 2 says a non-agent service provider "shall not disclose any personal health information to which it has access." The product exists to disclose identifiers to insurers on the custodian's instruction. That is authorized only through agent status under s. 17. So the "tool" framing, which pushes CollectRx toward non-agent status, increases legal friction, not reduces it. Agent status is the position to hold. On the adjuster rule, s. 398 turns on whether the activity is negotiating for compensation, not on who speaks; staff on the line reduce hallucination risk but do not change what the tenant is doing. On the collection rule the debtor kind decides. On recording, staff on the line are a party, so single-party consent holds in both modes.
- X3 sign-off order: reasonable; it omits R3 and R7, which gate any live data.
- X5 residual risk: starting in human-assisted mode is consistent with the existing V1 design. The reviewer's "ZDR flags" are not free toggles: reported Vapi ZDR is a paid add-on [L1 2026-10-13: CONTRADICTED; Vapi docs say ZDR "does not require a separate purchase", see CORRECTIONS.md A4], ElevenLabs zero retention is reported as enterprise only, and Anthropic zero retention is by agreement (all unverified).

## 4. The unrequested closing section

After the formal response the reviewer wrote a conversational block apologizing and proposing solutions. It ignores the requested format. Its proposals, assessed:

- Synthetic tokenization proxy: not workable as described. A carrier rep needs the real name, date of birth and policy number to find the claim; a synthetic token cannot be spoken to them. The platform already uses UUID tokens in call metadata and detokenizes server-side. The real lever is speaking identifiers only when the rep asks and not loading identifiers an agent does not need (planned in the privacy fix prompt, workstream W5).
- "Turn on ZDR toggles across all four vendors": see X5. Not free toggles.
- Cold email with opt-out links is compliant: CASL generally requires consent, express or implied, for commercial electronic messages, plus identification and an unsubscribe mechanism. An opt-out footer alone does not satisfy it. From general knowledge, not read here; the CASL text needs a primary read.
- Move marketing to inbound AI demos only: sensible, and consistent with avoiding outbound automated calls until the CRTC rules are read.
- Lead with human-assisted mode: consistent with the existing design.

## 5. Changes made to the plan

1. Register updated: penalty citations (R1, R8, R9) and the reviewer outcome noted per row.
2. Fix prompt: W3 now defaults to structured non-PHI signals for health tenants; W2 adds a warranty and indemnity to the attestation terms (wording PENDING_COUNSEL stays a config value).
3. Cowork prompt: add CASL (Canada's Anti-Spam Legislation, S.C. 2010, c. 23, s. 6 and consent definitions) and the RCDSO records standard to the read list (RCDSO is already in batch 3).
