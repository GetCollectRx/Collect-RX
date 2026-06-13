# CollectRx — Marketing Agents: Plan & Architecture

**Status:** Planning → Active Development
**Goal:** Grow from one pilot practice to a network of dental practice partners by automating prospect discovery, outreach, qualification, and pipeline management through AI agents.

---

## Problem statement

CollectRx has proven value at the pilot practice (Dr. Hasan's office). Scaling requires a repeatable, low-overhead process to onboard new practices. This system automates the partnership sales funnel end-to-end using the same AI-agent infrastructure already powering the AR workflow.

---

## Ideal Customer Profile (ICP)

| Attribute | Target |
|-----------|--------|
| Practice type | General dentistry, multi-specialty |
| Location | Canada (Ontario/BC/Alberta priority) |
| Size | 1–10 operatories |
| PMS | Abeldent, Dentrix, Dentimax, Tracker |
| Pain signal | Staff time on insurance phone follow-up |
| Decision-maker | Owner-dentist or office manager |

---

## Agent Roster

### 1. Prospect Harvester (data enrichment agent)
- **Input:** Target geographies, practice-type keywords
- **Output:** `ProspectPractice` records in DB
- **Sources:** Google Places API (dental practices), provincial dental directories, referrals
- **Deduplication:** by phone + name + postal code
- **Scoring:** `score` field 0–100 based on: has real phone, has website, practice size signals, not already a customer

### 2. Email Outreach Agent (sequence executor)
- **Infrastructure:** SendGrid (existing `P4-01` integration)
- **Sequences:** Configurable multi-step cadences (see below)
- **Personalization:** Practice name, city, estimated AR problem size
- **Compliance:** Unsubscribe link on every email (CASL-aware), `optedOutAt` flag respected
- **Tracking:** Open/click events via SendGrid webhook → `OutreachEvent` table

### 3. Voice Qualification Agent (new Vapi agent)
- **Name:** `Sales_Qualifier`
- **Infrastructure:** Existing Vapi + Twilio stack
- **Triggers:** After positive email engagement signal OR direct admin trigger
- **Call flow:**
  1. Introduce CollectRx briefly (30 sec)
  2. Ask 3 qualification questions: practice size, current AR pain, PMS used
  3. If qualified → schedule demo or transfer to human
  4. Capture outcome → `OutreachEvent`
- **Call windows:** Same rules as AR calls — Mon–Fri 8am–5pm Eastern

### 4. Follow-Up Orchestrator (BullMQ job)
- **Infrastructure:** Existing BullMQ + Redis (P8 already done)
- **Logic:** State-machine for each `OutreachSequence`; advances steps on schedule
- **Backoff:** Respects email open/reply signals; suppresses sends if engagement detected
- **Escalation:** Surfaces "hot leads" (replied + opened 3+) in the Partnerships UI for human follow-up

### 5. Demo Scheduler (webhook integration)
- **Integration:** Calendly or Cal.com webhook
- **On booking:** Creates `OutreachEvent(type=demo_booked)`, advances pipeline stage to `demo_scheduled`
- **Pre-demo:** Sends personalized prep email 24h before

---

## Pipeline Stages

```
new → contacted → engaged → qualified → demo_scheduled → proposal_sent → closed_won | closed_lost | not_interested
```

| Stage | Trigger |
|-------|---------|
| `new` | Prospect harvested |
| `contacted` | First email sent |
| `engaged` | Email opened or clicked |
| `qualified` | Voice call completed + score ≥ 60 |
| `demo_scheduled` | Calendly booking received |
| `proposal_sent` | Manual step by sales rep |
| `closed_won` | Practice created in CollectRx (Practice record linked) |
| `closed_lost` | Manual or after 60-day silence |
| `not_interested` | Explicit reply or call outcome |

---

## Email Cadence (Default Sequence)

| Step | Offset | Subject |
|------|--------|---------|
| 1 | Day 0 | "How {PracticeName} could recover $XX,000 in insurance A/R automatically" |
| 2 | Day 3 | Follow-up: "Quick question about your insurance follow-up process" |
| 3 | Day 7 | Case study: "How a dental office in [City] saved 8 hrs/week" |
| 4 | Day 14 | Break-up email: "Last thing — happy to send a quick overview" |

Auto-stop sequence when: reply received, unsubscribe clicked, demo booked, or `not_interested` stage set.

---

## Data Model

```
ProspectPractice
  id, name, city, province, postalCode
  phone, email, website
  practiceSize (solo | small_group | large_group)
  pmsGuess (abeldent | dentrix | unknown | ...)
  source (google_places | directory | referral | manual)
  stage (new | contacted | engaged | ... | closed_won | closed_lost)
  score (0–100)
  assignedTo (User id, optional)
  linkedPracticeId (Practice id, optional — set on closed_won)
  notes (text)
  optedOutAt (DateTime)
  createdAt, updatedAt

OutreachSequence
  id, prospectId
  sequenceType (email_cadence | voice_call | manual)
  status (active | paused | completed | stopped)
  currentStep (int)
  nextRunAt (DateTime)
  startedAt, completedAt

OutreachEvent
  id, prospectId, sequenceId (optional)
  type (email_sent | email_opened | email_clicked | email_replied |
        call_attempted | call_connected | call_outcome |
        demo_booked | stage_changed | note_added)
  metadata (Json — subject, outcome, score, etc.)
  occurredAt
```

---

## Infrastructure reuse

| Need | Existing component |
|------|--------------------|
| Email send + webhooks | `sendgrid/` + `P4-01` webhook handler |
| Voice calls | Vapi squad + Twilio |
| Job scheduling | BullMQ `arQueue` → new `marketingQueue` |
| Audit trail | `AuditLog` table |
| Auth/guard | Same JWT middleware |
| Unsubscribe | `emailOptOutAt` pattern → `optedOutAt` on ProspectPractice |

---

## New components to build

| Component | Location | Size |
|-----------|----------|------|
| Prisma models | `prisma/schema.prisma` | Small |
| Marketing queue | `src/server/jobs/marketingQueue.ts` | Small |
| Sequence engine | `src/server/marketing/sequenceEngine.ts` | Medium |
| Email templates | `src/server/marketing/emailTemplates.ts` | Small |
| Prospect harvester | `src/server/marketing/prospectHarvester.ts` | Medium |
| Voice agent config | `src/server/marketing/salesQualifierAgent.ts` | Small |
| API routes | `src/server/marketing/marketingRouter.ts` | Medium |
| Partnerships UI | `src/pages/Partnerships.tsx` | Medium |
| Pipeline kanban | `src/components/ProspectPipeline.tsx` | Medium |
| Prospect detail | `src/pages/ProspectDetail.tsx` | Small |

---

## Compliance notes (Canada)

- **CASL (anti-spam):** Must have implied or express consent before commercial email. For cold outreach to businesses, implied consent exists for 2 years if there is an existing business relationship or the email was publicly published for business purposes. Add unsubscribe link to every email.
- **PIPEDA:** Prospect data (name, email, phone) is business contact info — generally lower bar than consumer PHI. Do not store patient data in the marketing pipeline.
- **Call timing:** Same Mon–Fri 8am–5pm Eastern rule as AR calls.
- **National Do Not Call:** Check DNCL before voice outreach. Add `dncl_checked_at` field.

---

## Phased delivery

### Phase A — Foundation (this sprint)
- Prisma schema + migration
- Backend API (prospects CRUD, sequence trigger, pipeline view)
- BullMQ marketing queue
- Email sequence engine (days 0, 3, 7, 14)
- Partnerships UI (pipeline kanban + prospect detail)

### Phase B — Voice qualification
- Sales_Qualifier Vapi agent definition
- Call trigger from pipeline UI
- Call outcome → stage advancement

### Phase C — Prospect harvester
- Google Places API integration (configurable search area)
- Auto-score and deduplication
- Admin "Harvest" trigger in UI

### Phase D — Demo scheduler
- Calendly/Cal.com webhook
- Pre-demo email automation
- Closed-won → Practice creation handoff

---

*Last updated: 2026-06-13 (initial plan)*
