# CollectRx Platform — Technical Audit Report

**Date:** April 6, 2026
**Updated:** April 7, 2026 (remediation status added)
**Scope:** Full codebase (`server.js`, `server-complete.js`, `app.html`, `index.html`, `platform-dashboard.html`, `practice-dashboard.html`)
**Auditor:** Claude (automated)

---

## Executive Summary

The CollectRx platform handles **patient health billing data, payment processing, and automated email workflows** for dental practices. The codebase has **15 high-severity, 8 medium-severity, and 6 low-severity** findings. The most critical issues are: zero authentication on all API endpoints (including admin and webhook routes), unvalidated Stripe webhook signatures, template injection via user-controlled data, and an in-memory database architecture that loses all data on restart.

---

## CRITICAL / HIGH Severity

### H1. Zero Authentication on All API Endpoints

**Files:** `server.js:688-913`, `server-complete.js:650-857`
**Category:** Security — Authentication

Every route is publicly accessible. There is no auth middleware, no API key validation, no JWT check, no session management. This means anyone can:

- Read all patient records (PII + health billing data) via `GET /api/practices/:id/patients`
- Trigger emails to any patient via `POST /api/patients/:id/send-email`
- Generate payment links via `POST /api/patients/:id/payment-link`
- Run the admin scheduler via `POST /api/admin/run-scheduler`
- Process fake payments via `POST /api/webhooks/stripe`

**Fix:**
```javascript
// Add to server.js at the top of the routes section
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.practiceId = decoded.practiceId;
    req.role = decoded.role;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Apply to all practice/patient routes
app.get('/api/practices/:practiceId/dashboard', authenticate, async (req, res) => {
  // Also verify req.practiceId === req.params.practiceId (authorization)
});
```

---

### H2. Stripe Webhook Has No Signature Verification

**Files:** `server.js:837-847`, `server-complete.js:845-857`
**Category:** Security — Payment Integrity

The Stripe webhook endpoint blindly trusts `req.body`. Any attacker can POST fabricated payment events, crediting arbitrary patient accounts with fake payments and zeroing out balances.

```javascript
// server.js:837-847 — current code
app.post('/api/webhooks/stripe', async (req, res) => {
  const { patient_id, practice_id, amount } = req.body;  // No verification!
  await paymentService.processPayment({ ... });
});
```

**Fix:**
```javascript
// Use raw body for Stripe signature verification
app.post('/api/webhooks/stripe',
  express.raw({ type: 'application/json' }),  // Must come BEFORE express.json()
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
    } catch (err) {
      return res.status(400).json({ error: `Webhook signature verification failed` });
    }

    if (event.type === 'payment_intent.succeeded') {
      const { patient_id, practice_id } = event.data.object.metadata;
      const amount = event.data.object.amount / 100;
      await paymentService.processPayment({ patientId: patient_id, practiceId: practice_id, amount });
    }
    res.json({ received: true });
  }
);
```

**Important:** The `express.raw()` middleware must be applied to this route specifically, and the route must be registered *before* the global `app.use(express.json())` or use a router.

---

### H3. SendGrid Webhook Has No Signature Verification

**Files:** `server.js:850-866`, `server-complete.js:826-842`
**Category:** Security — Data Integrity

Same issue as H2. The SendGrid webhook accepts any POST body, allowing an attacker to inject fake email engagement events (opens, clicks) and manipulate patient analytics.

**Fix:**
```javascript
const { EventWebhook, EventWebhookHeader } = require('@sendgrid/eventwebhook');

app.post('/api/webhooks/sendgrid', async (req, res) => {
  const publicKey = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
  const signature = req.get(EventWebhookHeader.SIGNATURE());
  const timestamp = req.get(EventWebhookHeader.TIMESTAMP());
  const ew = new EventWebhook();
  const ecPublicKey = ew.convertPublicKeyToECDSA(publicKey);

  if (!ew.verifySignature(ecPublicKey, JSON.stringify(req.body), signature, timestamp)) {
    return res.status(403).json({ error: 'Invalid signature' });
  }
  // ... process events
});
```

