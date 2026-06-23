/**
 * CollectRx Product Analytics SDK
 *
 * Captures three classes of data:
 *   1. Page views + time-on-page   (how long users spend where)
 *   2. Click events                 (what buttons/links users interact with)
 *   3. Funnel steps                 (ordered journey: Upload → Queue → Resolved)
 *
 * Events are batched and flushed to POST /api/telemetry/events every 5 s,
 * or immediately on page unload via navigator.sendBeacon.
 *
 * Nothing here touches PHI — we record element labels, page paths, and
 * timing only. User identity is the JWT userId already in memory.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventType =
  | 'page_view'
  | 'page_exit'
  | 'click'
  | 'funnel_step'
  | 'session_start'
  | 'session_end'
  | 'error';

export interface AnalyticsEvent {
  eventId: string;
  type: EventType;
  sessionId: string;
  userId?: string;
  role?: string;
  practiceId?: string;
  timestamp: number; // ms since epoch
  path: string; // current URL path
  // page_view / page_exit
  durationMs?: number;
  // click
  elementLabel?: string; // data-analytics or innerText or aria-label
  elementId?: string;
  elementType?: string; // button | link | input
  // funnel_step
  funnelName?: string;
  funnelStep?: string;
  funnelStepIndex?: number;
  // arbitrary extra data (non-PHI)
  meta?: Record<string, string | number | boolean>;
}

export interface AnalyticsUser {
  userId: string;
  role: string;
  practiceId: string;
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOrCreateSessionId(): string {
  const key = 'crx_session_id';
  const ttlKey = 'crx_session_ts';
  const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min inactivity = new session

  const stored = sessionStorage.getItem(key);
  const ts = Number(sessionStorage.getItem(ttlKey) || 0);

  if (stored && Date.now() - ts < SESSION_TTL_MS) {
    sessionStorage.setItem(ttlKey, String(Date.now()));
    return stored;
  }

  const id = generateId();
  sessionStorage.setItem(key, id);
  sessionStorage.setItem(ttlKey, String(Date.now()));
  return id;
}

// ---------------------------------------------------------------------------
// Core SDK class
// ---------------------------------------------------------------------------

class AnalyticsSDK {
  private sessionId: string;
  private user: AnalyticsUser | null = null;
  private queue: AnalyticsEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private pageEnterTime: number = Date.now();
  private currentPath: string = '';
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private readonly endpoint = '/api/telemetry/events';
  private readonly flushIntervalMs = 5000;

  constructor() {
    this.sessionId = getOrCreateSessionId();
    this.currentPath = window.location.pathname;
    this.pageEnterTime = Date.now();
  }

  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  /** Call once after JWT login to attach user context to all future events. */
  identify(user: AnalyticsUser): void {
    this.user = user;
    this.push({ type: 'session_start' });
  }

  reset(): void {
    this.push({ type: 'session_end' });
    this.flush();
    this.user = null;
    this.sessionId = getOrCreateSessionId();
  }

  // -------------------------------------------------------------------------
  // Page tracking
  // -------------------------------------------------------------------------

  /**
   * Call on every route change (React Router / Next.js router events).
   * Records a page_exit for the previous page (with duration) and a
   * page_view for the new one.
   */
  trackPageChange(newPath: string): void {
    const durationMs = Date.now() - this.pageEnterTime;

    // Exit the previous page
    this.push({
      type: 'page_exit',
      path: this.currentPath,
      durationMs,
    });

    // Enter the new page
    this.currentPath = newPath;
    this.pageEnterTime = Date.now();
    this.push({ type: 'page_view', path: newPath });
  }

  /** Record the initial page view (call on SDK init). */
  trackInitialPage(): void {
    this.currentPath = window.location.pathname;
    this.pageEnterTime = Date.now();
    this.push({ type: 'page_view' });
  }

  // -------------------------------------------------------------------------
  // Click tracking
  // -------------------------------------------------------------------------

  /**
   * Attach a global click listener via event delegation.
   * Elements opt in by adding data-analytics="Label" OR are captured by
   * their aria-label / innerText (truncated to 60 chars).
   *
   * Only captures buttons, <a> tags, and elements with role="button".
   */
  enableClickTracking(): void {
    if (this.clickHandler) return; // already attached

    this.clickHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const interactive = target.closest<HTMLElement>(
        'button, a, [role="button"], [data-analytics]'
      );
      if (!interactive) return;

      const label =
        interactive.dataset.analytics ||
        interactive.getAttribute('aria-label') ||
        interactive.innerText?.trim().slice(0, 60) ||
        interactive.id ||
        'unknown';

      this.push({
        type: 'click',
        elementLabel: label,
        elementId: interactive.id || undefined,
        elementType: interactive.tagName.toLowerCase() === 'a' ? 'link' : 'button',
      });
    };

    document.addEventListener('click', this.clickHandler, { capture: true });
  }

  disableClickTracking(): void {
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler, true);
      this.clickHandler = null;
    }
  }

  // -------------------------------------------------------------------------
  // Funnel tracking
  // -------------------------------------------------------------------------

  /**
   * Record a named step in a user journey funnel.
   *
   * Example funnels in CollectRx:
   *   - "claim_upload"   → steps: ["select_file", "review", "submit", "confirmed"]
   *   - "escalation"     → steps: ["view_claim", "flag", "add_note", "submitted"]
   *   - "queue_run"      → steps: ["open_queue", "review_claims", "run_queue", "results"]
   *
   * Usage:
   *   analytics.trackFunnelStep('claim_upload', 'review', 1);
   */
  trackFunnelStep(funnelName: string, stepName: string, stepIndex: number, meta?: Record<string, string | number | boolean>): void {
    this.push({
      type: 'funnel_step',
      funnelName,
      funnelStep: stepName,
      funnelStepIndex: stepIndex,
      meta,
    });
  }

  // -------------------------------------------------------------------------
  // Generic event
  // -------------------------------------------------------------------------

  track(type: EventType, overrides?: Partial<AnalyticsEvent>): void {
    this.push({ type, ...overrides });
  }

  // -------------------------------------------------------------------------
  // Internal: queue + flush
  // -------------------------------------------------------------------------

  private push(partial: Partial<AnalyticsEvent> & { type: EventType }): void {
    const event: AnalyticsEvent = {
      eventId: generateId(),
      sessionId: this.sessionId,
      userId: this.user?.userId,
      role: this.user?.role,
      practiceId: this.user?.practiceId,
      timestamp: Date.now(),
      path: partial.path ?? this.currentPath ?? window.location.pathname,
      ...partial,
    };
    this.queue.push(event);
  }

  /** Start periodic flushing and beacon-on-unload. */
  start(): void {
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);

    // Reliable unload capture
    window.addEventListener('pagehide', () => this.beaconFlush());
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.beaconFlush();
    });
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.disableClickTracking();
    this.flush();
  }

  /** Regular flush via fetch (can read the response). */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
      });
    } catch {
      // Re-enqueue on network failure (best-effort)
      this.queue.unshift(...batch);
    }
  }

  /** Fire-and-forget beacon for page unload — fetch would be cancelled. */
  private beaconFlush(): void {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);

    // Record page_exit for current page before we go
    const exitEvent: AnalyticsEvent = {
      eventId: generateId(),
      type: 'page_exit',
      sessionId: this.sessionId,
      userId: this.user?.userId,
      role: this.user?.role,
      practiceId: this.user?.practiceId,
      timestamp: Date.now(),
      path: this.currentPath,
      durationMs: Date.now() - this.pageEnterTime,
    };

    const payload = JSON.stringify({ events: [...batch, exitEvent] });
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon(this.endpoint, blob);
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const analytics = new AnalyticsSDK();
