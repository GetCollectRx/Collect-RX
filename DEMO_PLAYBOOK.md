# CollectRx Sales Demo Playbook

**Goal:** Convert inbound leads to qualified pilots within 2 days of first contact.

---

## Quick Setup (< 5 minutes)

### 1. Spin up a demo instance

```bash
# On the demo/staging server:
cd /path/to/Collect-RX
git pull origin prd  # Always use prd branch for demos

# Create fresh demo practice
export SEED_PRACTICE_PASSWORD="Demo_Pass_2026"
npm run demo:seed -- --reset
```

### 2. Access the demo

- **URL:** `https://demo.collectrx.ca` (or staging equivalent)
- **Email:** `demo@collectrx-test.local`
- **Password:** `Demo_Pass_2026`

---

## What the Demo Includes

The demo practice comes pre-loaded with **60+ insurance claims** across:

**Claim statuses:**
- Approved claims (payment in queue)
- Pending claims (awaiting carrier response)
- Denied claims (need escalation)
- Partially paid claims (verification needed)

**Carriers covered:**
- Sun Life (25% of claims)
- Canada Life (20%)
- Manulife (20%)
- Green Shield (15%)
- RBC Insurance (10%)
- TELUS AdjudiCare (10%)

**Recovery routes represented:**
- Automated IVR navigation (working calls to test carriers)
- Manual escalation (for denied claims)
- Payment trace (for pending adjudication)
- Patient AR (balance recovery)

---

## Demo Flow (15–20 minutes)

### 1. **Login & Dashboard Overview** (2 min)
- Show the practice dashboard
- Highlight key metrics: total AR, claims in recovery, recovery rate
- Point out the 4-agent voice squad in the sidebar

### 2. **Claim Queue** (5 min)
- Show the prioritized worklist (highest-value claims first)
- Explain the selection criteria: age, outstanding amount, recovery likelihood
- Click into a **Pending Approved claim** to show the details:
  - Patient info (tokenized, no PHI in UI)
  - Claim amount, patient responsibility, insurance responsibility
  - Carrier and expected payment timeline
  - Recovery history (previous calls, outcomes)

### 3. **Live Call Demo** (8 min) — *Optional but powerful*
- Select a **Pending Claim** from the queue
- Click "Initiate Call"
- Show the voice squad briefing:
  - Which agent is starting (IVR_Navigator)
  - What information is being sent to the carrier
  - Timeline (typically 5–10 min per claim)
- **Pause the call** and show the call transcript
- Explain the handoff: IVR_Navigator → Claims_Agent → Resolution_Closer

### 4. **Historical Results** (3 min)
- Show **recent closed claims** with recovery outcomes
- Highlight:
  - $X collected in the last 30 days
  - Average recovery per claim: $Y
  - Carrier success rate by carrier
- Explain the ROI: "At $X per claim collected, a 10-claim per month practice recovers $Z annually"

### 5. **Closing** (2 min)
- Show the **Onboarding** section:
  - CSV import (fastest path to data)
  - AbelDent connector (for practices already using AbelDent)
- Set expectations: "You'll be live in 48 hours. We handle all carrier setup."

---

## Handling Objections

| Objection | Response |
|-----------|----------|
| "Will the carrier block us for automation?" | "No. We're ADAD-compliant and disclose our automated nature within 10 seconds per CRTC rules. We monitor carrier block lists and pause immediately if flagged." |
| "What about patient privacy?" | "Patient names and DOBs never leave your practice. We tokenize all data and only transmit what the carrier needs to look up the claim. PHIPA/PIPEDA compliant." |
| "How long does onboarding take?" | "2 business days. You upload a CSV with your AR data, we spin up the agents, and you're live. No IT setup required." |
| "What if a call goes wrong?" | "Every call is transcribed and reviewed. If an agent makes a mistake, we halt that carrier's queue and investigate. You always have full visibility." |
| "Can we try it risk-free?" | "Yes—30-day free pilot. You see the results first. No upfront cost." |

---

## Pre-Demo Checklist

- [ ] Staging environment is up and responsive (check logs for errors)
- [ ] Demo practice has been seeded in the last 7 days
- [ ] Test login works (email/password)
- [ ] At least one claim is in "ready to call" status
- [ ] Vapi test squad is responding (initiate a test call; check that IVR_Navigator connects)
- [ ] Staging database has no errors in the last 24h (check error logs)
- [ ] You have a phone number ready for the test call (or use a test number)

---

## Post-Demo Follow-up

**Within 24 hours:**
1. Send a summary email with:
   - Key metrics from the demo (AR recovered, claims processed)
   - Link to full demo video (if recorded)
   - Next step: "Let's set up a quick 15-minute call to answer questions"

2. Propose a **Pilot Timeline:**
   - **Day 1:** CSV data import, agent configuration
   - **Day 2:** Go live, first claims in queue
   - **Week 2:** Review results, discuss ROI
   - **Month 2:** Upgrade to full plan or extend pilot

**Pilot Success Criteria:**
- Minimum 5 claims called per week
- At least 1 payment recovered
- Carrier feedback: no blocks or warnings
- Practice team reports positive interaction with agents

---

## Monitoring (Ensure Staging Doesn't Break)

Add these to your monitoring/alerting:

```bash
# Check staging DB connectivity
psql $DATABASE_URL -c "SELECT 1"

# Check staging API health
curl -s https://demo.collectrx.ca/health | jq .

# Check demo practice exists
psql $DATABASE_URL -c "SELECT id, name FROM practices WHERE name = 'CollectRx Demo Practice'"

# Check Vapi squad status (if you have Vapi API key)
curl -s https://api.vapi.ai/assistants \
  -H "Authorization: Bearer $VAPI_API_KEY" | jq '.[] | select(.name | contains("IVR"))'
```

Set up alerts if:
- Staging DB is down
- API response time > 2s
- Demo practice is missing
- Vapi squad is offline

---

## Customization for Specific Prospects

After the initial demo, customize the follow-up with **their** AR data:

```bash
# If they send you a CSV with their claims:
1. Create a private demo practice just for them
2. Import their CSV using the onboarding flow
3. Let them see THEIR claims being called
4. Show THEIR potential recovery

# Or run a cost-benefit analysis:
- "Your practice has $X in aged AR"
- "At a Y% recovery rate (our average), that's $Z in recovery"
- "With CollectRx, you could recover that in Z weeks instead of chasing it manually"
```

---

## Useful Links

- **Onboarding Docs:** `docs/onboarding/`
- **Carrier Specs:** `docs/carrier-compliance/`
- **Demo Practice Password:** Store in password manager (never in code)
- **Vapi Squad Dashboard:** https://vapi.ai/dashboard
- **Staging Logs:** `fly logs -a collect-rx-staging`

---

## When You Get a Bite 🎣

1. **Confirm fit:** Ask about practice size, AR volume, carriers used
2. **Set expectations:** "Go-live is 2 days after CSV upload"
3. **Schedule kickoff:** Book a 30-min onboarding call for Day 1
4. **Prepare their CSV template:** Send the import schema
5. **Line up support:** Ensure someone is available for Day 1 & 2 to answer questions

You're selling **time savings and recovery**, not software. Lead with the ROI.