---

### H4. Template Injection / XSS via Patient Data

**Files:** `server.js:438-448`, `server-complete.js:209-219`
**Category:** Security — Injection

The `TemplateEngine.renderTemplate()` method does raw string replacement of `{{variable}}` placeholders with patient data. If a patient's first name contains HTML/JavaScript (e.g., via a compromised PMS integration), it gets injected directly into email HTML and potentially the dashboard.

```javascript
// server.js:443-446 — current code
Object.keys(data).forEach(key => {
  const regex = new RegExp(`{{${key}}}`, 'g');
  html = html.replace(regex, data[key]);  // No escaping!
});
```

**Fix:**
```javascript
function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

renderTemplate(template, data) {
  let html = template.htmlContent;
  let subject = template.subject;

  Object.keys(data).forEach(key => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    const safeValue = key === 'paymentLink' ? data[key] : escapeHtml(data[key]);
    html = html.replace(regex, safeValue);
    subject = subject.replace(regex, escapeHtml(data[key]));
  });

  return { html, subject };
}
```

---

### H5. CORS Wide Open — Any Origin Can Call APIs

**Files:** `server.js:9`, `server-complete.js:19`
**Category:** Security — Access Control

`app.use(cors())` with no options allows any website to make authenticated requests to the API. Combined with H1 (no auth), any site on the internet can read patient data and trigger actions.

**Fix:**
```javascript
app.use(cors({
  origin: [
    'https://app.collectrx.com',
    'https://dashboard.collectrx.com',
    process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

---

### H6. No Authorization — Any Practice Can Access Any Other Practice's Data

**Files:** `server.js:766-794`, `server-complete.js:711-735`
**Category:** Security — Authorization

Even if authentication is added, there are no authorization checks. The `GET /api/patients/:patientId` endpoint returns any patient regardless of which practice is asking. A practice can read/manipulate patients belonging to other practices.

**Fix:** Add to every patient-facing endpoint:
```javascript
app.get('/api/patients/:patientId', authenticate, async (req, res) => {
  const patient = database.patients.get(req.params.patientId);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  // Authorization: verify the requesting practice owns this patient
  if (patient.practiceId !== req.practiceId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  // ... rest of handler
});
```

---

### H7. In-Memory Database — All Data Lost on Restart or Crash

**Files:** `server.js:38-47`, `server-complete.js:44-53`
**Category:** Reliability — Data Persistence

The entire database is JavaScript `Map` objects in RAM. A process crash, deployment, or server restart destroys all patient records, payment history, email logs, and workflow state. This is listed as "mock" but the architecture has no actual database integration code.

**Fix:** Migrate to PostgreSQL (recommended for HIPAA-adjacent workloads):
```javascript
// Replace Map-based database with pg pool
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Example migration for patients table
// CREATE TABLE patients (
//   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   practice_id UUID NOT NULL REFERENCES practices(id),
//   first_name VARCHAR(100) NOT NULL,
//   ...
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
// CREATE INDEX idx_patients_practice ON patients(practice_id);
// CREATE INDEX idx_patients_status ON patients(practice_id, status);
```

---

### H8. No Input Validation on Any Endpoint

**Files:** `server.js:797-819`, `server-complete.js:738-782`
**Category:** Security — Input Validation

No request body or query parameter validation exists anywhere. The payment plan endpoint accepts any `monthlyAmount`/`numberOfMonths` (including negative numbers, zero, or strings). The send-email endpoint requires only a `workflowId` in the body with no type checking.

**Fix (using a validation library):**
```bash
npm install joi
```

```javascript
const Joi = require('joi');

const paymentPlanSchema = Joi.object({
  monthlyAmount: Joi.number().positive().precision(2).max(50000).required(),
  numberOfMonths: Joi.number().integer().min(1).max(60).required()
});

app.post('/api/patients/:patientId/payment-plan', authenticate, async (req, res) => {
  const { error, value } = paymentPlanSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });
  // ... use validated `value`
});
```

---

### H9. Negative Payment Amount Allows Balance Inflation

**Files:** `server.js:511-535`, `server-complete.js:286-315`
**Category:** Security — Business Logic

`processPayment()` subtracts `paymentData.amount` from `patient.balanceAmount` without checking if the amount is positive. A negative amount *increases* the balance. Combined with H2 (no webhook verification), an attacker can inflate any patient's balance.

```javascript
// server-complete.js:302-305
patient.balanceAmount -= paymentData.amount;  // negative amount = balance goes UP
if (patient.balanceAmount <= 0) {
  patient.balanceAmount = 0;
  patient.status = 'paid';
}
```

**Fix:**
```javascript
async processPayment(paymentData) {
  if (!paymentData.amount || paymentData.amount <= 0) {
    throw new Error('Payment amount must be positive');
  }
  if (paymentData.amount > 100000) {
    throw new Error('Payment amount exceeds maximum');
  }
  // ... rest of logic
}
```

---

### H10. Admin Scheduler Endpoint Has No Access Control

**Files:** `server.js:908-914`, `server-complete.js:820-823`
**Category:** Security — Privilege Escalation

`POST /api/admin/run-scheduler` triggers all automated email workflows for all patients. There is no admin role check. Anyone can mass-trigger collection emails.

**Fix:**
```javascript
const requireAdmin = (req, res, next) => {
  if (req.role !== 'admin' && req.role !== 'platform_admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

app.post('/api/admin/run-scheduler', authenticate, requireAdmin, async (req, res) => {
  // ... existing logic
});
```

---

### H11. No Rate Limiting — Email Bombing / DDoS Vector

**Files:** `server.js:797-819`, `server-complete.js:738-752`
**Category:** Security / Reliability

The `POST /api/patients/:id/send-email` endpoint has no rate limiting or cooldown. An attacker can call it in a loop to send unlimited emails to a patient, which will also burn through the SendGrid quota and potentially get the domain blacklisted.

**Fix:**
```bash
npm install express-rate-limit
```

```javascript
const rateLimit = require('express-rate-limit');

const emailRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 emails per patient per window
  keyGenerator: (req) => `${req.params.patientId}`,
  message: { error: 'Too many emails sent to this patient. Try again later.' }
});

