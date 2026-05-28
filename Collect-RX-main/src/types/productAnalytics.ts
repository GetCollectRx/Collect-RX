/**
 * Shared analytics types — used by both the frontend SDK and the backend API.
 * Keep this file free of any PHI field definitions.
 */

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
  timestamp: number;
  path: string;
  // page timing
  durationMs?: number;
  // clicks
  elementLabel?: string;
  elementId?: string;
  elementType?: string;
  // funnels
  funnelName?: string;
  funnelStep?: string;
  funnelStepIndex?: number;
  // extra non-PHI context
  meta?: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// API response shapes (used by the dashboard to fetch data)
// ---------------------------------------------------------------------------

export interface SummaryResponse {
  totalEvents: number;
  totalSessions: number;
  activeUsersToday: number;
  eventsToday: number;
  eventsThisWeek: number;
  eventsByRole: Record<string, number>;
}

export interface PageStat {
  path: string;
  visits: number;
  avgDurationMs: number;
  avgDurationSec: number;
}

export interface PagesResponse {
  pages: PageStat[];
}

export interface ClickStat {
  label: string;
  count: number;
}

export interface ClicksResponse {
  clicks: ClickStat[];
  total: number;
}

export interface FunnelStep {
  index: number;
  stepName: string;
  sessions: number;
  dropOffPct: number;
  completionPct: number;
}

export interface FunnelResult {
  funnelName: string;
  steps: FunnelStep[];
}

export interface FunnelsResponse {
  funnels: FunnelResult[];
}

export interface SessionSummary {
  sessionId: string;
  userId?: string;
  role?: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  eventCount: number;
  pathSequence: string[];
}

export interface SessionsResponse {
  sessions: SessionSummary[];
}
