# Dental A/R System - Demo Guide

## 🎬 5-Minute Demo Walkthrough

This guide walks you through demonstrating the key features of the A/R execution system.

---

## Step 1: Initial View - Dashboard (30 seconds)

**What to Show:**
1. Navigate to http://localhost:5173
2. Point out the key metrics:
   - **Total Open A/R**: Shows aggregate of all unpaid balances
   - **Aging Buckets**: Visual breakdown of how old the balances are
   - **Stage Distribution**: Shows how many balances are at each collection stage

**What to Say:**
> "This is the main dashboard that gives practice staff instant visibility into their accounts receivable. Notice we have $X in total open A/R, with balances distributed across different age brackets. The system automatically categorizes balances by their collection stage."

---

## Step 2: Rules Engine in Action (1 minute)

**What to Show:**
1. Keep terminal visible where `npm run dev` is running
2. Wait for log messages (every 60 seconds):
   ```
   📨 Balance abc123 → NOTIFIED
   📨 Balance def456 → REMINDER_1
   ⚠️  Balance ghi789 → ESCALATED + STAFF_REVIEW
   ```

**What to Say:**
> "In the background, our rules engine evaluates all open balances every 60 seconds. Watch the terminal - you can see it automatically moving balances through stages based on age and amount. A newly created balance gets an immediate friendly notification. After 5 days, it escalates to Reminder 1. After 10 more days, Reminder 2. High-value balances ($500+) or very old balances (20+ days) automatically escalate for staff review."

---

## Step 3: Message Outbox (1 minute)

**What to Show:**
1. Click "Message Outbox" in the navigation
2. Scroll through messages showing different templates:
   - **NOTIFIED**: Friendly tone - "This is a friendly reminder..."
   - **REMINDER_1**: Neutral tone - "We wanted to follow up..."
   - **REMINDER_2**: Firm tone - "Immediate payment is required..."
   - **ESCALATED**: Policy-based - "IMPORTANT NOTICE..."

**What to Say:**
> "Every message sent by the system is logged here. Notice the 'tone ladder' - we start friendly and become progressively more firm as balances age. This is best practice for medical collections - maintaining patient relationships while ensuring payment. Each message includes a payment link and clear next steps."

---

## Step 4: Simulate Patient Response (2 minutes)

**What to Show:**
1. Find a message with action buttons
2. Click **"💰 Pay Now"**
   - Point out how it immediately updates
   - Message status changes to "Response: PAY"
   - Delivery status shows "SENT"

3. Go back to Dashboard
   - Show updated totals (decreased by payment amount)
   - Show updated stage counts (one fewer in active stage)

4. Return to Outbox, find another message
5. Click **"⚠️ Dispute"**
   - Show status changes to "Response: DISPUTE"

6. Click "Balances" and filter by "STAFF_REVIEW" stage
   - Show the disputed balance now appears here

**What to Say:**
> "CollectRx is Practice → Insurance only — we do not collect payments from patients. This staff-review path is about insurance claim follow-up and escalations, not patient pay links."

---

## Step 5: Balance Timeline - Full Audit Trail (1 minute)

**What to Show:**
1. Click "Balances" in navigation
2. Click "View Details" on any balance (preferably one with history)
3. Show the timeline:
   - Stage transitions with timestamps
   - Messages sent with full text
   - Payment events (if any)

**What to Say:**
> "Every single action on a balance is recorded for complete auditability. You can see exactly when it was created, every stage transition, every message sent with the exact text the patient received, and any payments made. This level of documentation is critical for compliance and dispute resolution."

---

## Step 6: Generate New Balances (30 seconds)

**What to Show:**
1. Click "Admin" in navigation
2. Set balance count to 20
3. Click "Generate Synthetic Balances"
4. Watch the success message
5. Return to Dashboard to show updated totals
6. Watch terminal for rules engine processing the new balances

**What to Say:**
> "In production, this would be connected to Dentrix to import balances automatically after patient visits. For this demo, we simulate that with synthetic data. Watch how the rules engine immediately picks up these new balances and starts processing them according to our defined rules."

---

## Step 7: Payment Portal (Optional - 30 seconds)

**What to Show:**
1. In Message Outbox, copy a payment link from a message
2. Open it in a new tab (or just navigate to /pay/:balanceId)
3. Show the clean payment interface
4. Click "Pay $XX.XX"
5. Show success confirmation

**What to Say:**
> "Patients receive a secure payment link in their messages. The portal is simple and focused - shows exactly what they owe and provides one-click payment. In production, this would integrate with Stripe or Square for actual payment processing."

---

## Key Talking Points

### For Business Stakeholders:
- **ROI**: Reduces manual follow-up time by 80%+
- **Cash Flow**: Accelerates collections through consistent, timely outreach
- **Compliance**: Complete audit trail for every action
- **Scalability**: Handles thousands of balances automatically

### For Technical Stakeholders:
- **Modern Stack**: TypeScript, React, Node.js, Prisma
- **Deterministic**: Rules-based engine with predictable behavior
- **Auditable**: Every state change recorded with timestamp
- **Extensible**: Easy to add new rules, message templates, or integrations

### For Clinical Staff:
- **Patient-Friendly**: Progressive tone ladder maintains relationships
- **Transparent**: Patients always know what they owe and how to pay
- **Automatic**: No manual tracking of who to contact when
- **Exception Handling**: Disputes and questions route to staff automatically

---

## Common Questions & Answers

**Q: What happens if a patient calls to dispute?**
A: Staff can manually mark it as disputed in the system (via the simulate response feature in this POC), which routes it to staff review and pauses automated collection.

**Q: Can we customize the message timing?**
A: Yes, all rules are configurable - days between stages, amount thresholds, message templates, etc.

**Q: Does this replace Dentrix?**
A: No, Dentrix remains the system of record. This system complements it by adding automated execution of A/R workflows.

**Q: What about HIPAA compliance?**
A: This POC uses synthetic data. Production would require encrypted storage, audit logs, BAA agreements with vendors, and other HIPAA safeguards.

**Q: Can multiple practices share the system?**
A: Yes, the data model supports multiple practices with complete isolation between them.

---

## Demo Tips

1. **Run through once before**: Make sure you understand the flow
2. **Keep terminal visible**: The rules engine logs are impressive
3. **Have balances at different stages**: Seed data provides this automatically
4. **Explain the "why"**: Medical collections have specific best practices
5. **Emphasize auditability**: This is critical for healthcare
6. **Show the progression**: CREATED → NOTIFIED → REMINDER_1 → REMINDER_2 → ESCALATED
7. **Point out the tone ladder**: Friendly → Neutral → Firm → Policy-based

---

## Troubleshooting

**Nothing happens when I generate balances:**
- Check terminal for error messages
- Ensure database was seeded (`npm run db:seed`)
- Verify API is running on port 3000

**Rules engine not processing balances:**
- Wait 60 seconds for next evaluation cycle
- Check that balances exist in CREATED stage
- Look for error messages in terminal

**Can't see messages in Outbox:**
- Ensure practice ID matches between pages
- Verify rules engine has run at least once
- Check that balances are old enough to trigger rules

**Dashboard shows $0:**
- Run `npm run db:seed` to populate initial data
- Generate balances via Admin panel
- Check that balances have status 'OPEN'

---

**Ready to demo? Start with the Dashboard and follow the steps above!**