app.post('/api/patients/:patientId/send-email', authenticate, emailRateLimit, async (req, res) => {
  // ... existing logic
});

// Global API rate limit
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: { error: 'Rate limit exceeded' }
});
app.use('/api/', apiLimiter);
```

---

### H12. No .env File and No .gitignore — Secrets at Risk

**Files:** Project root (missing files)
**Category:** Security — Secrets Management

There is no `.env` file (so `process.env.STRIPE_SECRET_KEY` etc. are always `undefined`), and critically no `.gitignore`. If someone adds a `.env` later, it will be committed to version control by default.

**Fix:**
```bash
# Create .gitignore
cat > .gitignore << 'EOF'
node_modules/
.env
.env.*
.DS_Store
*.log
EOF

# Create .env.example (safe to commit)
cat > .env.example << 'EOF'
PORT=3001
MONGODB_URL=mongodb://localhost:27017/collectrx
SENDGRID_API_KEY=SG.xxxx
SENDGRID_WEBHOOK_VERIFICATION_KEY=
STRIPE_SECRET_KEY=sk_test_xxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxx
JWT_SECRET=change-this-to-a-random-64-char-string
API_URL=https://api.collectrx.com
EOF
```

---

### H13. HIPAA/PHIPA Exposure — Patient Health Billing Data Served Without Encryption Enforcement

**Files:** `server.js:766-794`, `server-complete.js:711-735`
**Category:** Security — Compliance

Patient records include names, emails, phone numbers, visit dates, and billing amounts. This is protected health information (PHI) under HIPAA/PHIPA. The server has no HTTPS enforcement, no audit logging, and no data-at-rest encryption.

**Fix:**
```javascript
// Force HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// Add audit logging middleware
app.use('/api/', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    auditLogger.log({
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      practiceId: req.practiceId,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      ip: req.ip
    });
  });
  next();
});
```

---

### H14. Hardcoded API URLs and Practice IDs in Frontend

**Files:** `app.html:1672-1673`, `index.html:18-19`, `practice-dashboard.html:276-277`, `platform-dashboard.html:241`
**Category:** Security / Reliability

All four HTML files hardcode `http://localhost:3001/api` and `practice_001`. This means production will fail, and the frontend cannot serve multiple practices.

