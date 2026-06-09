import { useState, useEffect, useRef } from 'react'

// ─── Data ──────────────────────────────────────────────────────────────────

const PRACTICE = 'Hasan Family Dental'
const TOTAL_OUTSTANDING = 107510
const TOTAL_CLAIMS = 58

type EventKind = 'dialing' | 'resolved' | 'escalated' | 'denied' | 'processing'

interface DemoEvent {
  time: string
  kind: EventKind
  carrier: string
  claimNumber: string
  amount?: number
  rep?: string
  ref?: string
  note?: string
  delayMs: number // ms after previous event
}

const EVENTS: DemoEvent[] = [
  { time: '8:03 AM',  kind: 'dialing',    carrier: 'Sun Life',          claimNumber: 'SL-2025-002341', amount: 2340,  delayMs: 800 },
  { time: '8:14 AM',  kind: 'resolved',   carrier: 'Canada Life',       claimNumber: 'CL-2025-038872', amount: 980,   rep: 'Sarah K.',      ref: 'CL-038872', delayMs: 1600 },
  { time: '8:22 AM',  kind: 'dialing',    carrier: 'Manulife',          claimNumber: 'MAN-2025-004401',amount: 3180,  delayMs: 1400 },
  { time: '8:31 AM',  kind: 'resolved',   carrier: 'Sun Life',          claimNumber: 'SL-2025-847291', amount: 1840,  rep: 'Jennifer M.',   ref: 'SL-847291', delayMs: 1600 },
  { time: '8:44 AM',  kind: 'escalated',  carrier: 'Green Shield',      claimNumber: 'GS-2025-009984', amount: 890,   note: 'Carrier requesting clinical notes — flagged for your review', delayMs: 1800 },
  { time: '8:52 AM',  kind: 'resolved',   carrier: 'Manulife',          claimNumber: 'MAN-2025-881044',amount: 1560,  rep: 'Christopher D.', ref: 'MAN-881044', delayMs: 1600 },
  { time: '9:03 AM',  kind: 'dialing',    carrier: 'Canada Life',       claimNumber: 'CL-2025-049183', amount: 1640,  delayMs: 1400 },
  { time: '9:18 AM',  kind: 'resolved',   carrier: 'Green Shield',      claimNumber: 'GS-2025-503771', amount: 2480,  rep: 'Aaron B.',      ref: 'GS-503771', delayMs: 1600 },
  { time: '9:27 AM',  kind: 'resolved',   carrier: 'Sun Life',          claimNumber: 'SL-2025-730012', amount: 2200,  rep: 'Angela N.',     ref: 'SL-730012', delayMs: 1600 },
  { time: '9:41 AM',  kind: 'resolved',   carrier: 'Canada Life',       claimNumber: 'CL-2025-071290', amount: 1380,  rep: 'Lisa F.',       ref: 'CL-071290', delayMs: 1600 },
  { time: '9:58 AM',  kind: 'processing', carrier: 'Manulife',          claimNumber: 'MAN-2025-004401',amount: 3180,  note: 'Still in adjudication — follow-up scheduled in 7 days', delayMs: 1800 },
  { time: '10:14 AM', kind: 'resolved',   carrier: 'Manulife',          claimNumber: 'MAN-2025-774301',amount: 1560,  rep: 'Natalie G.',    ref: 'MAN-774301', delayMs: 1600 },
  { time: '10:28 AM', kind: 'denied',     carrier: 'Sun Life',          claimNumber: 'SL-2025-DEN001', amount: 1600,  note: 'Waiting period not met — 12-month major restorative wait applies', delayMs: 1800 },
  { time: '10:35 AM', kind: 'resolved',   carrier: 'RBC Insurance',     claimNumber: 'RBC-2025-310192',amount: 760,   rep: 'Donna S.',      ref: 'RBC-310192', delayMs: 1600 },
  { time: '11:06 AM', kind: 'resolved',   carrier: 'Sun Life',          claimNumber: 'SL-2025-924810', amount: 3200,  rep: 'Patricia W.',   ref: 'SL-924810', delayMs: 1800 },
  { time: '11:31 AM', kind: 'resolved',   carrier: 'TELUS AdjudiCare',  claimNumber: 'TEL-GWL-0034',   amount: 1120,  rep: 'Kevin A.',      ref: 'TEL-GWL-0034', delayMs: 1600 },
]

