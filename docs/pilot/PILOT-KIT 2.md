# Pilot Kit — offer, outreach, and call-day runbook

Everything needed to land and run the first pilot practice. Product state backing every claim here: see `docs/operations/BUILD-HANDOFF.md` §2.

---

## 1. The pilot offer (one-pager content)

**Headline:** Your front desk spends hours on hold with Sun Life and Manulife. Ours doesn't mind.

**What CollectRx does:** An AI calling system that phones insurance carriers about your outstanding claims — navigates the phone menus, waits on hold, gets claim status and denial reasons from the rep, and turns every call into a next action: payment date confirmed, documents needed by a deadline, appeal window captured, or escalated to your staff with a reference number and rep name.

**The pilot deal:**
- Free for [60] days, up to 500 calling minutes. No card required.
- Supervised: the first calls run with a CollectRx operator observing live; you get a written summary of every call.
- Your data in via a simple CSV export from your PMS (15 minutes to onboard; no software install required).
- You keep everything we recover and every report. Cancel anytime; your data is exported and deleted.

**What we ask in return:** honest feedback, and permission to use anonymized recovery numbers ("a 2-dentist Ontario practice recovered $X in 30 days") in our materials.

**What it is not:** not a collection agency, no patient contact ever, no changes to your PMS. Calls carriers only, Mon–Fri 8–5 ET, identifies itself as an automated caller on behalf of your practice (CRTC compliant).

**Coverage:** Sun Life, Canada Life, Manulife, Green Shield, RBC, TELUS AdjudiCare (~78% of Canadian private dental) + CDCP pre-visit checks.

---

## 2. Outreach sequence (email; adapt for call scripts)

**Audience:** practice owner or office manager, practices with 1–3 dentists. The in-app prospect board (`/admin/partnerships`) is DNCL-checked — use it as the source list.

**Email 1 — the problem (day 0)**
Subject: How many hours did [Practice] spend on hold with insurers last week?
Body: Two paragraphs. (1) Every outstanding claim past 30 days means a staff member on hold ~20–40 min to learn its status; most offices simply don't have the hours, so claims age into write-offs. (2) We built software that makes those calls automatically and hands your team the outcome — status, denial code, deadline, reference number. We're choosing one [city] practice for a free supervised pilot. 15-minute call this week?

**Email 2 — the proof mechanics (day 4, no reply)**
Subject: What an automated carrier call actually captures
Body: One real (anonymized/simulated) call summary as a bullet list — processed date, amount vs expected flagged short, remark code, patient-payable vs appealable, reference, rep name. One line: "Every outstanding claim, called automatically, summarized like this. Free pilot, no card, cancel anytime."

**Email 3 — the direct close (day 9, no reply)**
Subject: Last note — free claims-recovery pilot
Body: Three sentences. We're offering one practice a free 60-day supervised pilot of automated insurance follow-up. Onboarding is a 15-minute CSV import. If it's not [Practice], no hard feelings — reply "not now" and I'll stop emailing.

*(CASL note: B2B email to published business addresses relating to their business functions; keep the unsubscribe line, honor immediately.)*

---

## 3. Supervised call-day runbook

**Before day 1**
1. Practice signs pilot agreement (Terms draft + pilot exception memo must be counsel-cleared first — `docs/legal/`).
2. CSV import at `/import`; verify claims appear with correct carriers and amounts; fix data gaps flagged by the completeness checker.
3. Confirm practice settings: voice agent enabled, carriers authorized (provider number + billing phone per carrier), escalation contact set.
4. Verify plan state: pilot practice on trial (500 min) — enough for ~15–25 carrier calls.

**Day 1 (operator supervising)**
1. Queue only 2–3 claims (highest dollar, 30–90 days old, one carrier you can hear well).
2. For each live call, operator watches the live console; be ready to note anything odd. Do NOT intervene mid-call unless a safety rule is breached.
3. After each call, review with the office manager: transcript summary, structured outcome, next action created. Ask: "Would your team trust this? What's missing?"
4. Hard stop conditions: any carrier-block signal → calls to that carrier auto-suspend (CARRIER_BLOCK) — do not resume same-day; any misidentified patient/claim → pause pilot, file issue.

**Days 2–10**
- Ramp to full queue if day 1 was clean. Daily cap keeps burn ≤50 min/day.
- Operator reviews every escalation and validation failure (`validationPassed=false` call attempts) each evening.

**Metrics to log (the numbers that become the sales deck)**
| Metric | Definition |
|---|---|
| Connect rate | calls reaching a human rep / calls placed |
| Status-obtained rate | calls ending with a concrete status + reference / connected calls |
| Actionability | outcomes with a next action (date, code, deadline, resubmission route) / statuses obtained |
| Carrier-block incidents | target: zero |
| Dollars moved | claims paid or scheduled after a CollectRx call, $ |
| Staff minutes saved | connected-call minutes × 1 (a human would have waited the same holds) |

**Exit criteria for the pilot (decide before starting):** ≥[70]% status-obtained rate, zero carrier blocks, office manager would recommend it — then convert to Core and write the case study.
