> **DEPRECATED — 2026-06-11** (updated 2026-07-16)
>
> The pricing/billing scheme in this document (starter / professional / enterprise flat tiers, `Subscription` model) is **superseded**.
>
> The confirmed pricing model going forward is **minutes-based** (trial / core / growth / scale), defined in [`src/billing/tiers.js`](../../src/billing/tiers.js) / Collect-RX-main billing tiers.
>
> **Also obsolete:** Stripe Connect / patient Payment Links / client payment collection. CollectRx is Practice → Insurance only; practice SaaS uses Stripe Billing (`/billing`).
>
> This file is kept for historical reference only. Do not implement against it.

---

# CollectRx - Integrating Financial Components with Technical Build

## How Financial Planning Connects to Your App Architecture

### 1. STRIPE CONNECT INTEGRATION (Already Discussed in Previous Chat)
**Technical Implementation:**
- OAuth flow for practice onboarding
- Store Stripe account IDs in database
- Direct charges to connected accounts
- Application fee logic (if you decide to add later)

**Financial Impact:**
- Platform fee: $2/month per active practice (track in operating costs)
- Processing fees: 2.9% + $0.30 (practice pays, not you)
- Must track active accounts for accurate cost projections

**Action:** Add Stripe Connect account tracking to your database schema

---

### 2. SUBSCRIPTION BILLING SYSTEM
**What You Need to Build:**

```javascript
// Subscription Model (add to Prisma schema)
model Subscription {
  id          String   @id @default(uuid())
  practiceId  String
  plan        String   // "starter", "professional", "enterprise"
  price       Decimal  // 349, 549, or 799
  status      String   // "active", "past_due", "canceled"
  currentPeriodStart DateTime
  currentPeriodEnd   DateTime
  createdAt   DateTime @default(now())
}

// Billing/Invoice Model
model Invoice {
  id              String   @id @default(uuid())
  practiceId      String
  amount          Decimal
  tax             Decimal  // HST 13%
  total           Decimal
  status          String   // "draft", "sent", "paid", "overdue"
  dueDate         DateTime
  paidAt          DateTime?
}
```

**Financial Integration:**
- Your revenue projections depend on these subscription records
- Track MRR (Monthly Recurring Revenue) from active subscriptions
- Monitor churn rate (practices canceling)

---

### 3. PAYMENT PROCESSING FOR YOUR SUBSCRIPTION FEES

**Two Options:**

**Option A: Stripe Billing (Recommended)**
```javascript
// Create subscription for practice
const subscription = await stripe.subscriptions.create({
  customer: practice.stripeCustomerId,
  items: [{
    price: 'price_professional_tier', // Your price ID
  }],
  tax_rates: ['txr_ontario_hst_13'], // 13% HST
});
```

**Option B: Manual Invoicing**
- Generate invoices monthly
- Send via email (SendGrid)
- Track payment status manually
- Less automated but simpler initially

**Financial Impact:**
- Need to factor in Stripe Billing costs: 0.5% of recurring revenue
- Or email sending costs if doing manual invoices

---

### 4. FINANCIAL DASHBOARD FOR YOU (Admin Panel)

**Build a dashboard to track:**

```javascript
// Key Metrics API Endpoints
GET /api/admin/metrics
{
  mrr: 4490,              // Monthly Recurring Revenue
  arr: 53880,             // Annual Recurring Revenue
  activePractices: 10,
  churnRate: 5,           // %
  operatingCosts: 270,
  netProfit: 4220,
  
  // Tax tracking
  totalRevenue: 53880,
  hstCollected: 7004,     // 13% of revenue after $30K
  hstRemitted: 5000,
  hstOwing: 2004
}
```

**Pages to Build:**
- `/admin/revenue` - Revenue over time chart
- `/admin/practices` - List of all practices + subscription status
- `/admin/costs` - Operating costs tracker
- `/admin/tax` - Tax compliance dashboard

---

### 5. AUTOMATED TAX CALCULATIONS

**When Revenue > $30K:**

```javascript
// Middleware to add HST to invoices
function calculateInvoiceTotal(baseAmount) {
  const needsHST = await checkHSTRegistration(); // Check if you're registered
  
  if (needsHST) {
    const hst = baseAmount * 0.13;
    return {
      subtotal: baseAmount,
      hst: hst,
      total: baseAmount + hst
    };
  }
  
  return {
    subtotal: baseAmount,
    hst: 0,
    total: baseAmount
  };
}
```

