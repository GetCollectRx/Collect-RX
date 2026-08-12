# Khalid Life Insurance — End-to-End Test Guide

This guide walks you through testing the CollectRx call system with a custom test carrier: **Khalid Life Insurance**.

## Overview

**Khalid Life** is a test insurance carrier added to the system for demonstration and QA. When you run this test:

1. You'll import sample claims against "Khalid Life" into a test practice
2. You'll trigger a call from the CollectRx dashboard
3. The Vapi agent will call your phone and engage with you as if you're a Khalid Life representative
4. You'll play the insurer and respond to the agent's questions
5. The system will record outcomes and display them in the dashboard

---

## Step 1: Create or Access a Test Practice

You have two options:

### Option A: Create a Fresh Test Practice (Recommended)

1. Go to `http://localhost:5173` (after running `npm run dev`)
2. Sign up with:
   - **Email:** `test@khalid-life-demo.local`
   - **Practice Name:** `Khalid Life Test Practice`
   - **Password:** Any secure password
3. Complete onboarding (no actual credit card needed for trial)

### Option B: Use the Demo Seed

```bash
npm run demo:seed
```

This creates "CollectRx Demo Practice" with pre-populated claims.

---

## Step 2: Import Test Claims

### Using the CSV Upload Flow

1. **Navigate to:** Dashboard → Claims → Import CSV
2. **Download the test file:**
   ```
   khalid-life-test-claims.csv
   ```
   Located in repo root: `Collect-RX-main/khalid-life-test-claims.csv`

3. **Upload the CSV** and select **"Generic CSV"** as the format
4. **Map columns** (they should auto-detect):
   - `patient_first_name` → First Name
   - `patient_last_name` → Last Name
   - `policy_number` → Policy Number
   - `carrier_name` → Carrier (select "Khalid Life Insurance")
   - `procedure_code` → Procedure Code
   - `procedure_description` → Procedure Description
   - `treatment_date` → Treatment Date
   - `amount_submitted` → Amount Submitted
   - `date_submitted` → Date Submitted

5. **Click "Import"** — the claims are now in your outbox

### Test Claims Included

| Patient | Claim ID | Amount | Procedure | Days Outstanding |
|---------|----------|--------|-----------|-------------------|
| Khalid Egeh | CLM-KL-001 | $1,250 | Crown - PFM | 53 |
| Ahmed Hassan | CLM-KL-002 | $220 | Perio Maintenance | 63 |
| Fatima Ali | CLM-KL-003 | $420 | Composite Filling | 72 |

---

## Step 3: Set Up Your Phone Number in the Practice

