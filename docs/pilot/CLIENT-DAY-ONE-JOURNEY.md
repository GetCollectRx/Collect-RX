# CollectRx Client Day-One Journey (audit spec)

Date: 2026-11-17

## Purpose

CollectRx is launch-ready when a practice manager can go from signup to a completed carrier call without Khalid or an engineer touching anything. Today the engine runs, but there is no client-facing product around it, so this doc defines "ready" from the client's side.

## Task for the engineering Claude

Audit every row below against the code at HEAD. For each row, set Status to Exists, Partial or Missing, with one line of evidence (file or route). Do not build anything.

Decisions already made (hold these fixed):

- Client app is an Electron desktop app.
- The product is PMS-agnostic. The app watches a folder for exported claims reports. No direct PMS database access. Flag any row that assumes direct PMS access (for example a SQL connector) as Missing for the folder-watch path.
- Pricing tiers are current: Core $799, Growth $1,999, Scale $2,499 per month.

Return: the count per status, the five biggest gaps for a supervised pilot with one practice and one carrier, and a rough size in days for each.

## Lifecycle phases

A. Find and decide. B. Sign up and get the app. C. Set up the practice. D. Run it every week. E. See value and pay. F. Support, change and leave. G. Operate the service (operator tools, not seen by the client).

## A. Find and decide

| # | Step | The client must be able to | Status |
| --- | --- | --- | --- |
| A1 | Understand the offer | Read one clear sentence on the public site: skip the hold time on insurance calls, for aged and denied claims | To verify |
| A2 | See proof | Watch a short demo or see a sample dashboard; real pilot numbers replace it once they exist | To verify |
| A3 | Check fit | See which carriers, PMS systems, export formats and provinces are supported | To verify |
| A4 | See the price | Find pricing or a clear way to get a quote | To verify |
| A5 | Run trust checks | Read a privacy policy, a security summary, where data is stored, and what call listening means | To verify |
| A6 | Take the first step | Click Start or Book a call and either reach signup or get a human reply within a day | To verify |

## B. Sign up and get the app

| # | Step | The client must be able to | Status |
| --- | --- | --- | --- |
| B1 | Create an account | Sign up with email and password or single sign-on, verify the email, reset a forgotten password, and use multi-factor login if you decide to require it | To verify |
| B2 | Create the practice | Enter practice name, address, province and a billing contact, which becomes their separate tenant | To verify |
| B3 | Accept agreements | Agree to the terms of service, the privacy and data agreement, and the call-listening consent, with a signed record kept | To verify |
| B4 | Get the app | Decided: a desktop app, because it must run code on the practice's computer. A download page with Mac and Windows installers, system requirements, and installers signed so the operating system does not warn | To verify |
| B5 | Get IT approval | Let a practice's office manager or IT person install it: admin rights, firewall rules, and a one-page install guide | To verify |
| B6 | Launch the app | Sign in, reach the backend, and see an empty-state checklist that says what to do next | To verify |
| B7 | Stay up to date | Receive fixes automatically, see the version number, and never be asked to reinstall by hand | To verify |

## C. Set up the practice

| # | Step | The client must be able to | Status |
| --- | --- | --- | --- |
| C1 | Fill in the practice profile | Confirm details, hours and time zone so calls run inside carrier hours | To verify |
| C2 | Choose the phone line | Choose whether calls appear from the practice's own number or a CollectRx number, and prove they own the number | To verify |
| C3 | Pick carriers | Select the carriers they bill and enter the provider or office IDs each carrier needs | To verify |
| C4 | Match the PMS export | Choose their PMS, pick the folder the app will watch for exported reports, see the expected report layout, and preview the claims it found before anything is uploaded | To verify |
| C5 | Add staff | Invite staff, assign roles, and choose who gets handoff alerts and on which phone numbers | To verify |
| C6 | Run a test call | Run a safe test that proves the line, the alert and the handoff all work before real claims | To verify |

## D. Run it every week

