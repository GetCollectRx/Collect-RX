# CollectRx — Practice Owner Workflows: Build Brief

**For:** Cursor / Developer Implementation  
**Prepared by:** Khalid Egeh (via Claude Cowork)  
**Date:** 2026-05-24  
**Status:** Ready for Implementation  
**Depends on:** `front-desk-build-brief.md` (calls, queue, and carrier data must exist first)

---

## 0. What This Is

The practice owner (dentist / business owner) needs financial visibility into how their practice's AR is being recovered. The existing `Dashboard.tsx` component already exists but runs entirely on hardcoded mock data. This brief covers:

1. Aligning the role system to the RBAC spec
2. Wiring the existing dashboard to real data
3. Three new screens: Aging Report, Carrier Stats, Practice Settings
4. A Queue Overview panel (embedded in dashboard)
5. Escalations view with financial context (extension of the front desk escalations screen)

---

## 1. What Already Exists (Do Not Re-Create)

| What | Where | Status |
|------|-------|--------|
| Dashboard component | `src/frontend/components/Dashboard.tsx` | Exists — mock data only |
| Dashboard API route | `GET /api/practices/:practiceId/dashboard` | Exists — hardcoded metrics |
| Practice type | `src/types/practice.ts` | Exists — needs extension |
| Auth/role types | `src/types/auth.ts` | Exists — needs realignment |
| Email stats route | `GET /api/practices/:practiceId/email-stats` | Exists — real data |
| Patients list route | `GET /api/practices/:practiceId/patients` | Exists — real data |
| Calls, queue, carrier data | `src/api/db.ts` Maps + routes | Being built in front-desk brief |

---

## 2. Role Realignment — Do This First

The current `src/types/auth.ts` defines roles as `'practice_admin' | 'staff' | 'platform_admin'`. The RBAC spec uses different names. Align them now before building any new screens.

**Update `src/types/auth.ts`:**

```ts
// Replace the existing UserRole type
export type UserRole =
  | 'front_desk'           // was: 'staff'
  | 'practice_owner'       // was: 'practice_admin'
  | 'billing_ops_manager'  // new — multi-practice, Phase 2
  | 'platform_admin'       // unchanged
  | 'auditor';             // new — read-only

export interface JWTPayload {
  practiceId: string;      // null for billing_ops_manager and platform_admin
  role: UserRole;
  userId: string;
}
```

Update every reference to `'practice_admin'` → `'practice_owner'` and `'staff'` → `'front_desk'` across:
- `src/api/middleware/authenticate.ts`
- `src/api/middleware/authorize.ts`
- `src/api/routes/auth.ts`
- Any seed data in `src/api/data/seed.ts`

This is a find-and-replace, not a logic change. The behaviour stays identical.

---

## 3. Extend `PracticeSettings`

The existing `PracticeSettings` in `src/types/practice.ts` only covers email. Extend it to cover voice agent configuration:

```ts
// src/types/practice.ts — extend PracticeSettings
export interface CarrierConfig {
  carrierId: CarrierId;            // import from src/types/calls.ts
  enabled: boolean;
  minimumClaimAgeDays: number;     // default: 32. TELUS override: 21
  maxAttempts: number;             // default: 3, max: 3
  callWindowStart: string;         // '08:00' Eastern — practice can narrow, not widen
  callWindowEnd: string;           // '17:00' Eastern
  notes: string;                   // e.g. "Use group prefix 4400 for TELUS TPA"
}

export interface PracticeSettings {
  // Existing — keep as-is
  emailsEnabled: boolean;
  automationEnabled: boolean;
  sendFromPracticeEmail: boolean;

  // New — voice agent
  voiceAgentEnabled: boolean;
  carrierConfigs: CarrierConfig[];       // one entry per supported carrier
  callWindowStart: string;               // practice-level default: '08:00'
  callWindowEnd: string;                 // practice-level default: '17:00'
  escalationPhoneNumber: string;         // front desk number for human takeover
  telusTpaMappings: Record<string, string>; // group prefix → TPA name
}
```

---

## 4. Wire the Existing Dashboard to Real Data

The `GET /api/practices/:practiceId/dashboard` route in `src/api/routes/practices.ts` currently returns hardcoded values (`recoveryRate: 78`, `automationSavings: 2100`). Replace them with computed values from real data.

**Update the dashboard route to compute:**