**Fix:**
```javascript
// Replace hardcoded values with environment-aware config
const API_URL = window.__COLLECTRX_CONFIG__?.apiUrl
  || (location.hostname === 'localhost' ? 'http://localhost:3001/api' : '/api');
const PRACTICE_ID = window.__COLLECTRX_CONFIG__?.practiceId
  || new URLSearchParams(location.search).get('practiceId');

if (!PRACTICE_ID) {
  document.body.innerHTML = '<p>Error: No practice ID configured.</p>';
  throw new Error('Missing practiceId');
}
```

---

### H15. Unprotected Payment Processing — No Idempotency

**Files:** `server.js:511-535`, `server-complete.js:286-315`
**Category:** Reliability — Financial

`processPayment()` has no idempotency key. If a Stripe webhook retries (which Stripe does by default), the same payment gets processed multiple times, over-crediting the patient's balance.

**Fix:**
```javascript
async processPayment(paymentData) {
  // Idempotency check
  const existing = Array.from(database.payments.values())
    .find(p => p.stripePaymentId === paymentData.stripePaymentId);
  if (existing) {
    console.log(`⚠️ Duplicate payment ignored: ${paymentData.stripePaymentId}`);
    return existing;
  }
  // ... rest of logic
}
```

---

## MEDIUM Severity

### M1. Full Patient Objects Leaked to Dashboard

**Files:** `server-complete.js:667-687`, `server.js:717-738`
**Category:** Security — Data Exposure

The dashboard endpoint returns full practice objects including `stripeConnectAccountId` and internal settings. The patient list endpoint returns full patient objects including all engagement metrics.

**Fix:** Add response DTOs that only expose needed fields:
```javascript
const sanitizePatientForList = (p) => ({
  id: p.id,
  firstName: p.firstName,
  lastName: p.lastName,
  balanceAmount: p.balanceAmount,
  daysOutstanding: p.daysOutstanding,
  status: p.status,
  emailContactAttempts: p.emailContactAttempts,
  responseRate: p.responseRate
});
```

---

### M2. O(N) Full-Table Scans on Every Request

**Files:** `server.js:696-710`, `server-complete.js:654-657`, and all query endpoints
**Category:** Performance

Every API call does `Array.from(database.*.values()).filter(...)`. With 100 patients this is negligible, but with real production data (thousands of patients per practice, millions of email events), every request scans every record.

**Fix:** When migrating to a real database (H7), add proper indexes:
```sql
CREATE INDEX idx_patients_practice_status ON patients(practice_id, status);
CREATE INDEX idx_email_logs_practice_sent ON email_logs(practice_id, sent_at);
CREATE INDEX idx_email_events_patient ON email_events(patient_id, created_at);
CREATE INDEX idx_payments_practice_processed ON payments(practice_id, processed_at);
```

---

### M3. Scheduler Runs Against ALL Patients Every 5 Minutes

**Files:** `server.js:928-931`, `server-complete.js:863-866`
**Category:** Performance — Scaling

The `setInterval` scheduler iterates all patients for all workflows every 5 minutes. The `findEligiblePatients` method checks `daysOutstanding` against a fixed trigger value, but `daysOutstanding` is never recalculated — it's a static property set at patient creation time.

