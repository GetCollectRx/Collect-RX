# CollectRx Pilot PRD, Work Split and Closeout

Date: 2026-11-17. Owner: Khalid Egeh. Builds on the Client Day-One Journey audit at commit 851439f.

## Goal and scope

The goal is a product one dental practice can use end to end with one carrier, supervised by Khalid, with no engineer touching anything during normal use. This PRD covers only what blocks that first pilot.

In scope:

- Hold Sentinel Step 1 only, at $399 per location per month
- Browser app with manual CSV upload of PMS exports (CSV onboarding is already a supported path per CLAUDE.md, so the pilot needs no desktop app)
- Agreements and consent, handoff to staff, test call, fast pause, support, and a written pilot KPI

Out of scope for the pilot:

- Folder-watch ingest, signed installers, and multi-factor login
- Other industries, the claims scribe, and autonomous calling
- Any contact with patients (CollectRx never contacts patients)

Standing constraints:

- No calls to real carriers and no real patient data until a pilot practice with real claims is live
- Claim-status follow-up only, in Ontario first
- Legal items are research notes for Khalid's review, not legal advice

## Work split

The engineering account owns all product code. The growth and business account owns text, copy, plans and research, and writes no product code. Khalid owns every decision and approval.

| Who | Work | Output |
| --- | --- | --- |
| Engineering account | Live walkthrough of the client journey on staging, before building | List of what works and what fails, with evidence |
| Engineering account | R1 agreements record, R3 handoff, R4 outcome entry, R5 test call, R6 pause controls, R7 support link, R8 $399 plan, R10 site changes | Code, tests, and a rerun audit at the new commit |
| Growth account | R2 consent and legal text drafts (research notes), R7 support text and response-time wording, R9 pilot KPI draft, R10 site copy, R11 onboarding guide | Markdown files for Khalid to approve, then handed to engineering |
| Growth account | Pilot offer one-pager, owner interview guide, five-client list from NotebookLM, industry studies in the background | Documents and lists, with no outreach sent without Khalid's go-ahead |
| Khalid | Handoff alert channel, pilot carrier, legal review route, approval of the $399 plan, approval of all text, finding the pilot practice | Written decisions recorded in the repo |

## PRD: requirements

| ID | Requirement | Acceptance criteria | Owner | Size |
| --- | --- | --- | --- | --- |
| R0 | Live walkthrough on staging | A fake practice signs up, uploads a CSV, places a test call and takes the handoff; every failure is logged | Engineering, with Khalid | 1 to 2 days |
| R1 | Agreements record (B3) | Signup is blocked until the practice accepts versioned terms, privacy and data agreement, and call-listening consent; each acceptance stores user, time and version | Engineering | 4 to 6 days |
| R2 | Legal and consent text (A5) | Published pages include a plain call-listening explanation; consent rules are checked against official sources; Khalid has approved the wording | Growth drafts, Khalid approves | Calendar time |
| R3 | Handoff to staff (D5, C5) | The alert reaches the chosen staff recipients, the live rep is transferred, and the no-answer fallback works, shown end to end | Engineering | 5 to 7 days |
| R4 | Staff outcome entry (D6) | Staff can record a call result that updates the claim status and next follow-up date | Engineering | within R3 |
| R5 | Safe test call (C6) | A test run from setup proves the phone line, the alert and the handoff before any real claim | Engineering | 3 to 4 days |
| R6 | Pause controls (G3) | Pause works per practice, per carrier and system-wide within minutes; the broken feature-flag route is fixed | Engineering | 2 to 3 days |
| R7 | Support (F1) | A monitored support email and an in-app link exist, with a stated response time | Engineering links, Growth writes text | about 1 day |
| R8 | Hold Sentinel $399 plan (A4, E3) | The plan exists in code (ADR 0004). Create the $399 Stripe price, set STRIPE_PRICE_SENTINEL, and confirm a practice can buy it from signup and that the pricing page shows it | Engineering | small |
| R9 | Pilot KPI (E2) | A written KPI is signed by Khalid before the pilot starts; manual tracking is acceptable | Growth drafts, Khalid signs | manual |
| R10 | Site fixes (A1, A2) | Unsourced savings figures are removed; one clear sentence explains the offer; no claim is made without a source | Growth copy, Engineering deploys | small |
| R11 | Onboarding guide (B5) | A one-page guide covers setup, upload and taking a handoff | Growth | small |

## Closeout list

The product is pilot-ready only when every item is ticked, with evidence recorded next to it.

- [ ] Live walkthrough on staging ran end to end and every failure was fixed or logged
- [ ] R0 to R11 are each accepted against their criteria
- [ ] The audit was rerun at the new commit, and every BLOCKS PILOT row shows Exists with a file or route as evidence
- [ ] No unsourced figures remain on collectrx.ca
- [ ] Consent and legal text is published and Khalid has approved it
- [ ] The test call passes for the phone line, the alert and the handoff
- [ ] A pause drill worked for one practice, one carrier and the whole system, each within minutes
- [ ] The pilot practice, carrier and KPI are recorded in writing
- [ ] The $399 plan can be bought from signup to first invoice
- [ ] The handoff document and CLAUDE.md in the repo are updated
- [ ] Decisions are written into the repo, including the handoff channel and the ADR 0003 outcome
- [ ] The wave 2 backlog is filed and tracked: data export and deletion, folder-watch, signed installers, multi-factor login, baseline snapshot

## Decisions and handoff between accounts

| Decision | Blocks | Note |
| --- | --- | --- |
| Handoff alert channel: email, Slack, in-app or SMS | R3 | ADR 0003 says no SMS goes to the practice, so choosing SMS reverses it. For a pilot Khalid supervises himself, email or Slack may be enough |
| Pilot carrier | R3, R5 | Choose the carrier with the most calls at the pilot practice |
| Legal review route | R2 | No counsel is involved, so Khalid reviews drafts and checks consent rules against official sources |
| Approve the $399 plan | R8 | Confirm it appears alongside the three higher tiers |
| Pilot KPI | R9 | Must be written and signed before the pilot starts |

How the two accounts hand off:

- Git is the source of truth. Growth deliverables are markdown files committed under docs/pilot/growth/. Progress is recorded in docs/operations/PATH-TO-DELIVERY.md, the repo's single live tracker. Do not create a second status file.
- Engineering reports each requirement back with a file or route as evidence, and reruns the audit after each wave.
- The growth account writes no product code and sends nothing to real prospects, carriers or patients without Khalid's go-ahead.
- After each requirement closes, both accounts update the handoff document in the repo.