```ts
// Replace hardcoded metrics with these computations:

// monthlyRecovered — sum of Call.amountClaimed where outcome === 'approved' this month
const monthlyRecovered = calls
  .filter(c => c.outcome === 'approved' && isThisMonth(c.endedAt))
  .reduce((sum, c) => sum + c.amountClaimed, 0) / 100; // convert cents to dollars

// recoveryRate — approved / total completed calls this month (%)
const completedThisMonth = calls.filter(c =>
  ['completed', 'failed'].includes(c.state) && isThisMonth(c.endedAt)
);
const recoveryRate = completedThisMonth.length > 0
  ? Math.round((completedThisMonth.filter(c => c.outcome === 'approved').length / completedThisMonth.length) * 100)
  : 0;

// avgDaysToCollect — average of (endedAt - createdAt) for approved calls, in days
const avgDaysToCollect = approvedCalls.length > 0
  ? Math.round(approvedCalls.reduce((sum, c) =>
      sum + daysBetween(c.createdAt, c.endedAt!), 0) / approvedCalls.length)
  : 0;

// automationSavings — count of approved calls × $18 (estimated cost of manual call)
const automationSavings = approvedCallsThisMonth.length * 18;

// queueStats — from db.callQueue for this practice
const queueStats = {
  queued: [...db.callQueue.values()].filter(q => q.practiceId === id && !q.heldForCarrierBlock).length,
  held: [...db.callQueue.values()].filter(q => q.practiceId === id && q.heldForCarrierBlock).length,
  activeCall: [...db.calls.values()].find(c => c.practiceId === id && c.state === 'rep_connected' || c.state === 'ivr_navigation') ?? null,
};
```

Add `queueStats` to the `DashboardResponse` type in `src/types/practice.ts` and return it from the route.

**Update `Dashboard.tsx`** to fetch from the real API instead of using the hardcoded arrays at the top of the file. Replace `weeklyData`, `recentCalls`, and `pendingClaims` constants with `useEffect` + `fetch` calls. The component structure and Tailwind classes stay as-is — only the data source changes.

The "Recent Calls" panel maps to `GET /api/calls/:practiceId/history?limit=5`.  
The "Pending Claims" panel maps to open escalations: `GET /api/calls/:practiceId/escalations?status=open`.  
The "Start New Call" button in Quick Actions should be removed for `practice_owner` — they don't trigger calls manually.

---

## 5. New Screen: Aging Report — `src/frontend/components/AgingReport.tsx`

**Route:** `/aging`  
**API:** `GET /api/practices/:practiceId/reports/aging`  
**Access:** `practice_owner` only

### What It Shows

AR broken into aging buckets by carrier. Standard dental AR buckets:

| Bucket | Days Outstanding |
|--------|-----------------|
| Current | 0–30 days |
| 31–60 | 31–60 days |
| 61–90 | 61–90 days |
| 90+ | Over 90 days |

For each bucket, show: total dollar amount outstanding, number of claims, percentage of total AR.

**Layout:**
- Top row: four summary cards — one per bucket. Card shows total $ and claim count. 90+ bucket card is red if it contains any amount.
- Below: table of carriers as rows, buckets as columns. Each cell shows the $ amount for that carrier in that bucket. Row totals on the right. Column totals at the bottom.
- Below the table: a horizontal stacked bar chart showing the proportion of each bucket across all AR. Use Recharts `BarChart` (already installed).
- Export button: `[⬇ Export CSV]` — downloads the table as a `.csv` file using browser-side generation (no backend needed).

### New API Route — add to `src/api/routes/practices.ts`

```ts
practicesRouter.get('/:practiceId/reports/aging', authenticate, authorizePractice, (req, res) => {
  // Compute from db.calls for this practice
  // Group approved + pending calls by carrierId and age bucket
  // Return { buckets: AgingBucket[], byCarrier: CarrierAgingRow[], totalAR: number }
});
```

```ts
// src/types/practice.ts — add
export interface AgingBucket {
  label: 'Current' | '31–60' | '61–90' | '90+';
  totalAmount: number;  // cents
  claimCount: number;
  percentOfTotal: number;
}

export interface CarrierAgingRow {
  carrierId: CarrierId;
  carrierName: string;
  current: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  total: number;
}
```

**Age is computed from `Call.createdAt`** (the date the claim entered the system), not the call date.

---

## 6. New Screen: Carrier Stats — `src/frontend/components/CarrierStats.tsx`

**Route:** `/carriers`  
**API:** `GET /api/practices/:practiceId/reports/carriers`  
**Access:** `practice_owner` only

### What It Shows

Per-carrier performance across all calls for this practice. One card per carrier (6 total), plus a summary table.