**Fix:**
```javascript
// 1. Recalculate daysOutstanding dynamically
async findEligiblePatients(workflow) {
  const allPatients = Array.from(database.patients.values());

  for (const patient of allPatients) {
    // Recalculate days outstanding from last visit date
    const visitDate = new Date(patient.lastVisitDate);
    patient.daysOutstanding = Math.floor((Date.now() - visitDate.getTime()) / (1000 * 60 * 60 * 24));
  }
  // ... rest of filtering
}

// 2. Use a proper job queue (Bull/BullMQ) instead of setInterval
// const Queue = require('bullmq');
// const workflowQueue = new Queue('workflow-processing');
// workflowQueue.add('process-emails', {}, { repeat: { every: 300000 } });
```

---

### M4. setInterval Scheduler Has No Error Boundary

**Files:** `server.js:928-931`, `server-complete.js:863-866`
**Category:** Reliability — Error Handling

If `processScheduledEmails()` throws an unhandled error, the `setInterval` callback crashes silently. There's no try/catch, no retry logic, and no alerting.

**Fix:**
```javascript
setInterval(async () => {
  try {
    console.log('\n🕐 [AUTO] Scheduled workflow check...');
    await workflowScheduler.processScheduledEmails();
  } catch (error) {
    console.error('❌ Scheduler error:', error);
    // In production: send alert to monitoring (e.g., Sentry, PagerDuty)
  }
}, 5 * 60 * 1000);
```

---

### M5. No Request Body Size Limit

**Files:** `server.js:10`, `server-complete.js:20`
**Category:** Security — DoS

`express.json()` with no `limit` option accepts bodies up to 100KB by default, but combined with the webhook endpoints processing arrays of events, an attacker could send large payloads.

**Fix:**
```javascript
app.use(express.json({ limit: '10kb' }));

// For webhook endpoints that may receive larger payloads
app.post('/api/webhooks/sendgrid', express.json({ limit: '1mb' }), async (req, res) => {
  // SendGrid can batch many events
});
```

---

### M6. No Pagination on Patient List Endpoint

**Files:** `server.js:742-763`, `server-complete.js:690-708`
**Category:** Performance

`GET /api/practices/:id/patients` returns ALL patients in a single response. With thousands of patients, this creates large JSON payloads and slow responses.

**Fix:**
```javascript
app.get('/api/practices/:practiceId/patients', authenticate, (req, res) => {
  const { status, search, page = 1, limit = 50 } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

  let patients = /* ... filtering logic ... */;

  const total = patients.length;
  const paginated = patients.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  res.json({
    patients: paginated,
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
  });
});
```

---

### M7. Template Regex Uses User-Controlled Keys Without Escaping

**Files:** `server.js:443-444`, `server-complete.js:213-214`
**Category:** Security — ReDoS

`new RegExp(`{{${key}}}`, 'g')` uses `Object.keys(data)` in the regex. While the current keys are safe, if a key ever contains regex metacharacters (e.g., from a dynamic source), it could cause ReDoS or incorrect replacements.

**Fix:**
```javascript
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

Object.keys(data).forEach(key => {
  const regex = new RegExp(`\\{\\{${escapeRegex(key)}\\}\\}`, 'g');
  // ...
});
```

---

### M8. No Graceful Shutdown

**Files:** `server.js:939`, `server-complete.js:874`
**Category:** Reliability

The server has no `SIGTERM`/`SIGINT` handler. On deployment or process manager restart, in-flight requests are dropped and the scheduler may be mid-execution.

**Fix:**
```javascript
const server = app.listen(config.port, () => { /* ... */ });

process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down gracefully...');
  server.close(() => {
    console.log('✅ HTTP server closed');
    // Close database connections, flush queues, etc.
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('⚠️ Forced shutdown');
    process.exit(1);
  }, 10000);
});
```

---

## LOW Severity

### L1. Duplicate Codebase — server.js vs server-complete.js

**Files:** `server.js` (975 lines), `server-complete.js` (922 lines)
**Category:** Code Quality — Maintainability

