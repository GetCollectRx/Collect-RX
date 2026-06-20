# CollectRx Client Acquisition Agent

**Purpose:** Build and work the pipeline of dental practices that should be using CollectRx. Identify high-value prospects, sequence outreach, track conversations, optimize the pitch based on what's working, and get practices from "never heard of you" to "billing agent authorization letter signed." Run weekly.

---

## Target Customer Profile

### Ideal Customer Profile (ICP)

| Attribute | ICP | Why |
|---|---|---|
| Practice type | 2-4 chair, 1-2 dentist office | Enough volume to have real AR problems; small enough to feel the admin pain personally |
| Billing model | Bills private insurance (not OHIP-only) | Must use one of the 6 carriers |
| Current AR aging | >$15,000 outstanding 30+ days | Meaningful ROI possible |
| Staff | 1-2 admin staff handling insurance | They are the people who feel the pain |
| Geography | Ontario first (PHIPA jurisdiction established), then BC, Alberta | |
| PMS | Any — CSV is the onboarding path; AbelDent is a bonus | |

### Tier Targeting

| Prospect Type | Target Tier | Expected MRR |
|---|---|---|
| Solo dentist, 1 location | Core ($599) | $599 |
| 2-dentist practice | Growth ($1,299) | $1,299 |
| 3+ dentist / group | Scale ($1,499) | $1,499 |
| DSO (multi-location) | Scale × locations | $1,499+ |

DSOs are the highest-leverage target: one conversation, multiple locations, recurring multi-tier revenue.

---

## Prospect Identification

### Sources to Mine

- [ ] **ODA member directory** — Ontario Dental Association lists member practices. Check for practices in medium-sized cities (not downtown Toronto, where admin staff is easier to hire).
- [ ] **Google Maps "dental office" + Ontario cities** — Systematically work through: Hamilton, London, Kitchener-Waterloo, Ottawa, Barrie, Sudbury, Windsor. These markets have practices that feel admin pain more acutely.
- [ ] **LinkedIn dental practice owners and office managers** — Search "dental office manager Ontario", "practice administrator Ontario dental". These are the actual decision-makers.
- [ ] **Dental billing forums and Facebook groups** — "Canadian Dental Billing" groups. These people are talking about the exact problem CollectRx solves.
- [ ] **Referrals from AbelDent users** — Even if Dr. Hasan is unresponsive, other AbelDent users exist. Search for "AbelDent" in dental admin communities.
- [ ] **Dental practice brokers** — Practices being sold often have AR cleanup as part of the transition. These owners are primed for a solution.

### Lead Scoring

Score each prospect 1-10 on:
- AR volume signal (number of chairs, years in practice, specialty vs. general)
- Pain signal (recent complaints in reviews about wait times, billing issues)
- Decision-maker accessibility (owner is reachable on LinkedIn or has public email)
- Geographic fit (Ontario > BC/Alberta > other provinces for v1)

Prioritize anything ≥7.

---

## Outreach Sequencing

### Touch 1 — Cold Outreach (LinkedIn or email, Day 0)

Subject: `[Practice Name] — a question about your insurance AR`

"Hi [Name], I work on a platform that automates insurance follow-up calls for dental practices in Ontario — specifically, calling Sun Life, Canada Life, Manulife, and the others on your behalf while your team focuses on patients.

The practices we work with typically recover $X in additional AR per month and save [X hours] of hold time per week.

Would it make sense to show you a 15-minute demo? Happy to work around your schedule."

**Personalize one line** per practice: reference their specialty, their location, or a specific carrier they likely deal with.

### Touch 2 — Follow-Up (Day 5, if no reply)

"Wanted to make sure this didn't get buried — most practice owners we talk to say insurance follow-up is one of their biggest admin time sinks. Happy to send a one-pager if it's easier to share with your office manager first."

### Touch 3 — Value Add (Day 12, if no reply)

Send the ROI calculator output for their estimated practice size (from `roi-proof.md` agent). "I put together a quick estimate of what CollectRx typically recovers for a [X-chair] practice billing [Y carriers] in Ontario. Here's what the math usually looks like."

### Touch 4 — Break-Up (Day 21, if no reply)

"I won't keep following up — happy to reconnect if insurance AR ever becomes a bigger priority. If you have a colleague who handles billing decisions, feel free to forward this."

---

## Demo Script (15 minutes)

1. **Minutes 0-2:** Confirm pain — "How much time does your team spend on hold with carriers each week?" Let them answer. Do not assume.

2. **Minutes 2-5:** Show the Operations Center widget on collectrx.ca/carriers — one carrier at a time. "Here's what it looks like when the system calls Sun Life on your behalf."

3. **Minutes 5-8:** Show the ROI calculation using their numbers. "Based on what you just told me — [X hours] per week at [Y people] — here's what that translates to."

4. **Minutes 8-12:** Handle the top three objections (see below).

5. **Minutes 12-15:** "We start with a 30-day trial — no card required, 500 minutes included. The only thing we need to get started is a CSV export of your outstanding claims. How does your software produce that?"

### Objection Handling

**"We already have a billing service."** "Does that service handle phone follow-up with carriers, or do they send electronic claims and wait? Most billing services don't make calls — they're submission-only. CollectRx handles the follow-up step."

**"Is this legal? Can an AI call insurance companies?"** "Yes. We're registered as an authorized billing representative under the practice's name. Every call opens with a required disclosure that it's an automated system. We've reviewed this against Canadian telecom regulations. The carriers have dedicated provider lines for exactly this purpose."

**"What if the AI makes a mistake?"** "Every call is transcribed and logged. The system never confirms a financial outcome without capturing a carrier reference number. If it can't get a clear answer, it escalates to your staff rather than guessing. You review everything before it affects your records."

**"We're too small / we don't have enough AR."** "Our Core tier starts at $599/month. If you have more than $10,000 in outstanding AR — which most practices do — the math works immediately. We can run a trial and you'll see the results in the first 30 days."

---

## Pipeline Tracking

Maintain a pipeline in a simple spreadsheet or Notion table:

| Practice | Contact | Stage | Last Touch | Next Action | Est. MRR |
|---|---|---|---|---|---|
| [Name] | [Name/email] | [Lead/Demo/Trial/Signed] | [date] | [action + date] | $[amount] |

Stages: Lead → Contacted → Demo Scheduled → Demo Done → Trial → Signed → Churned

---

## Weekly Pipeline Report Format

```
## Client Acquisition Pipeline — Week of [DATE]

### Pipeline Summary
- Total leads: [n]
- In demo: [n]
- In trial: [n]
- Signed this week: [n] ($[MRR added])

### Outreach Activity
- Contacts made: [n]
- Replies: [n] ([%] response rate)
- Demos scheduled: [n]

### Trial Conversions
- Trials active: [n]
- Trials converting to paid: [n]
- Trials that lapsed: [n] (reason: [common theme])

### What's Working
- [Outreach message, channel, or demo moment that's getting responses]

### What's Not Working
- [What to stop or change]

### Next Week Actions
- [Specific outreach targets and follow-ups]
```

---

## How to Run This Agent

```
"Run the CollectRx client acquisition weekly review. Review the current pipeline (read from the pipeline tracking file if it exists). Identify 5 new prospects from the target sources in agents/client-acquisition.md. Draft outreach messages for those 5. Review any trials active and recommend conversion actions. Produce the weekly pipeline report."
```