**Each carrier card shows:**
- Carrier name + logo/colour indicator
- Total claims worked
- Success rate (approved / total completed, %)
- Average call duration (minutes:seconds)
- Average attempts before resolution
- Most common denial reason (if any)
- Trend indicator: is this carrier getting better or worse over the last 30 days vs. the 30 days before

**Below the cards:** a comparison table — all 6 carriers as rows, metrics as columns. Sortable by any column.

**Time filter:** Last 30 days / Last 90 days / All time. Dropdown, defaults to last 30 days.

**CARRIER_BLOCK history:** At the bottom of the page, a table of all past CARRIER_BLOCK events — carrier, date blocked, date cleared, how many claims were held. Gives the owner visibility into automation detection incidents.

### New API Route — add to `src/api/routes/practices.ts`

```ts
practicesRouter.get('/:practiceId/reports/carriers', authenticate, authorizePractice, (req, res) => {
  const { timeframe = '30d' } = req.query;
  // Compute from db.calls + db.carrierBlocks for this practice
  // Return { carriers: CarrierStatRow[], blockHistory: CarrierBlock[] }
});
```

```ts
// src/types/practice.ts — add
export interface CarrierStatRow {
  carrierId: CarrierId;
  carrierName: string;
  totalClaims: number;
  successRate: number;       // 0–100
  avgCallDurationSeconds: number;
  avgAttempts: number;
  topDenialReason: string | null;
  trend: 'improving' | 'declining' | 'stable';
}
```

---

## 7. New Screen: Practice Settings — `src/frontend/components/PracticeSettings.tsx`

**Route:** `/settings`  
**API:** `GET/PUT /api/practices/:practiceId/settings`  
**Access:** `practice_owner` only

### Sections

**Section 1 — General**
- Practice name, email, phone, address (read-only display — editable by platform admin only)
- Plan name + monthly fee (read-only)

**Section 2 — Voice Agent**
- `voiceAgentEnabled` toggle — master on/off for the entire queue engine
- Global call window: start time and end time pickers (Eastern). Must be within 8am–5pm. If the owner narrows to e.g. 9am–4pm, the queue engine respects it. They cannot widen beyond 8am–5pm.
- Escalation phone number — the number Twilio dials when a human takeover is requested

**Section 3 — Carrier Configuration**
A table with one row per supported carrier (6 rows). Columns:
- Carrier name
- Enabled toggle
- Minimum claim age (days input, min 21 for TELUS, min 32 for others — enforce on save)
- Max attempts (1–3, default 3)
- Notes (free text, e.g. TELUS TPA notes)

Save button at the bottom of each section — don't make it a single form save for the whole page.

**Section 4 — TELUS TPA Mappings**
A key-value table: group number prefix → TPA name. Add/remove rows. Explanation text: "TELUS AdjudiCare routes claims to different underlying TPAs based on the group number prefix. Add mappings here to ensure calls are routed correctly."

**Section 5 — Email Automation** (existing settings, already in `PracticeSettings`)
- `emailsEnabled` toggle
- `automationEnabled` toggle
- `sendFromPracticeEmail` toggle

### New API Route — add to `src/api/routes/practices.ts`

```ts
// GET — return full settings (excluding stripeConnectAccountId)
practicesRouter.get('/:practiceId/settings', authenticate, authorizePractice, ...);

// PUT — update settings. Validate:
// - callWindowStart/End within 08:00–17:00 Eastern
// - TELUS minimumClaimAgeDays >= 21, others >= 32
// - escalationPhoneNumber is a valid E.164 phone number
practicesRouter.put('/:practiceId/settings', authenticate, authorizePractice, validate(schemas.updateSettings), ...);
```

Add `updateSettings` to `src/api/middleware/validate.ts` using the existing Joi validation pattern.

---

## 8. Queue Overview — Embedded in Dashboard