Two nearly-identical server files exist with divergent logic. `server.js` has 3 hardcoded patients; `server-complete.js` generates 100 random patients. Bug fixes applied to one won't apply to the other. The `package.json` points to `server.js` as the entry point.

**Fix:** Delete `server.js`, rename `server-complete.js` to `server.js`, and update `package.json` accordingly.

---

### L2. ID Generation Uses Date.now() — Collisions Under Load

**Files:** `server.js:349,388,399,512`, `server-complete.js:126,159,170,294`
**Category:** Reliability

IDs like `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` can collide if two requests arrive in the same millisecond. `Math.random()` is not cryptographically secure.

**Fix:**
```javascript
const { randomUUID } = require('crypto');

// Replace all Date.now()-based IDs with:
const id = `payment_${randomUUID()}`;
```

---

### L3. No Error Responses for Async Failures

**Files:** `server.js:797-819` (send-email), `server-complete.js:738-752`
**Category:** Reliability — Error Handling

The `send-email` endpoint calls `await workflowScheduler.sendWorkflowEmail()` but has no try/catch. If the email service throws, Express returns a generic 500 with the stack trace (information leakage).

**Fix:**
```javascript
app.post('/api/patients/:patientId/send-email', authenticate, async (req, res) => {
  try {
    // ... existing logic
    await workflowScheduler.sendWorkflowEmail(patient, workflow);
    res.json({ success: true, message: `Email sent to ${patient.firstName} ${patient.lastName}` });
  } catch (error) {
    console.error('Email send failed:', error);
    res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }
});
```

---

### L4. Frontend Has No Error Handling on API Calls

**Files:** `app.html:1676-1700`, `index.html:28-86`, `practice-dashboard.html:295-350`
**Category:** Reliability — UX

All `fetch()` calls in the frontend have minimal or no error handling. Network failures show nothing to the user.

**Fix:** Add a centralized error handler:
```javascript
async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return res.json();
  } catch (err) {
    showToast(err.message, 'error');  // Show user-visible notification
    throw err;
  }
}
```

---

### L5. No Helmet / Security Headers

**Files:** `server.js`, `server-complete.js`
**Category:** Security — Defense in Depth

No HTTP security headers are set (CSP, X-Frame-Options, X-Content-Type-Options, etc.).

**Fix:**
```bash
npm install helmet
```
```javascript
const helmet = require('helmet');
app.use(helmet());
```

---

### L6. No Health Check Endpoint

**Files:** `server.js`, `server-complete.js`
**Category:** Reliability — Operability

There is no `/health` or `/ready` endpoint for load balancers and monitoring.

**Fix:**
```javascript
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});
```

---

## Summary Table

