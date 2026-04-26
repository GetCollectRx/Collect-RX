# Dental A/R Execution System - POC

A proof-of-concept web application for dental practices to automatically manage patient accounts receivable (A/R) through rules-based workflows, messaging, and payment collection.

## 🎯 Overview

This system sits alongside Dentrix (which remains the system of record) and provides automated execution of A/R collection workflows:
- **Rules Engine**: Automatically advances balances through collection stages based on time and amount thresholds
- **Automated Messaging**: Sends progressive messages (friendly → firm) as balances age
- **Payment Collection**: Provides payment links and tracks all payment events
- **Complete Auditability**: Every stage transition, message, and payment is recorded

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Windows, Mac, or Linux

### Setup (3 minutes)

```bash
# 1. Install dependencies
npm install

# 2. Initialize database and generate Prisma client
npm run db:generate
npm run db:push

# 3. Seed database with practice, patients, and initial balances
npm run db:seed

# 4. Start the application (runs both backend and frontend)
npm run dev
```

The application will be available at:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000

## 📋 Demo Script (5 minutes)

Follow these steps to see the system in action:

### Step 1: View Dashboard (30 seconds)
1. Open http://localhost:5173 in your browser
2. You'll see the dashboard with:
   - Total open A/R amount
   - Aging buckets (0-30, 31-60, >60 days)
   - Balance counts by stage

### Step 2: Watch the Rules Engine (1 minute)
1. Check your terminal where you ran `npm run dev`
2. Watch for log messages like:
   ```
   📨 Balance xxx → NOTIFIED
   📨 Balance xxx → REMINDER_1
   ⚠️  Balance xxx → ESCALATED + STAFF_REVIEW
   ```
3. The rules engine runs every 60 seconds and automatically processes balances based on:
   - **CREATED** → Immediately send NOTIFIED message
   - **NOTIFIED** (5+ days old) → Send REMINDER_1
   - **REMINDER_1** (10+ days old) → Send REMINDER_2
   - **REMINDER_2** (20+ days old OR ≥$500) → ESCALATED

### Step 3: View Message Outbox (1 minute)
1. Click **"Message Outbox"** in the navigation
2. You'll see all messages sent by the rules engine
3. Messages show progressive tone ladder:
   - **NOTIFIED**: Friendly reminder
   - **REMINDER_1**: Neutral follow-up
   - **REMINDER_2**: Firm notice
   - **ESCALATED**: Policy-based final notice

### Step 4: Simulate Patient Response (2 minutes)
1. In the Message Outbox, find any message with response buttons
2. Click **"💰 Pay Now"** to simulate a payment
   - Balance immediately closes
   - Payment event is recorded
   - Stage advances to CLOSED
3. Try **"⚠️ Dispute"** on another message
   - Balance status changes to IN_DISPUTE
   - Stage advances to STAFF_REVIEW

### Step 5: View Balance Details (1 minute)
1. Click **"Balances"** in navigation
2. Click **"View Details"** on any balance
3. See complete timeline showing:
   - All stage transitions
   - All messages sent with full text
   - All payment events
   - Full audit trail

### Step 6: Generate More Balances (30 seconds)
1. Click **"Admin"** in navigation
2. Set number of balances (e.g., 20)
3. Click **"🔄 Generate Synthetic Balances"**
4. Return to Dashboard to see updated totals
5. Watch terminal logs as rules engine processes new balances

## 🏗️ Architecture

### Tech Stack
- **Backend**: Node.js, Express, TypeScript
- **Database**: SQLite with Prisma ORM
- **Frontend**: React, TypeScript, Vite
- **Styling**: CSS (no frameworks for simplicity)

### Project Structure
```
dental-ar-system/
├── prisma/
│   └── schema.prisma          # Database schema
├── src/
│   ├── server/
│   │   ├── index.ts           # Express API server
│   │   ├── rulesEngine.ts     # Rules evaluation logic
│   │   ├── messageTemplates.ts # Message templates with tone ladder
│   │   └── seed.ts            # Database seeding
│   ├── pages/
│   │   ├── Dashboard.tsx      # Main dashboard with stats
│   │   ├── Balances.tsx       # Balance list with filters
│   │   ├── BalanceDetail.tsx  # Balance timeline view
│   │   ├── Outbox.tsx         # Message outbox with response simulation
│   │   ├── Admin.tsx          # Admin tools
│   │   └── PaymentPage.tsx    # Payment portal
│   ├── App.tsx                # Main React app
│   ├── App.css               # Styles
│   └── main.tsx              # React entry point
├── package.json
└── README.md
```

### Database Schema

**Core Entities:**
- `Practice`: Dental practice information
- `Patient`: Synthetic patient data (no PHI)
- `Balance`: Patient balances from "Dentrix sync"
- `BalanceState`: Stage history for each balance
- `OutreachEvent`: All messages sent
- `PaymentEvent`: All payments received
- `RuleSet` / `Rule`: Configurable automation rules

## 🔐 Security & Privacy