const RESOLVED_EVENTS = EVENTS.filter(e => e.kind === 'resolved')
const FINAL_RECOVERED = RESOLVED_EVENTS.reduce((s, e) => s + (e.amount ?? 0), 0)
const FINAL_RESOLVED  = RESOLVED_EVENTS.length
const NEEDS_ATTENTION = EVENTS.filter(e => e.kind === 'escalated' || e.kind === 'denied').length
const TOTAL_CALLS     = EVENTS.filter(e => e.kind !== 'dialing').length

// ─── Carrier colours ───────────────────────────────────────────────────────

const CARRIER_COLORS: Record<string, string> = {
  'Sun Life':         '#f97316',
  'Canada Life':      '#3b82f6',
  'Manulife':         '#8b5cf6',
  'Green Shield':     '#10b981',
  'RBC Insurance':    '#ef4444',
  'TELUS AdjudiCare': '#06b6d4',
}

function carrierDot(carrier: string) {
  const color = CARRIER_COLORS[carrier] ?? '#94a3b8'
  return (
    <span
      style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 6, flexShrink: 0, marginTop: 3 }}
    />
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtCAD(n: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n)
}

function useCountUp(target: number, running: boolean, durationMs = 800) {
  const [value, setValue] = useState(0)
  const prev = useRef(0)
  useEffect(() => {
    if (!running) return
    const start = prev.current
    const diff  = target - start
    if (diff <= 0) return
    const steps = 30
    const step  = diff / steps
    const interval = durationMs / steps
    let i = 0
    const t = setInterval(() => {
      i++
      const next = Math.round(start + step * i)
      setValue(next)
      if (i >= steps) { clearInterval(t); prev.current = target }
    }, interval)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, running])
  return value
}

// ─── Sub-components ────────────────────────────────────────────────────────