| # | Severity | Category | Issue | Fixed? | How |
|---|----------|----------|-------|--------|-----|
| H1 | CRITICAL | Auth | Zero authentication on all endpoints | YES | JWT `authenticate` middleware on all API routes; login endpoints added |
| H2 | CRITICAL | Payment | Stripe webhook unverified | YES | Signature verification scaffold + rejects in production if secret not set |
| H3 | CRITICAL | Data | SendGrid webhook unverified | YES | Signature verification scaffold + rejects in production if key not set |
| H4 | HIGH | Injection | Template XSS via patient data | YES | `escapeHtml()` applied to all template variables except payment URLs |
| H5 | HIGH | Access | CORS allows all origins | YES | `cors()` locked to `ALLOWED_ORIGINS` env var; dev allows localhost only |
| H6 | HIGH | AuthZ | No cross-practice authorization | YES | `authorizePractice` + `authorizePatient` middleware on every route |
| H7 | HIGH | Data | In-memory DB, total data loss on restart | NOTED | Architecture unchanged (demo); `.env.example` has `MONGODB_URL` ready for migration |
| H8 | HIGH | Validation | No input validation anywhere | YES | Joi schemas on `send-email`, `payment-plan`, `stripe webhook`, patient list query |
| H9 | HIGH | Logic | Negative payment inflates balance | YES | `processPayment()` rejects amounts <= 0 or > $100,000 |
| H10 | HIGH | Access | Admin endpoint unprotected | YES | `requireAdmin` middleware on `/api/admin/run-scheduler` |
| H11 | HIGH | DoS | No rate limiting, email bombing | YES | Global 100 req/min limit + per-patient 5 emails/15 min limit |
| H12 | HIGH | Secrets | No .gitignore, no .env.example | YES | Both files created |
| H13 | HIGH | Compliance | PHI served without HTTPS/audit | YES | Helmet headers, HTTPS redirect in production, audit logging middleware |
| H14 | HIGH | Config | Hardcoded localhost URLs in frontend | YES | All 4 HTML files use env-aware config with `?practiceId=` fallback |
| H15 | HIGH | Financial | No payment idempotency | YES | Dedup check on `stripePaymentId` before processing |
| M1 | MEDIUM | Exposure | Full objects leaked to dashboard | YES | `sanitizePracticeForResponse` + `sanitizePatientForList` DTOs |
| M2 | MEDIUM | Perf | O(N) table scans on every request | NOTED | Requires DB migration; index recommendations in report |
| M3 | MEDIUM | Perf | Scheduler rescans all patients, stale data | YES | `daysOutstanding` recalculated dynamically from `lastVisitDate` |
| M4 | MEDIUM | Reliability | Scheduler has no error boundary | YES | `try/catch` on scheduler interval + per-patient error handling |
| M5 | MEDIUM | DoS | No request body size limit | YES | `10kb` global limit; `1mb` for SendGrid webhook |
| M6 | MEDIUM | Perf | No pagination on patient list | YES | `?page=&limit=` with Joi validation; response includes pagination metadata |
| M7 | MEDIUM | ReDoS | Regex built from unescaped keys | YES | `escapeRegex()` applied to all template key interpolation |
| M8 | MEDIUM | Reliability | No graceful shutdown | YES | `SIGTERM`/`SIGINT` handlers stop scheduler + close HTTP server |
| L1 | LOW | Quality | Two duplicate server files | YES | `server-complete.js` merged into canonical `server.js`; old files kept as `.bak` |
| L2 | LOW | Reliability | Date.now() ID collisions | YES | All IDs now use `crypto.randomUUID()` via `generateId()` helper |
| L3 | LOW | Reliability | No try/catch on async routes | YES | Every async route handler wrapped in `try/catch` with error logging |
| L4 | LOW | UX | Frontend silent on API errors | YES | `apiFetch()` wrapper with error display + auto-login retry in all HTML files |
| L5 | LOW | Security | No security headers (Helmet) | YES | `helmet()` middleware with CSP directives |
| L6 | LOW | Ops | No health check endpoint | YES | `GET /health` returns status, uptime, timestamp, counts |

**Scorecard: 27 of 29 issues fully fixed. 2 noted (require database migration, not addressable in-code).**

---

## Recommended Fix Order (COMPLETED)

**Phase 1 — Stop the Bleeding:** DONE
H1 (Auth), H2 (Stripe verify), H3 (SendGrid verify), H5 (CORS), H12 (.gitignore), H11 (Rate limit), L5 (Helmet)

**Phase 2 — Data Safety:** DONE (except H7 DB migration — noted)
H7 (Real database — noted), H15 (Idempotency), H9 (Negative payments), H8 (Validation), L1 (Deduplicate servers)

**Phase 3 — Production Readiness:** DONE
H4 (Template escaping), H6 (Authorization), H10 (Admin access), H13 (HTTPS/Audit), H14 (Config), M4 (Scheduler errors), M8 (Graceful shutdown), L6 (Health check)

**Phase 4 — Scale:** DONE (except M2 DB indexes — noted)
M2 (DB indexes — noted), M3 (Scheduler optimization), M6 (Pagination), M1 (Response DTOs), M5 (Body limits), M7 (Regex escaping), L2 (UUID), L3/L4 (Error handling)