The practice owner does not get the full Live Console (that's front desk). They get a read-only queue overview panel embedded in their dashboard.

**Add a `QueueOverview` component** (can be a small component in the same file or a separate `src/frontend/components/QueueOverview.tsx`) that shows:

- Queue status badge: Running / Paused / Outside Hours
- Counts: X queued · X in progress · X held (blocked)
- Active call summary (if one is active): carrier, claimRef, which agent, duration — read only, no intervention controls
- "X claims resolved today" stat

This panel does **not** have pause/resume controls, queue reordering, or intervention buttons. Those are front desk only. The owner watches; the front desk acts.

Fetch from `GET /api/calls/:practiceId/active` and `GET /api/calls/:practiceId/queue` — same endpoints built for front desk, just rendered in read-only mode.

Connect via the same WebSocket built for the front desk console so the panel updates live without polling.

---

## 9. Escalations View — `src/frontend/components/Escalations.tsx`

Both `practice_owner` and `front_desk` see escalations, but with different context.

**Front desk sees:** Claim ref, carrier, escalation reason, resolve button.

**Practice owner additionally sees:**
- Dollar amount at stake
- Number of attempts made before escalation
- Full call transcript link
- Estimated recovery probability (simple heuristic: `denied_missing_docs` → 70% if docs can be provided, `denied_carrier_error` → 85%, others → 40%)
- Decision buttons: `[Appeal]` `[Write Off]` `[Pause for Review]`

`[Appeal]` — marks the escalation with `resolution: 'appealing'`, pauses the claim, and surfaces it in the front desk queue for human follow-up.  
`[Write Off]` — marks the escalation resolved with `resolution: 'written_off'`. Removes from queue permanently.  
`[Pause for Review]` — same as the existing pause claim flow.

This is the same `Escalations.tsx` component used by front desk, with additional columns and action buttons rendered conditionally based on `role === 'practice_owner'`.

---

## 10. Navigation

The practice owner nav has these items:

```
Dashboard     /
Aging Report  /aging
Carrier Stats /carriers
Escalations   /escalations
Settings      /settings
Profile       /profile
```

They do not see: Live Console, Call History (front desk only). They have access to a read-only queue overview embedded in the dashboard panel, not as a standalone nav item.

The existing nav in `Dashboard.tsx` has a mobile bottom nav with `Home`, `Claims`, `Calls`, `Settings`. Remap these:

| Old | New |
|-----|-----|
| Home | Dashboard |
| Claims | Escalations |
| Calls | Carrier Stats |
| Settings | Settings |

---

## 11. New API Routes Summary

All added to existing routers. Mount points already registered in `src/api/server.ts`.

```
GET  /api/practices/:practiceId/reports/aging      → AgingReport data
GET  /api/practices/:practiceId/reports/carriers   → CarrierStats data
GET  /api/practices/:practiceId/settings           → Full PracticeSettings
PUT  /api/practices/:practiceId/settings           → Update PracticeSettings
GET  /api/practices/:practiceId/escalations        → Open escalations (with financial context for owner)
PUT  /api/practices/:practiceId/escalations/:id    → Update escalation (appeal / write-off / pause)
```

---

## 12. Build Order

1. **Role realignment** — update `UserRole` in `src/types/auth.ts` and all references. Do this first so role checks work correctly everywhere.
2. **Extend `PracticeSettings`** — update type and DB seed data.
3. **Settings API routes** — GET + PUT for `/settings`.
4. **Wire dashboard metrics** — replace hardcoded values in the route and fetch from real call data.
5. **`Dashboard.tsx` data fetching** — replace static arrays with `useEffect` + `fetch`.
6. **Queue Overview panel** — embed in dashboard, read-only, WebSocket-connected.
7. **Aging Report** — API route first, then component.
8. **Carrier Stats** — API route first, then component.
9. **`PracticeSettings.tsx`** — all four sections.
10. **Escalations view** — extend the front desk component with owner-specific columns and actions.
11. **Navigation update** — remap bottom nav items, add Aging + Carrier Stats links.

---

## 13. Testing Checklist

- [ ] Role realignment: `front_desk` JWT hitting `/aging` or `/carriers` → 403
- [ ] Role realignment: `practice_owner` JWT hitting `/console` (front desk Live Console) → 403
- [ ] Dashboard metrics: create 3 approved calls + 1 failed call → recoveryRate = 75%
- [ ] Aging report: claim created 45 days ago → appears in 31–60 bucket, not Current
- [ ] Settings validation: set TELUS minimumClaimAgeDays to 15 → 422 error
- [ ] Settings validation: set callWindowEnd to '19:00' → 422 error
- [ ] Carrier stats trend: all approvals in the last 30 days, none in prior 30 → trend = 'improving'
- [ ] Escalation write-off: `[Write Off]` → claim removed from queue, escalation marked resolved
- [ ] Queue overview: pause the queue via front desk console → owner's dashboard queue badge updates within 2s (WebSocket)
- [ ] Export CSV: click Export on Aging Report → downloads valid CSV with correct bucket totals

---

*End of brief. Questions → Khalid Egeh (khalidegeh97@gmail.com)*