- **No PHI**: All patient data is synthetic (Patient A01, A02, etc.)
- **No Real Communications**: Messages are simulated, not actually sent
- **No Payment Processing**: Payment portal is demonstration only
- **Local Only**: Runs entirely on localhost

## 🎨 Key Features

### 1. Rules Engine
- Evaluates all open balances every 60 seconds
- Deterministic stage progression
- Configurable thresholds and timing
- Automatic message sending

### 2. Message Templates
Implements tone ladder appropriate for medical collections:
- **NOTIFIED**: "This is a friendly reminder..."
- **REMINDER_1**: "We wanted to follow up..."
- **REMINDER_2**: "Immediate payment is required..."
- **ESCALATED**: "IMPORTANT NOTICE - Per our practice policy..."

### 3. Dashboard
- Real-time A/R totals
- Aging analysis (0-30, 31-60, >60 days)
- Stage distribution
- Filterable balance list

### 4. Complete Audit Trail
Every action is recorded:
- Stage transitions with timestamps
- Messages sent with full text
- Patient responses (simulated)
- Payment events

### 5. Dentrix Integration Simulator
- CSV upload ready (not implemented in POC)
- Button to generate synthetic balances
- Simulates "balance created after visit" workflow

## 🔧 Configuration

### Default Rules
The system includes a default rule set (see `src/server/seed.ts`):

1. **Balance Created** → Send NOTIFIED immediately
2. **5 days since NOTIFIED** → Send REMINDER_1
3. **10 days since REMINDER_1** → Send REMINDER_2
4. **20 days since REMINDER_2 OR ≥$500** → ESCALATED + STAFF_REVIEW

### Modifying Rules
Rules are stored in the database and can be edited via the API:
```typescript
PUT /api/rules/:id
{
  "conditions": { "days": 7 },
  "actionParams": { "templateKey": "REMINDER_1" }
}
```

## 📊 API Endpoints

### Dashboard
- `GET /api/dashboard/stats?practiceId=xxx` - Get dashboard statistics

### Balances
- `GET /api/balances?practiceId=xxx&stage=xxx&minAmount=xxx` - List balances with filters
- `GET /api/balances/:id` - Get balance detail with timeline

### Outreach
- `GET /api/outreach?practiceId=xxx` - List all outreach events
- `POST /api/outreach/:id/respond` - Simulate patient response

### Payments
- `POST /api/pay/:balanceId` - Process payment

### Admin
- `POST /api/admin/generate-balances` - Generate synthetic balances
- `GET /api/practices` - List practices
- `GET /api/rules?practiceId=xxx` - Get rule sets
- `PUT /api/rules/:id` - Update rule

## 🧪 Testing Scenarios

### Scenario 1: New Balance
1. Generate a balance through Admin
2. Watch it immediately receive NOTIFIED message
3. View message in Outbox

### Scenario 2: Aging Balance
1. Use seed data which includes balances 0-45 days old
2. Watch older balances automatically progress through stages
3. Observe tone ladder in messages

### Scenario 3: High-Value Balance
1. Seed includes some $500+ balances
2. These escalate faster per the amount threshold rule
3. See ESCALATED stage even if not 20 days old

### Scenario 4: Payment Flow
1. Click payment link in message
2. Complete payment
3. View updated balance status and timeline

### Scenario 5: Dispute Handling
1. Simulate dispute response in Outbox
2. Balance moves to IN_DISPUTE
3. Stage advances to STAFF_REVIEW

## 💡 POC Limitations

This is a proof-of-concept with intentional simplifications:

1. **No Real Integrations**: No actual Dentrix sync, SMS, email, or payment processing
2. **Simple Authentication**: No user login system
3. **Single Practice**: Designed for single practice (multi-practice data model exists but UI assumes one)
4. **No CSV Upload UI**: Dentrix import via generate button only
5. **In-Memory Rules**: Rules engine runs in Node process (not distributed)
6. **Basic UI**: Functional but not production-polished

## 🚀 Production Considerations

For production deployment, you would need:

1. **Real Integrations**:
   - Dentrix API or HL7 integration
   - Twilio for SMS
   - SendGrid for email
   - Stripe/Square for payments

2. **Authentication & Authorization**:
   - User accounts with roles
   - Practice/office level permissions
   - Audit log access controls

3. **Scalability**:
   - Move to PostgreSQL
   - Distributed task queue (Bull/BullMQ)
   - Multiple worker processes

4. **Compliance**:
   - HIPAA compliance measures
   - Encrypted data at rest and in transit
   - Comprehensive audit logs
   - BAA agreements with all vendors

5. **UX Improvements**:
   - Real-time updates via WebSocket
   - CSV upload UI
   - Advanced rule builder
   - Reporting and analytics

## 📝 License

MIT License - This is demonstration code for evaluation purposes.

## 🤝 Support

This POC demonstrates the core concept of an A/R execution engine. For questions or to discuss production implementation, please contact the development team.

---

**Built with ❤️ to improve dental practice A/R management**