const KIND_META: Record<EventKind, { label: string; color: string; bg: string; icon: string }> = {
  dialing:    { label: 'Dialing…',   color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  icon: '📞' },
  resolved:   { label: 'Resolved',   color: '#22c55e', bg: 'rgba(34,197,94,0.1)',   icon: '✓'  },
  escalated:  { label: 'Escalated',  color: '#f97316', bg: 'rgba(249,115,22,0.1)',  icon: '⚠'  },
  denied:     { label: 'Denied',     color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   icon: '✕'  },
  processing: { label: 'Processing', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', icon: '⟳'  },
}

function EventCard({ event, visible }: { event: DemoEvent; visible: boolean }) {
  const meta = KIND_META[event.kind]
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '12px 16px',
        borderRadius: 10,
        border: `1px solid ${meta.color}33`,
        background: meta.bg,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateX(0)' : 'translateX(24px)',
        transition: 'opacity 0.35s ease, transform 0.35s ease',
        marginBottom: 8,
      }}
    >
      {/* time */}
      <div style={{ minWidth: 68, color: '#64748b', fontSize: 12, fontFamily: 'monospace', paddingTop: 2 }}>
        {event.time}
      </div>

      {/* icon */}
      <div style={{ fontSize: 14, minWidth: 16, textAlign: 'center', paddingTop: 1, color: meta.color }}>
        {meta.icon}
      </div>

      {/* body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {carrierDot(event.carrier)}
          <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{event.carrier}</span>
          <span style={{ color: '#475569', fontSize: 11, fontFamily: 'monospace' }}>{event.claimNumber}</span>
          {event.amount && event.kind !== 'dialing' && (
            <span style={{ marginLeft: 'auto', color: meta.color, fontWeight: 700, fontSize: 13, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
              {event.kind === 'resolved' ? '+' : ''}{fmtCAD(event.amount)}
            </span>
          )}
        </div>
        {event.rep && (
          <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 3 }}>
            Rep: {event.rep} · Ref: {event.ref}
          </div>
        )}
        {event.note && (
          <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 3 }}>{event.note}</div>
        )}
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────

type Phase = 'idle' | 'intro' | 'feed' | 'scorecard'

export default function PilotDemo() {
  const [phase, setPhase]               = useState<Phase>('idle')
  const [visibleCount, setVisibleCount] = useState(0)
  const [recovered, setRecovered]       = useState(0)
  const [resolvedCount, setResolvedCount] = useState(0)
  const feedRef = useRef<HTMLDivElement>(null)

  const displayRecovered = useCountUp(recovered, phase === 'feed' || phase === 'scorecard')
  const displayResolved  = useCountUp(resolvedCount, phase === 'feed' || phase === 'scorecard')

  // Run the event timeline
  useEffect(() => {
    if (phase !== 'feed') return
    let idx = 0
    let totalRecovered = 0
    let totalResolved  = 0

    function showNext() {
      if (idx >= EVENTS.length) {
        setTimeout(() => setPhase('scorecard'), 1800)
        return
      }
      const evt = EVENTS[idx]
      setVisibleCount(idx + 1)
      if (evt.kind === 'resolved') {
        totalRecovered += evt.amount ?? 0
        totalResolved  += 1
        setRecovered(totalRecovered)
        setResolvedCount(totalResolved)
      }
      idx++
      // Scroll to bottom of feed
      setTimeout(() => {
        feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' })
      }, 100)
      setTimeout(showNext, evt.delayMs)
    }

    const t = setTimeout(showNext, 400)
    return () => clearTimeout(t)
  }, [phase])

  // Auto-start intro after mount if idle
  function start() {
    setPhase('intro')
    setTimeout(() => setPhase('feed'), 2800)
  }

  function reset() {
    setPhase('idle')
    setVisibleCount(0)
    setRecovered(0)
    setResolvedCount(0)
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0a0f1a',
        color: '#e2e8f0',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header style={{ borderBottom: '1px solid #1e2a3a', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="white">
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" /><path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
            </svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#f1f5f9', letterSpacing: '-0.3px' }}>CollectRx</span>
          <span style={{ color: '#334155', fontSize: 13 }}>·</span>
          <span style={{ color: '#64748b', fontSize: 13 }}>{PRACTICE}</span>
        </div>
        {phase !== 'idle' && (
          <button
            onClick={reset}
            style={{ background: 'none', border: '1px solid #1e2a3a', color: '#64748b', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}
          >
            Restart
          </button>
        )}
      </header>

      {/* ── Idle / Play screen ─────────────────────────────────────────────── */}
      {phase === 'idle' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center', gap: 24 }}>
          <div>
            <div style={{ color: '#94a3b8', fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
              Pilot demo
            </div>
            <h1 style={{ fontSize: 'clamp(28px, 5vw, 48px)', fontWeight: 800, lineHeight: 1.15, letterSpacing: '-1px', marginBottom: 16, color: '#f1f5f9' }}>
              What happens to your AR<br />while you're with patients?
            </h1>
            <p style={{ color: '#64748b', fontSize: 16, maxWidth: 480, margin: '0 auto 8px' }}>
              {TOTAL_CLAIMS} outstanding insurance claims · {fmtCAD(TOTAL_OUTSTANDING)} sitting in AR
            </p>
            <p style={{ color: '#475569', fontSize: 14, maxWidth: 440, margin: '0 auto' }}>
              Watch a Monday morning unfold — no staff intervention.
            </p>
          </div>
          <button
            onClick={start}
            style={{
              background: '#16a34a',
              color: 'white',
              border: 'none',
              borderRadius: 10,
              padding: '14px 36px',
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
              letterSpacing: '-0.3px',
              boxShadow: '0 0 0 4px rgba(22,163,74,0.2)',
              transition: 'transform 0.1s',
            }}
            onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.97)')}
            onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
          >
            ▶ Play demo
          </button>
        </div>
      )}

      {/* ── Intro frame ───────────────────────────────────────────────────── */}
      {phase === 'intro' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center', gap: 16, animation: 'fadeIn 0.6s ease' }}>
          <div style={{ color: '#22c55e', fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'monospace' }}>
            Monday · June 9, 2026 · 8:00 AM
          </div>
          <h2 style={{ fontSize: 'clamp(22px, 4vw, 38px)', fontWeight: 700, letterSpacing: '-0.8px', color: '#f1f5f9', lineHeight: 1.2 }}>
            {PRACTICE}
          </h2>
          <div style={{ display: 'flex', gap: 32, marginTop: 8 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#f1f5f9', fontFamily: 'monospace' }}>{TOTAL_CLAIMS}</div>
              <div style={{ color: '#64748b', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Open claims</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#f1f5f9', fontFamily: 'monospace' }}>{fmtCAD(TOTAL_OUTSTANDING)}</div>
              <div style={{ color: '#64748b', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Outstanding</div>
            </div>
          </div>
          <p style={{ color: '#334155', fontSize: 15, marginTop: 8 }}>CollectRx starts calling…</p>
        </div>
      )}

      {/* ── Feed + live counters ───────────────────────────────────────────── */}
      {(phase === 'feed' || phase === 'scorecard') && (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr minmax(200px, 280px)', gap: 0, maxWidth: 960, margin: '0 auto', width: '100%', padding: '24px 16px', alignItems: 'start' }}>

          {/* call feed */}
          <div style={{ paddingRight: 24 }}>
            <div style={{ color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>
              {phase === 'feed' ? 'Live activity' : 'Today\'s activity — 8:00 AM – 11:31 AM'}
            </div>
            <div ref={feedRef} style={{ maxHeight: '65vh', overflowY: 'auto', paddingRight: 4 }}>
              {EVENTS.map((evt, i) => (
                <EventCard key={i} event={evt} visible={i < visibleCount} />
              ))}
            </div>
          </div>

          {/* stats sidebar */}
          <div style={{ position: 'sticky', top: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* recovered */}
            <div style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Recovered today</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#22c55e', fontFamily: 'monospace', letterSpacing: '-1px' }}>
                {fmtCAD(displayRecovered)}
              </div>
            </div>

            {/* resolved */}
            <div style={{ background: 'rgba(30,42,58,0.6)', border: '1px solid #1e2a3a', borderRadius: 12, padding: '14px 20px' }}>
              <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Claims resolved</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#f1f5f9', fontFamily: 'monospace' }}>{displayResolved}</div>
            </div>

            {/* calls by staff */}
            <div style={{ background: 'rgba(30,42,58,0.6)', border: '1px solid #1e2a3a', borderRadius: 12, padding: '14px 20px' }}>
              <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Staff calls made</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'monospace', color: '#22c55e' }}>0</div>
            </div>

            {phase === 'feed' && (
              <div style={{ color: '#334155', fontSize: 11, textAlign: 'center', marginTop: 4 }}>
                {visibleCount < EVENTS.length ? `${EVENTS.length - visibleCount} calls remaining…` : 'Wrapping up…'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Scorecard ─────────────────────────────────────────────────────── */}
      {phase === 'scorecard' && (
        <div style={{ borderTop: '1px solid #1e2a3a', padding: '32px 16px', maxWidth: 960, margin: '0 auto', width: '100%' }}>
          <div style={{ color: '#64748b', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 24, textAlign: 'center' }}>
            End of day · 4:30 PM · Your staff saw 40 patients today
          </div>

          {/* big scorecard */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 32 }}>
            {[
              { label: 'Calls placed',     value: String(TOTAL_CALLS),              sub: 'by CollectRx',          color: '#f1f5f9' },
              { label: 'Resolved',         value: String(FINAL_RESOLVED),           sub: 'claims closed',         color: '#22c55e' },
              { label: 'Recovered',        value: fmtCAD(FINAL_RECOVERED),          sub: 'CAD, confirmed',        color: '#22c55e' },
              { label: 'Needs attention',  value: String(NEEDS_ATTENTION),          sub: 'flagged for you',       color: '#f97316' },
              { label: 'Staff calls',      value: '0',                              sub: 'zero phone tag',        color: '#22c55e' },
              { label: 'Avg per claim',    value: fmtCAD(Math.round(FINAL_RECOVERED / FINAL_RESOLVED)), sub: 'recovered', color: '#f1f5f9' },
            ].map(s => (
              <div key={s.label} style={{ background: 'rgba(30,42,58,0.6)', border: '1px solid #1e2a3a', borderRadius: 12, padding: '16px 18px', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color, fontFamily: 'monospace', letterSpacing: '-0.5px' }}>{s.value}</div>
                <div style={{ color: '#f1f5f9', fontSize: 12, fontWeight: 600, marginTop: 4 }}>{s.label}</div>
                <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* the line */}
          <div style={{ textAlign: 'center', padding: '24px 16px', borderTop: '1px solid #1e2a3a' }}>
            <p style={{ fontSize: 'clamp(18px, 3vw, 28px)', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.5px', marginBottom: 8, lineHeight: 1.3 }}>
              This repeats every business day.
            </p>
            <p style={{ color: '#64748b', fontSize: 14, marginBottom: 28 }}>
              Connect your Abeldent database — one-time, ~45 minutes — and we start calling tomorrow morning.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <a
                href="mailto:khalidegeh97@gmail.com?subject=CollectRx pilot setup&body=Hi, I'd like to get started with CollectRx."
                style={{
                  background: '#16a34a', color: 'white', padding: '12px 28px',
                  borderRadius: 9, fontWeight: 700, fontSize: 14, textDecoration: 'none',
                  letterSpacing: '-0.2px',
                }}
              >
                Get started →
              </a>
              <button
                onClick={reset}
                style={{
                  background: 'none', border: '1px solid #1e2a3a', color: '#94a3b8',
                  padding: '12px 24px', borderRadius: 9, cursor: 'pointer', fontSize: 14,
                }}
              >
                Watch again
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #1e2a3a; border-radius: 4px; }
      `}</style>
    </div>
  )
}