| # | Step | The client must be able to | Status |
| --- | --- | --- | --- |
| D1 | Submit work | Save the PMS export into the watched folder, have the app pick it up and ingest it, read plain-language errors, and see how many claims were accepted | To verify |
| D2 | Review the queue | See queued claims split into aged and denied, and pause, unpause or remove any claim | To verify |
| D3 | Start calls | Launch a batch now or schedule it inside carrier hours | To verify |
| D4 | Watch progress | See each call's state: dialing, IVR, on hold, rep on line | To verify |
| D5 | Take the handoff | Get an alert when a rep picks up, be connected to the call, and know what happens if nobody answers | To verify |
| D6 | Record the outcome | Log the result and notes so the claim's status and next follow-up date update | To verify |
| D7 | Handle exceptions | See failed calls and escalations and resolve them without engineering help | To verify |
| D8 | Get a summary | Receive a daily or weekly email of what happened and what needs attention | To verify |

## E. See value and pay

| # | Step | The client must be able to | Status |
| --- | --- | --- | --- |
| E1 | See results | View hold minutes saved, calls completed, claims touched and aged AR against a baseline snapshot | To verify |
| E2 | Track the agreed KPI | See progress against the pilot KPI that was agreed in writing before the pilot began | To verify |
| E3 | Understand fees and pay | See the fee terms and tiers, add a payment method, and receive invoices and receipts | To verify |
| E4 | Export reports | Download CSV or PDF reports for the owner or the accountant | To verify |

## F. Support, change and leave

| # | Step | The client must be able to | Status |
| --- | --- | --- | --- |
| F1 | Get help | Reach support by email or chat, know the response time, and report a problem from inside the app | To verify |
| F2 | Know the status | Be told when a carrier change or an outage affects calls | To verify |
| F3 | Manage the account | Add or remove staff, change the phone line, update billing, and reset passwords | To verify |
| F4 | Pause or cancel | Pause or cancel the service themselves, with notice terms stated up front | To verify |
| F5 | Leave cleanly | Export their data, request deletion, and have calls stop and access revoked on a stated schedule | To verify |

## G. Operate the service

| # | Step | You must be able to | Status |
| --- | --- | --- | --- |
| G1 | Onboard a practice | Approve a new practice, verify phone ownership and signed agreements, and confirm no practice data is hardcoded | To verify |
| G2 | Monitor calls | See call health across all practices, including failures and stuck calls | To verify |
| G3 | Intervene fast | Pause one practice, one carrier or the whole system within minutes | To verify |
| G4 | Keep up with carriers | Update IVR navigation when a carrier changes its phone menu | To verify |
| G5 | Run billing | Track fees owed, issue invoices and record payments | To verify |
| G6 | Support safely | Look up a practice's state and see who accessed what, with an audit trail | To verify |

## What must hold across every phase

| Area | What must be true | Status |
| --- | --- | --- |
| Security | Each practice sees only its own data, logins are protected, secrets are not in code, and access is logged | To verify |
| Privacy and compliance | Call-consent rules are confirmed against official sources, the app only reads a claims-only report layout and uploads the minimum fields needed, retention is defined, and an incident plan exists | To verify |
| Reliability | Calls retry or fail safely, a call is never left hanging with a carrier, and alerts reach you when something breaks | To verify |
| Legal documents | Terms of service, privacy policy and consent text exist, are reviewed by you, and are versioned | To verify |

## Minimum pilot slice

The first pilot needs B1 to B4, B6, C1 to C3, C5, C6, D1, D3 to D6, G1 and G3, run for one practice and one carrier, with a human fallback. B3 and F1 must be in place before any real call. Everything else can start as a manual or simple version.

- One carrier first. Pick the carrier with the most calls at the pilot practice and make that path reliable before adding the other five.
- Supervised by a person. Khalid or a staff member watches live and takes over on any failure, so a failed call never reaches a carrier unattended.
- Hold Sentinel Step 1 only. The claims scribe and autonomy work stay out of the pilot.
- Success is defined up front. Agree the KPI in writing before the pilot starts, for example average staff hold minutes saved per week.

## Open questions

- Decide which carrier the pilot starts with.
- Define one PMS-neutral claims report layout (the fields the app needs), then map the most common PMS exports to it.
- Decide how the handoff alert reaches staff (SMS, in-app, phone bridge).
- Confirm call-consent requirements for listening to carrier calls against official sources.
- Identify the next pilot practice, now that the first one has dropped out.
