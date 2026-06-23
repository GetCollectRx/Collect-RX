# CollectRx Analytics — Integration Guide

This document explains how to wire the analytics system into the product, what to track for each persona, and how to interpret the dashboard.

---

## What the system captures

| Signal | How it's captured | Why it matters |
|--------|------------------|----------------|
| **Page views + time** | `useAnalytics` hook on every page | Reveals where users actually spend time vs. where you think they do |
| **Click events** | Global event delegation (SDK auto) | Which buttons users hit most — and which ones they ignore |
| **Funnel steps** | `trackFunnelStep()` calls | Where users abandon multi-step workflows |
| **Sessions** | Session ID stitched across events | Full path sequence for any individual user journey |

---

## Step 1 — Mount the provider

In `src/frontend/main.tsx` (or wherever your root component lives), wrap everything with `<AnalyticsProvider>` after the user is authenticated:

```tsx
import { AnalyticsProvider } from './analytics/AnalyticsProvider';

// After your auth/login logic resolves:
const analyticsUser = {
  userId: jwt.userId,
  role: jwt.role,         // 'practice_admin' | 'staff' | 'platform_admin'
  practiceId: jwt.practiceId,
};

root.render(
  <AnalyticsProvider user={analyticsUser}>
    <App />
  </AnalyticsProvider>
);
```

This single call:
- Starts the 5-second flush timer
- Attaches global click delegation (every button/link is captured automatically)
- Records the first page view
- Wires up the beacon-on-unload for reliable exit timing

---

## Step 2 — Track route changes

The SDK doesn't know about your router. Call `analytics.trackPageChange(newPath)` on every navigation:

```tsx
// React Router v6 example (in a top-level component)
import { useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { analytics } from './analytics/analytics';

function RouteTracker() {
  const location = useLocation();
  useEffect(() => {
    analytics.trackPageChange(location.pathname);
  }, [location.pathname]);
  return null;
}
```

Add `<RouteTracker />` inside your router but outside your page components.

---

## Step 3 — Add the `useAnalytics` hook to each page

The hook fires a page_view on mount and page_exit on unmount automatically:

```tsx
// src/frontend/pages/QueuePage.tsx
import { useAnalytics } from '../analytics/useAnalytics';

export function QueuePage() {
  const { trackClick, trackFunnelStep } = useAnalytics({ pageName: '/queue' });

  return (
    <button
      onClick={trackClick('Run Queue', handleRunQueue)}
      data-analytics="Run Queue"
    >
      Run Queue
    </button>
  );
}
```

### `data-analytics` attribute
Add `data-analytics="descriptive label"` to any button where the visible text is ambiguous or an icon. The SDK reads this first before falling back to `aria-label` or `innerText`.

---

## Step 4 — Define your funnels

Funnels are the most valuable signal. They show exactly where users abandon workflows.

### CollectRx funnels to instrument

#### 1. Claim Upload funnel
```tsx
import { useFunnel } from '../analytics/useAnalytics';

export function ClaimUploadPage() {
  const { advance } = useFunnel({
    funnelName: 'claim_upload',
    steps: ['select_file', 'review_claims', 'confirm_submit', 'upload_complete'],
  });
  // Step 0 fires automatically on mount

  const handleFileSelected = () => { advance(); };     // → step 1
  const handleReviewDone   = () => { advance(); };     // → step 2
  const handleConfirmed    = () => { advance(); };     // → step 3
}
```

#### 2. Queue Run funnel
```tsx
const { advance } = useFunnel({
  funnelName: 'queue_run',
  steps: ['open_queue', 'review_pending', 'launch_queue', 'view_results'],
});
```

#### 3. Escalation Resolution funnel
```tsx
const { advance } = useFunnel({
  funnelName: 'escalation',
  steps: ['view_escalation', 'open_claim', 'add_note', 'resolve'],
});
```

#### 4. Practice Onboarding funnel
```tsx
const { advance } = useFunnel({
  funnelName: 'practice_onboarding',
  steps: ['account_created', 'practice_configured', 'first_upload', 'first_queue_run'],
});
```

---

## Step 5 — Register the API route

In `src/api/server.ts`, add:

```ts
import analyticsRouter from './routes/analytics';

// After your existing route mounts:
app.use('/api/analytics', analyticsRouter);
```

No auth middleware on this route — blocking analytics on failed auth creates blind spots. The routes themselves don't return PHI.

---

## Step 6 — Surface the dashboard

Add a route visible only to `platform_admin` and `practice_admin`:

```tsx
// In your router config:
{
  path: '/analytics',
  element: <ProtectedRoute roles={['platform_admin', 'practice_admin']}>
    <AnalyticsDashboard />
  </ProtectedRoute>
}
```

Then add a nav link in your sidebar for those roles.

---

## What to look for once you have data

### Time on page
- **Dashboard > 5 min avg** — users are confused; the information hierarchy is wrong
- **Claims list < 20 sec** — users are skipping it; they may not trust the data
- **Settings < 1 min** — good; configuration should be fast

### Click heatmap
- **Any "Upload" variant in top 3** — healthy; claims input is the core action
- **"Help" or "?" in top 10** — UX issue; something is confusing users
- **Queue actions sparse** — adoption problem; users aren't running the queue

### Funnel drop-off
- **Claim upload > 20% drop at "review"** — the review screen is too complex or slow
- **Queue run > 40% drop at "launch"** — users are scared to commit; add a confirmation/summary
- **Escalation < 50% reach "resolve"** — escalations aren't being closed; process gap

### Sessions
- **Short sessions (< 1 min) from `practice_admin`** — they're checking in, not working; the dashboard needs at-a-glance summaries
- **Long sessions (> 10 min) from `staff`** — upload/review flow is too manual; look for automation opportunities
- **Single-page sessions** — users land and leave; check which page they hit first

---

## Privacy and PHI

The analytics SDK explicitly:
- Never records patient names, DOBs, or health card numbers
- Strips any `meta` fields named `patientName`, `dob`, or `healthCard` on the backend
- Uses opaque `userId` (the JWT UUID) — not the user's name or email
- Uses opaque `sessionId` generated in `sessionStorage`

If you extend the SDK to capture form values, never capture fields from the claims upload form.

---

## Scaling beyond in-memory storage

The current backend stores events in a capped in-memory array (50 000 events). When you're ready to scale:

1. Replace the `eventStore` array in `src/api/routes/analytics.ts` with writes to **ClickHouse** (best for time-series analytics at scale)
2. The `AnalyticsEvent` type is the insert schema — each field maps directly to a column
3. The query endpoints can stay Express routes but run SQL instead of JS array filters
4. Alternatively, drop the custom backend entirely and point the SDK's `endpoint` at **PostHog**, **Mixpanel**, or **Amplitude** — they accept the same event shape

---

## Files created

| File | Purpose |
|------|---------|
| `src/frontend/analytics/analytics.ts` | Core SDK — event queue, session, click delegate, beacon flush |
| `src/frontend/analytics/useAnalytics.ts` | React hooks — `useAnalytics`, `useFunnel` |
| `src/frontend/analytics/AnalyticsProvider.tsx` | Root provider — wrap `<App>` with this |
| `src/api/routes/analytics.ts` | Express routes — ingest + query endpoints |
| `src/types/analytics.ts` | Shared TypeScript types |
| `src/frontend/components/AnalyticsDashboard.tsx` | Visual dashboard — panels for all four signals |