1. **Dashboard → Settings → Practice Info**
2. **Add your phone number** (the one you'll receive calls on)
3. **Enable calling:** Toggle "Enable Automated Claims Calling" ON
4. **Save changes**

---

## Step 4: Understand What the Agent Will Say

When you trigger a call, the Vapi agent will follow this flow:

### Agent's Opening (15 seconds)

```
Agent: "Hi there, thanks for taking my call. I'm calling from Khalid Life Test Practice 
— we're just following up on a claim we submitted a while back. I've got all the details 
here whenever you're ready."

[You respond]
```

### Agent's Claim Details (20 seconds)

```
Agent: "Great, so I'm calling about claim CLM-KL-001. This is for a patient named Khalid Egeh. 
The service was a Crown - Porcelain Fused to Metal, submitted back in June. 

We're still waiting on payment — that's $1,250 outstanding. Can you pull that up?"

[You respond]
```

### Agent's Follow-up (Based on Your Response)

**If you say "still processing":**
```
Agent: "Okay, gotcha. How much longer do you think it'll take? Just so we can follow up 
at the right time."
→ Agent listens, thanks you, ends call
→ Records: outcome = "processing" | next_action = "follow_up_in_10_days"
```

**If you say "payment was issued":**
```
Agent: "Oh great! Can you give me the check number or reference number for the payment, 
and what date it was issued?"
→ Agent captures details
→ Records: outcome = "paid" | reference_number = "[your details]"
```

**If you say "we need X-rays":**
```
Agent: "Understood. What specifically do you need? Which tooth or area?"
→ Agent captures requirements
→ Records: outcome = "xray_required" | details = "[what you said]"
```

**If you say "coverage is maxed":**
```
Agent: "Okay, so the annual maximum has been reached. Is there anything the practice 
can do to reopen it or is it fully exhausted?"
→ Agent captures response
→ Records: outcome = "coverage_maxed"
```

---

## Step 5: Trigger the Call from the Dashboard

### From the Outbox

1. **Dashboard → Outbox** (or Claims → Queue)
2. **Find the Khalid Egeh claim** (CLM-KL-001)
3. **Click the call icon** or **"Call Now"** button
4. **System confirmation:** "Initiating call to [your phone]..."
5. **Your phone rings in ~5 seconds**

### Answer the Call

When your phone rings:
- **Caller ID shows:** "Khalid Life Test Practice" or similar
- **Answer and immediately get the agent's greeting**

---

## Step 6: Play the Insurance Carrier Role

Here are sample scripts you can use to test different outcomes:

### Scenario A: Claim Still Processing ✅ EASY

**You say:**
> "Let me pull that up... Okay, I see the claim here. Yeah, that's still in adjudication 
> right now. We got it back in June. These claims usually take about 30 business days to 
> process. You should expect payment within the next week or so."

**Agent will:**
- Ask for expected timeline
- Thank you
- End call politely

**System records:**
- ✅ Outcome: `processing`
- ✅ Next action: `follow_up_in_7_days`

---

### Scenario B: Payment Already Issued ✅ GOOD

**You say:**
> "Actually, good news — we issued payment on that one already. It was mailed out on July 2nd. 
> The check number is 4827, going to Khalid Life Test Practice."

**Agent will:**
- Confirm the amount ($1,250)
- Note the reference number
- Confirm mailing address
- End call

**System records:**
- ✅ Outcome: `paid`
- ✅ Reference: `Check #4827`
- ✅ Amount: `$1,250`
- ✅ Dashboard updates instantly

---

### Scenario C: X-Rays Required ✅ CHALLENGING

**You say:**
> "I'm looking at the claim now. The dentist submitted it without radiographs for that specific 
> procedure. We need x-rays of tooth #14 — the crown prep — before we can process this. 
> Can you have them resend the supporting documentation?"

**Agent will:**
- Ask specifically which x-rays/docs
- Confirm requirements clearly
- Note that agent won't commit to sending anything (policy)
- End call

**System records:**
- ✅ Outcome: `xray_required`
- ✅ Details: `X-rays of tooth #14 needed`
- ✅ Claim flagged for manual escalation

---

### Scenario D: Coverage Maxed Out

**You say:**
> "I'm seeing that the patient's annual maximum of $2,000 was reached on June 15th 
> with a different claim. There's no remaining benefit available for this claim."

**Agent will:**
- Confirm annual max is fully exhausted
- Ask if anything can reopen it
- End call

**System records:**
- ✅ Outcome: `coverage_maxed`
- ✅ Details: `Annual max $2,000 reached`

---

## Step 7: Monitor the Dashboard in Real-Time

While the call is happening or right after:

1. **Open a second browser tab** with the dashboard
2. **Dashboard → Analytics → Recent Calls** (or Outbox → Recent Activity)
3. **Watch the claim status update:**
   - From `queued` → `calling` → `completed`
   - See the agent's transcript appear in real-time (some delay)
   - See the JSON outcome summary

4. **Check the Claim Details:**
   - Click the claim → "View Call Transcript"
   - See what the agent said
   - See what you said (speech-to-text)
   - See the JSON outcome object

---

## Step 8: Verify the Outcome

After the call completes, you should see:

### In Dashboard
- ✅ Claim status changed from `pending` to appropriate outcome
- ✅ "Last called" timestamp updated
- ✅ Next action flagged (if applicable)

### In Call Transcript
- ✅ Full dialogue visible
- ✅ Agent's confidence scores for each response
- ✅ JSON summary output at the end

### In Database (Optional - for devs)
```sql
SELECT * FROM claim_attempts 
WHERE claim_id = 'CLM-KL-001' 
ORDER BY created_at DESC LIMIT 1;
```

Should show:
- `status`: "completed"
- `outcome`: "processing" | "paid" | "xray_required" | etc.
- `transcript_url`: Link to Vapi transcript
- `next_action_date`: Calculated based on outcome

---

## Khalid Life Carrier Details (For Reference)

**Khalid Life Insurance** has been added to CollectRx with these rules:

| Attribute | Value |
|-----------|-------|
| **Carrier Name** | Khalid Life Insurance |
| **Carrier ID** | `khalid_life` |
| **Preventive Coverage** | 100% |
| **Basic Coverage** | 85% |
| **Major Coverage** | 60% |
| **Ortho Coverage** | 50% |
| **Deductible (Individual)** | $25 |
| **Deductible (Family)** | $75 |
| **Annual Max (Individual)** | $2,000 |
| **Annual Max (Family)** | $5,000 |
| **Waiting Period (Major)** | 3 months |
| **Minimum Wait for Call** | 21 days |

---

## Troubleshooting

### "I didn't receive the call"
- [ ] Check that phone number is saved in practice settings
- [ ] Check that calling is enabled ("Enable Automated Claims Calling" toggle)
- [ ] Check Vapi dashboard → Call Logs for failed attempts
- [ ] Verify your phone number format: `+1-XXXXXXXXXX` or `+16135018951`

### "Agent doesn't understand my response"
- Speak clearly and naturally
- Avoid very long pauses
- The agent might ask you to repeat
- This is normal — real carriers do the same

### "Claim didn't import"
- [ ] Check column headers match the CSV template
- [ ] Verify "Khalid Life Insurance" is spelled exactly right in CSV
- [ ] Look for validation errors in the import UI

### "Can't find the call in the dashboard"
- Calls appear with a 5-10 second delay
- Refresh the page
- Check if there were any errors in the Vapi queue
- Check `/api/webhooks/vapi` logs (backend)

---

## Next Steps After Testing

Once you've completed the test call:

1. **Review the transcript** — See how well the agent performed
2. **Check the outcome recording** — Verify the system captured the correct status
3. **Test other scenarios** — Use the other claims (Ahmed Hassan, Fatima Ali)
4. **Try different responses** — Test edge cases ("I don't know", long pauses, etc.)
5. **Monitor analytics** — See how the dashboard tracks outcomes

---

## Files Included

```
Collect-RX-main/
├── khalid-life-test-claims.csv          ← Import this into your test practice
├── KHALID-LIFE-TEST-GUIDE.md            ← This file
└── src/services/eligibility/rules/
    └── carrier-configs.json             ← Khalid Life definition (updated)
```

---

## Questions?

If something isn't working as expected:
- Check the browser console for errors (`F12`)
- Check the API logs (from `npm run dev`)
- Review the Vapi dashboard at dashboard.vapi.ai
- Check the call transcript for agent errors

**Good luck with the test! 🚀**