---

### 6. OPERATING COSTS TRACKING

**Add Expense Tracking:**

```javascript
// Expense Model
model Expense {
  id          String   @id @default(uuid())
  category    String   // "hosting", "sendgrid", "stripe_fees"
  amount      Decimal
  date        DateTime
  description String
  recurring   Boolean  // Is this a monthly expense?
}

// Track actual vs projected costs
GET /api/admin/costs/compare
{
  projected: 270,
  actual: 245,
  variance: -25
}
```

---

### 7. CUSTOMER PORTAL FOR PRACTICES

**What Practices Need to See:**

```
/practice/billing
- Current subscription plan
- Next billing date
- Payment history
- Download invoices
- Update payment method
- Cancel subscription
```

---

### 8. EMAIL AUTOMATION (SendGrid Integration)

**Financial-Related Emails:**

```javascript
// Invoice emails
sendInvoiceEmail(practice, invoice) {
  // Template: "Your CollectRx invoice for $392.37 (incl. HST)"
}

// Payment failed
sendPaymentFailedEmail(practice) {
  // Template: "Payment failed - please update card"
}

// Subscription canceled
sendCancellationEmail(practice) {
  // Template: "Sorry to see you go"
}
```

**Cost:** SendGrid ~$20-50/month (already in your operating costs)

---

## IMMEDIATE TECHNICAL TASKS

### Phase 1: Billing Infrastructure (Week 1-2)
```
☐ Add Subscription + Invoice models to Prisma schema
☐ Set up Stripe Billing in your Stripe account
☐ Create pricing objects in Stripe ($349, $549, $799)
☐ Build subscription creation API endpoint
☐ Test billing flow end-to-end
```

### Phase 2: Admin Dashboard (Week 3-4)
```
☐ Create admin layout/navigation
☐ Build revenue metrics dashboard
☐ Build practice list with subscription status
☐ Add operating costs tracking page
☐ Create tax tracking dashboard
```

### Phase 3: Customer Portal (Week 5-6)
```
☐ Build billing page for practices
☐ Integrate Stripe customer portal (or build custom)
☐ Add invoice download functionality
☐ Test cancellation flow
```

---

## HOW THIS FINANCIAL MODEL HELPS YOUR DEVELOPMENT

**Use the spreadsheet to:**
1. **Prioritize features** - Focus on what drives revenue first
2. **Set milestones** - "Need 5 practices by Month 3"
3. **Budget development** - Know how much you can spend on tools
4. **Pitch investors** - Show realistic financial projections
5. **Track progress** - Compare actual vs projected monthly

---

## RECOMMENDED DATABASE ADDITIONS

```prisma
model Practice {
  id                String   @id @default(uuid())
  name              String
  stripeAccountId   String?  // For Stripe Connect
  stripeCustomerId  String?  // For billing CollectRx subscription
  subscription      Subscription?
  invoices          Invoice[]
  // ... existing fields
}

model Subscription {
  id              String   @id @default(uuid())
  practiceId      String   @unique
  practice        Practice @relation(fields: [practiceId], references: [id])
  plan            String   // "starter", "professional", "enterprise"
  price           Decimal
  status          String
  stripeSubscriptionId String?
  currentPeriodStart DateTime
  currentPeriodEnd   DateTime
  cancelAtPeriodEnd  Boolean @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model Invoice {
  id              String   @id @default(uuid())
  practiceId      String
  practice        Practice @relation(fields: [practiceId], references: [id])
  invoiceNumber   String   @unique
  subtotal        Decimal
  hst             Decimal
  total           Decimal
  status          String
  dueDate         DateTime
  paidAt          DateTime?
  stripeInvoiceId String?
  createdAt       DateTime @default(now())
}

model Expense {
  id          String   @id @default(uuid())
  category    String
  amount      Decimal
  date        DateTime
  description String
  recurring   Boolean  @default(false)
  createdAt   DateTime @default(now())
}
```

---

## NEXT STEPS

1. **Share this with your developer** - They need to see the financial requirements
2. **Decide on billing approach** - Stripe Billing vs Manual?
3. **Add database models** - Subscription, Invoice, Expense tables
4. **Build admin dashboard** - Track your actual numbers
5. **Update the financial model monthly** - Compare projected vs actual

Want me to help you build any of these specific components?
