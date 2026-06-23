/**
 * AnalyticsDashboard, CollectRx Product Analytics
 *
 * Four panels covering the full user-behaviour picture:
 *   1. Summary bar      , headline numbers (sessions, active users, events today)
 *   2. Time on page     , horizontal bar chart; reveals where users actually spend time
 *   3. Click heatmap    , ranked table of every button/link clicked
 *   4. Funnel drop-off  , step-by-step completion funnel for key CollectRx journeys
 *   5. Session replay   , recent session path sequences (lightweight breadcrumb trace)
 *
 * All data is fetched from /api/telemetry/*, productTelemetry routes.
 * The component is self-contained: no external chart library required.
 * It uses plain SVG + CSS variables so it inherits the app's theme.
 *
 * Visible to: platform_admin and practice_admin roles only.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  BarChart2,
  MousePointer,
  Clock,
  TrendingDown,
  Users,
  Activity,
  RefreshCw,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import type {
  SummaryResponse,
  PageStat,
  ClickStat,
  FunnelResult,
  SessionSummary,
} from '../types/productAnalytics';

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

const BASE = '/api/telemetry';

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Analytics API error: ${res.status}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Colour helpers (CollectRx brand palette)
// ---------------------------------------------------------------------------

const BLUE = '#3B82F6';
const BLUE_LIGHT = '#DBEAFE';
const GREEN = '#10B981';
const AMBER = '#F59E0B';
const RED = '#EF4444';
const GREY = '#94A3B8';

function completionColour(pct: number): string {
  if (pct >= 80) return GREEN;
  if (pct >= 50) return AMBER;
  return RED;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// --- Summary bar ---

interface SummaryProps {
  data: SummaryResponse;
}

function SummaryBar({ data }: SummaryProps) {
  const cards = [
    { label: 'Sessions (all-time)', value: data.totalSessions.toLocaleString(), icon: <Users size={18} color={BLUE} /> },
    { label: 'Active users today', value: data.activeUsersToday.toLocaleString(), icon: <Activity size={18} color={GREEN} /> },
    { label: 'Events today', value: data.eventsToday.toLocaleString(), icon: <MousePointer size={18} color={AMBER} /> },
    { label: 'Events this week', value: data.eventsThisWeek.toLocaleString(), icon: <BarChart2 size={18} color={BLUE} /> },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
      {cards.map((c) => (
        <div
          key={c.label}
          style={{
            background: '#fff',
            border: '1px solid #E2E8F0',
            borderRadius: 12,
            padding: '18px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {c.icon}
            <span style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>{c.label}</span>
          </div>
          <span style={{ fontSize: 28, fontWeight: 700, color: '#0F172A' }}>{c.value}</span>
        </div>
      ))}
    </div>
  );
}

// --- Time on page ---

interface TimeOnPageProps {
  pages: PageStat[];
}

function TimeOnPage({ pages }: TimeOnPageProps) {
  if (pages.length === 0) {
    return <EmptyState message="No page-time data yet. Pages are tracked once users navigate away." />;
  }

  const max = pages[0].avgDurationMs;
  const top = pages.slice(0, 10);

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {top.map((p) => (
        <div key={p.path} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#334155', fontFamily: 'monospace' }}>
              {p.path}
            </span>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: GREY }}>{p.visits} visits</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', minWidth: 56, textAlign: 'right' }}>
                {formatDuration(p.avgDurationMs)}
              </span>
            </div>
          </div>
          <div style={{ height: 8, background: '#F1F5F9', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.round((p.avgDurationMs / max) * 100)}%`,
                background: BLUE,
                borderRadius: 4,
                transition: 'width 0.6s ease',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Click heatmap table ---

interface ClickTableProps {
  clicks: ClickStat[];
  total: number;
}

function ClickTable({ clicks, total }: ClickTableProps) {
  if (clicks.length === 0) {
    return <EmptyState message="No click data yet. Global click tracking activates on SDK init." />;
  }

  const top = clicks.slice(0, 15);
  const maxCount = top[0]?.count ?? 1;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #E2E8F0' }}>
            <th style={{ textAlign: 'left', padding: '8px 12px', color: '#64748B', fontWeight: 600 }}>#</th>
            <th style={{ textAlign: 'left', padding: '8px 12px', color: '#64748B', fontWeight: 600 }}>Element</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: '#64748B', fontWeight: 600 }}>Clicks</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: '#64748B', fontWeight: 600 }}>Share</th>
            <th style={{ padding: '8px 12px', width: 120 }}></th>
          </tr>
        </thead>
        <tbody>
          {top.map((c, i) => (
            <tr
              key={c.label}
              style={{
                borderBottom: '1px solid #F1F5F9',
                background: i % 2 === 0 ? '#fff' : '#FAFAFA',
              }}
            >
              <td style={{ padding: '9px 12px', color: GREY, fontWeight: 600 }}>{i + 1}</td>
              <td style={{ padding: '9px 12px', color: '#0F172A', fontWeight: 500, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.label}
              </td>
              <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>
                {c.count.toLocaleString()}
              </td>
              <td style={{ padding: '9px 12px', textAlign: 'right', color: GREY }}>
                {total > 0 ? `${((c.count / total) * 100).toFixed(1)}%` : 'N/A'}
              </td>
              <td style={{ padding: '9px 12px' }}>
                <div style={{ height: 6, background: '#F1F5F9', borderRadius: 3, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.round((c.count / maxCount) * 100)}%`,
                      background: BLUE,
                      borderRadius: 3,
                    }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Funnel visualisation ---

interface FunnelVizProps {
  funnels: FunnelResult[];
}

function FunnelViz({ funnels }: FunnelVizProps) {
  const [selected, setSelected] = useState(0);

  if (funnels.length === 0) {
    return (
      <EmptyState message="No funnel data yet. Use trackFunnelStep() in your page components to define journeys." />
    );
  }

  const funnel = funnels[selected];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Funnel selector */}
      {funnels.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {funnels.map((f, i) => (
            <button
              key={f.funnelName}
              onClick={() => setSelected(i)}
              style={{
                padding: '6px 14px',
                borderRadius: 20,
                border: '1px solid',
                borderColor: selected === i ? BLUE : '#E2E8F0',
                background: selected === i ? BLUE_LIGHT : '#fff',
                color: selected === i ? BLUE : '#64748B',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {f.funnelName.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {funnel.steps.map((step, i) => (
          <div key={step.stepName}>
            {/* Step row */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '14px 0',
              }}
            >
              {/* Index bubble */}
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: completionColour(step.completionPct),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>

              {/* Bar */}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>
                    {step.stepName.replace(/_/g, ' ')}
                  </span>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <span style={{ fontSize: 13, color: GREY }}>{step.sessions} sessions</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: completionColour(step.completionPct) }}>
                      {step.completionPct}%
                    </span>
                  </div>
                </div>
                <div style={{ height: 10, background: '#F1F5F9', borderRadius: 5, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${step.completionPct}%`,
                      background: completionColour(step.completionPct),
                      borderRadius: 5,
                      transition: 'width 0.8s ease',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Drop-off indicator between steps */}
            {i < funnel.steps.length - 1 && step.dropOffPct > 0 && (
              <div
                style={{
                  marginLeft: 16,
                  paddingLeft: 30,
                  borderLeft: '2px dashed #E2E8F0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '2px 0 2px 46px',
                }}
              >
                <TrendingDown size={13} color={step.dropOffPct > 30 ? RED : AMBER} />
                <span style={{ fontSize: 12, color: step.dropOffPct > 30 ? RED : AMBER, fontWeight: 500 }}>
                  {funnel.steps[i + 1].sessions - step.sessions < 0
                    ? `${Math.abs(funnel.steps[i + 1].sessions - step.sessions)} users dropped off here (${step.dropOffPct}% loss)`
                    : `${step.dropOffPct}% total drop from start`}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Session list ---

interface SessionListProps {
  sessions: SessionSummary[];
}

function SessionList({ sessions }: SessionListProps) {
  if (sessions.length === 0) {
    return <EmptyState message="No sessions recorded yet." />;
  }

  function formatMs(ms: number): string {
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
  }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const roleColour: Record<string, string> = {
    platform_admin: '#7C3AED',
    practice_admin: BLUE,
    staff: GREEN,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sessions.map((s) => (
        <div
          key={s.sessionId}
          style={{
            border: '1px solid #E2E8F0',
            borderRadius: 10,
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            background: '#FAFAFA',
          }}
        >
          {/* Header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 10,
                  background: roleColour[s.role ?? ''] ?? GREY,
                  color: '#fff',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {s.role ?? 'anon'}
              </span>
              <span style={{ fontSize: 12, color: GREY, fontFamily: 'monospace' }}>
                {s.sessionId.slice(0, 12)}…
              </span>
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <span style={{ fontSize: 12, color: GREY }}>{formatTime(s.startTime)}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>{formatMs(s.durationMs)}</span>
              <span style={{ fontSize: 12, color: GREY }}>{s.eventCount} events</span>
            </div>
          </div>

          {/* Path breadcrumb */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
            {s.pathSequence.map((path, i) => (
              <React.Fragment key={`${path}-${i}`}>
                <span
                  style={{
                    fontSize: 12,
                    fontFamily: 'monospace',
                    background: BLUE_LIGHT,
                    color: BLUE,
                    padding: '2px 8px',
                    borderRadius: 6,
                  }}
                >
                  {path}
                </span>
                {i < s.pathSequence.length - 1 && (
                  <ChevronRight size={12} color={GREY} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Empty state ---

function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: '40px 20px',
        color: GREY,
        textAlign: 'center',
      }}
    >
      <AlertCircle size={32} color={GREY} />
      <span style={{ fontSize: 13, maxWidth: 360 }}>{message}</span>
    </div>
  );
}

// --- Panel wrapper ---

function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #E2E8F0',
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '16px 20px',
          borderBottom: '1px solid #F1F5F9',
        }}
      >
        {icon}
        <span style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>{title}</span>
      </div>
      <div style={{ padding: '20px' }}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard component
// ---------------------------------------------------------------------------

interface DashboardData {
  summary: SummaryResponse | null;
  pages: PageStat[];
  clicks: ClickStat[];
  clicksTotal: number;
  funnels: FunnelResult[];
  sessions: SessionSummary[];
}

export default function ProductUsageAnalytics() {
  const [data, setData] = useState<DashboardData>({
    summary: null,
    pages: [],
    clicks: [],
    clicksTotal: 0,
    funnels: [],
    sessions: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, pagesRes, clicksRes, funnelsRes, sessionsRes] =
        await Promise.all([
          apiFetch<SummaryResponse>('/summary'),
          apiFetch<{ pages: PageStat[] }>('/pages'),
          apiFetch<{ clicks: ClickStat[]; total: number }>('/clicks'),
          apiFetch<{ funnels: FunnelResult[] }>('/funnels'),
          apiFetch<{ sessions: SessionSummary[] }>('/sessions?limit=10'),
        ]);

      setData({
        summary: summaryRes,
        pages: pagesRes.pages,
        clicks: clicksRes.clicks,
        clicksTotal: clicksRes.total,
        funnels: funnelsRes.funnels,
        sessions: sessionsRes.sessions,
      });
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Auto-refresh every 60 s
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      style={{
        padding: '24px',
        maxWidth: 1200,
        margin: '0 auto',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#0F172A' }}>
            Product Analytics
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: GREY }}>
            How users actually use CollectRx, clicks, page time, and drop-off
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: GREY }}>
            Refreshed {lastRefresh.toLocaleTimeString()}
          </span>
          <button
            onClick={load}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #E2E8F0',
              background: loading ? '#F8FAFC' : '#fff',
              color: '#334155',
              fontSize: 13,
              fontWeight: 500,
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: 10,
            padding: '12px 16px',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            color: RED,
            fontSize: 14,
          }}
        >
          <AlertCircle size={16} />
          {error}, is the analytics API running?
        </div>
      )}

      {/* Summary cards */}
      {data.summary && <SummaryBar data={data.summary} />}

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <Panel title="Time on Page" icon={<Clock size={16} color={BLUE} />}>
          <TimeOnPage pages={data.pages} />
        </Panel>

        <Panel title="Top Clicked Elements" icon={<MousePointer size={16} color={AMBER} />}>
          <ClickTable clicks={data.clicks} total={data.clicksTotal} />
        </Panel>
      </div>

      {/* Funnel, full width */}
      <Panel title="User Journey Funnels" icon={<TrendingDown size={16} color={RED} />}>
        <FunnelViz funnels={data.funnels} />
      </Panel>

      {/* Session list */}
      <Panel title="Recent Sessions" icon={<Users size={16} color={GREEN} />}>
        <SessionList sessions={data.sessions} />
      </Panel>

      {/* CSS keyframes injected inline */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

