import { useState, useEffect, useRef } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────

type EventKind = 'resolved' | 'escalated' | 'denied' | 'processing'

interface DemoEvent {
  time: string
  kind: EventKind
  carrier: string
  claimNumber: string
  amount: number
  /** What the AI agent actually did on this call */
  steps: string[]
  /** What was extracted / decided */
  outcome: string
  rep?: string
  ref?: string
  delayMs: number
}

// ─── Call data ──────────────────────────────────────────────────────────────

const EVENTS: DemoEvent[] = [
  {
    time: '8:03 AM', kind: 'resolved', carrier: 'Sun Life', claimNumber: 'SL-2025-002341',
    amount: 1840,
    steps: ['Dialed Sun Life claims line', 'Navigated IVR → "1" Claims → "2" Status', 'Reached rep after 4:12 on hold'],
    outcome: 'Claim adjudicated. Payment $1,840 EFT by June 21.',
    rep: 'Jennifer M.', ref: 'SL-847291', delayMs: 2200,
  },
  {
    time: '8:31 AM', kind: 'resolved', carrier: 'Canada Life', claimNumber: 'CL-2025-038872',
    amount: 980,
    steps: ['Dialed Canada Life IVR', 'Entered group #, member ID, claim #', 'Automated status confirmed — no hold'],
    outcome: 'Claim paid. Cheque mailed June 3.',
    rep: 'Automated', ref: 'CL-038872', delayMs: 2000,
  },
  {
    time: '8:54 AM', kind: 'escalated', carrier: 'Green Shield', claimNumber: 'GS-2025-009984',
    amount: 890,
    steps: ['Dialed Green Shield', 'Navigated IVR → claim status', 'Rep requested clinical notes'],
    outcome: 'Flagged for you: x-rays required before adjudication. Deadline June 23.',
    delayMs: 2000,
  },
  {
    time: '9:18 AM', kind: 'resolved', carrier: 'Manulife', claimNumber: 'MAN-2025-881044',
    amount: 1560,
    steps: ['Dialed Manulife', 'Navigated IVR → "3" Dental → "1" Claim status', 'Reached rep — stated claim + patient details'],
    outcome: 'Approved. $1,560 EFT processing this week.',
    rep: 'Christopher D.', ref: 'MAN-881044', delayMs: 2200,
  },
  {
    time: '9:41 AM', kind: 'resolved', carrier: 'Sun Life', claimNumber: 'SL-2025-730012',
    amount: 2200,
    steps: ['Dialed Sun Life', 'IVR navigation — 3 menus deep', 'Handoff: IVR_Navigator → Claims_Agent'],
    outcome: 'Periodontal scaling approved. $2,200 EFT June 20.',
    rep: 'Angela N.', ref: 'SL-730012', delayMs: 2000,
  },
  {
    time: '10:02 AM', kind: 'processing', carrier: 'Manulife', claimNumber: 'MAN-2025-004401',
    amount: 3180,
    steps: ['Dialed Manulife', 'Rep confirmed claim received and in adjudication', 'No issues flagged'],
    outcome: 'Still processing — follow-up scheduled in 7 days automatically.',
    rep: 'Daniel F.', delayMs: 2000,
  },
  {
    time: '10:28 AM', kind: 'denied', carrier: 'Sun Life', claimNumber: 'SL-2025-DEN001',
    amount: 1600,
    steps: ['Dialed Sun Life', 'Automated denial reason confirmed', 'Handoff: Claims_Agent → Escalation_Closer'],
    outcome: 'Denied — 12-month waiting period. Flagged for write-off or appeal review.',
    delayMs: 2000,
  },
  {
    time: '10:35 AM', kind: 'resolved', carrier: 'RBC Insurance', claimNumber: 'RBC-2025-310192',
    amount: 760,
    steps: ['Dialed RBC Insurance claims', 'Single IVR menu — direct to rep', 'Claim reference confirmed'],
    outcome: 'Endodontic claim paid in full. $760 mailed June 2.',
    rep: 'Donna S.', ref: 'RBC-310192', delayMs: 2000,
  },
  {
    time: '11:06 AM', kind: 'resolved', carrier: 'Sun Life', claimNumber: 'SL-2025-924810',
    amount: 3200,
    steps: ['Dialed Sun Life', 'Full IVR navigation — implant procedure flagged for manual review', 'Handoff: IVR_Navigator → Claims_Agent → Resolution_Closer'],
    outcome: 'Implant approved in full. $3,200 EFT by June 25.',
    rep: 'Patricia W.', ref: 'SL-924810', delayMs: 2200,
  },
  {
    time: '11:31 AM', kind: 'resolved', carrier: 'TELUS AdjudiCare', claimNumber: 'TEL-GWL-0034',
    amount: 1120,
    steps: ['Identified underlying plan: Great-West Life via group prefix', 'Routed to GWL — not generic TELUS IVR', 'Confirmed EFT already sent'],
    outcome: 'GWL payment $1,120 deposited May 31.',
    rep: 'Kevin A.', ref: 'TEL-GWL-0034', delayMs: 2200,
  },
]

const CARRIER_COLOR: Record<string, string> = {
  'Sun Life': '#f97316',
  'Canada Life': '#3b82f6',
  'Manulife': '#8b5cf6',
  'Green Shield': '#10b981',
  'RBC Insurance': '#ef4444',
  'TELUS AdjudiCare': '#06b6d4',
}

const KIND_STYLE = {
  resolved:   { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  label: 'Resolved',   icon: '✓' },
  escalated:  { color: '#f97316', bg: 'rgba(249,115,22,0.12)', label: 'Escalated',  icon: '⚠' },
  denied:     { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  label: 'Denied',     icon: '✕' },
  processing: { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)','label': 'Follow-up', icon: '⟳' },
}

function fmtCAD(n: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n)
}

// ─── Animated counter ───────────────────────────────────────────────────────

function useCountUp(target: number) {
  const [val, setVal] = useState(0)
  const prev = useRef(0)
  useEffect(() => {
    const diff = target - prev.current
    if (diff <= 0) return
    const steps = 24
    let i = 0
    const t = setInterval(() => {
      i++
      setVal(Math.round(prev.current + (diff * i) / steps))
      if (i >= steps) { clearInterval(t); prev.current = target }
    }, 28)
    return () => clearInterval(t)
  }, [target])
  return val
}

// ─── Sub-components ────────────────────────────────────────────────────────

function StatBox({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${accent ? 'rgba(34,197,94,0.25)' : '#1e2a3a'}`,
      borderRadius: 12, padding: '14px 18px',
    }}>
      <div style={{ color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, fontFamily: 'monospace', color: accent ? '#22c55e' : '#f1f5f9', letterSpacing: '-1px' }}>{value}</div>
    </div>
  )
}

function SpotlightCard({ event, phase }: { event: DemoEvent; phase: 'calling' | 'done' }) {
  const style = KIND_STYLE[event.kind]
  const color = CARRIER_COLOR[event.carrier] ?? '#94a3b8'
  return (
    <div style={{
      background: '#0d1520',
      border: `1px solid ${phase === 'calling' ? '#fbbf2444' : style.color + '44'}`,
      borderRadius: 16,
      padding: '20px 24px',
      minHeight: 200,
      display: 'flex', flexDirection: 'column', gap: 14,
      boxShadow: phase === 'calling' ? '0 0 0 3px rgba(251,191,36,0.08)' : `0 0 0 3px ${style.color}11`,
      transition: 'all 0.4s ease',
    }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
        <span style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 14 }}>{event.carrier}</span>
        <span style={{ color: '#334155', fontSize: 12, fontFamily: 'monospace' }}>{event.claimNumber}</span>
        <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 12 }}>{event.time}</span>
        {phase === 'done' && (
          <span style={{ background: style.bg, color: style.color, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6 }}>
            {style.icon} {style.label}
          </span>
        )}
        {phase === 'calling' && (
          <span style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6 }}>
            ● Calling
          </span>
        )}
      </div>

      {/* steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>What the agent did</div>
        {event.steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ color: '#334155', fontSize: 11, fontFamily: 'monospace', minWidth: 16, marginTop: 1 }}>{i + 1}.</span>
            <span style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.4 }}>{s}</span>
          </div>
        ))}
      </div>

      {/* outcome */}
      {phase === 'done' && (
        <div style={{ borderTop: '1px solid #1e2a3a', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>Extracted outcome</div>
            <div style={{ color: '#e2e8f0', fontSize: 13, lineHeight: 1.4 }}>{event.outcome}</div>
            {event.rep && (
              <div style={{ color: '#475569', fontSize: 11, marginTop: 4 }}>
                Rep: {event.rep}{event.ref ? ` · Ref: ${event.ref}` : ''}
              </div>
            )}
          </div>
          {event.kind === 'resolved' && (
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#22c55e', fontFamily: 'monospace', letterSpacing: '-0.5px' }}>
                +{fmtCAD(event.amount)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CompletedRow({ event }: { event: DemoEvent }) {
  const style = KIND_STYLE[event.kind]
  const color = CARRIER_COLOR[event.carrier] ?? '#94a3b8'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px', borderRadius: 8,
      background: 'rgba(255,255,255,0.02)', border: '1px solid #1a2535',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ color: '#64748b', fontSize: 11, fontFamily: 'monospace', minWidth: 60 }}>{event.time}</span>
      <span style={{ color: '#94a3b8', fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.carrier}</span>
      <span style={{ color: style.color, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
        {style.icon} {event.kind === 'resolved' ? fmtCAD(event.amount) : style.label}
      </span>
    </div>
  )
}

// ─── Main page ──────────────────────────────────────────────────────────────

type Phase = 'idle' | 'running' | 'done'

export default function PilotDemo() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [currentIdx, setCurrentIdx] = useState(-1)       // spotlight index
  const [callPhase, setCallPhase] = useState<'calling' | 'done'>('calling')
  const [completed, setCompleted] = useState<DemoEvent[]>([])
  const [recovered, setRecovered] = useState(0)
  const [resolvedCount, setResolvedCount] = useState(0)
  const [needsAttention, setNeedsAttention] = useState(0)

  const displayRecovered = useCountUp(recovered)

  function start() {
    setPhase('running')
    setCurrentIdx(-1)
    setCompleted([])
    setRecovered(0)
    setResolvedCount(0)
    setNeedsAttention(0)
  }

  function reset() {
    setPhase('idle')
    setCurrentIdx(-1)
    setCompleted([])
    setRecovered(0)
    setResolvedCount(0)
    setNeedsAttention(0)
    setCallPhase('calling')
  }

  // Drive the event timeline
  useEffect(() => {
    if (phase !== 'running') return

    let idx = 0

    function nextCall() {
      if (idx >= EVENTS.length) {
        setPhase('done')
        return
      }
      const evt = EVENTS[idx]
      setCurrentIdx(idx)
      setCallPhase('calling')

      // After a brief "calling" phase, show outcome
      const callDuration = 1200 + Math.random() * 600
      const t1 = setTimeout(() => {
        setCallPhase('done')
        setCompleted(prev => [evt, ...prev].slice(0, 5))
        if (evt.kind === 'resolved') {
          setRecovered(prev => prev + evt.amount)
          setResolvedCount(prev => prev + 1)
        }
        if (evt.kind === 'escalated' || evt.kind === 'denied') {
          setNeedsAttention(prev => prev + 1)
        }

        idx++
        const t2 = setTimeout(nextCall, evt.delayMs)
        return () => clearTimeout(t2)
      }, callDuration)

      return () => clearTimeout(t1)
    }

    const t = setTimeout(nextCall, 600)
    return () => clearTimeout(t)
  }, [phase])

  const currentEvent = currentIdx >= 0 ? EVENTS[currentIdx] : null

  return (
    <div style={{
      minHeight: '100vh', background: '#080e18', color: '#e2e8f0',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <header style={{
        borderBottom: '1px solid #111c2b', padding: '12px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: 6, background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="white">
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" /><path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
            </svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>CollectRx</span>
          <span style={{ color: '#1e2a3a' }}>·</span>
          <span style={{ color: '#475569', fontSize: 13 }}>Hasan Family Dental</span>
        </div>
        {phase !== 'idle' && (
          <button onClick={reset} style={{ background: 'none', border: '1px solid #1e2a3a', color: '#475569', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>
            Restart
          </button>
        )}
      </header>

      {/* ── IDLE ─────────────────────────────────────────────────────── */}
      {phase === 'idle' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center', gap: 28 }}>
          <div>
            <div style={{ color: '#22c55e', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>Monday · June 9, 2026 · 8:00 AM</div>
            <h1 style={{ fontSize: 'clamp(26px, 4.5vw, 44px)', fontWeight: 800, letterSpacing: '-1px', color: '#f1f5f9', lineHeight: 1.15, marginBottom: 16 }}>
              Your AR is being worked<br />while you're with patients.
            </h1>
            <p style={{ color: '#475569', fontSize: 15, maxWidth: 440, margin: '0 auto 6px' }}>
              58 outstanding claims · $107,510 in AR
            </p>
            <p style={{ color: '#334155', fontSize: 13, maxWidth: 420, margin: '0 auto' }}>
              Watch CollectRx make real carrier calls — navigating IVR menus, speaking with reps, and extracting structured outcomes.
            </p>
          </div>
          <button
            onClick={start}
            style={{
              background: '#16a34a', color: '#fff', border: 'none', borderRadius: 10,
              padding: '14px 40px', fontSize: 16, fontWeight: 700, cursor: 'pointer',
              letterSpacing: '-0.3px', boxShadow: '0 0 0 4px rgba(22,163,74,0.18)',
            }}
          >
            ▶ Watch it work
          </button>
        </div>
      )}

      {/* ── RUNNING / DONE ────────────────────────────────────────────── */}
      {(phase === 'running' || phase === 'done') && (
        <div style={{
          flex: 1, display: 'grid',
          gridTemplateColumns: '1fr 220px',
          gridTemplateRows: '1fr auto',
          gap: 16, padding: '16px 20px',
          overflow: 'hidden',
          maxHeight: 'calc(100vh - 54px)',
        }}>

          {/* ── LEFT: spotlight + history ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, overflow: 'hidden' }}>

            {/* date label */}
            <div style={{ color: '#334155', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'monospace', flexShrink: 0 }}>
              {phase === 'running' ? `call ${Math.min(currentIdx + 1, EVENTS.length)} of ${EVENTS.length}` : `${EVENTS.length} calls completed — 11:31 AM`}
            </div>

            {/* spotlight */}
            <div style={{ flexShrink: 0 }}>
              {currentEvent ? (
                <SpotlightCard event={currentEvent} phase={callPhase} />
              ) : (
                <div style={{ background: '#0d1520', border: '1px solid #1e2a3a', borderRadius: 16, padding: 24, color: '#334155', fontSize: 13 }}>
                  Starting first call…
                </div>
              )}
            </div>

            {/* completed history */}
            {completed.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, overflowY: 'hidden' }}>
                <div style={{ color: '#334155', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', flexShrink: 0 }}>Completed</div>
                {completed.map((e, i) => (
                  <CompletedRow key={`${e.claimNumber}-${i}`} event={e} />
                ))}
              </div>
            )}
          </div>

          {/* ── RIGHT: stats ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
            <StatBox label="Recovered" value={fmtCAD(displayRecovered)} accent />
            <StatBox label="Resolved" value={String(resolvedCount)} />
            <StatBox label="Staff calls" value="0" />
            <StatBox label="Needs attention" value={String(needsAttention)} />

            {phase === 'running' && currentEvent && (
              <div style={{ marginTop: 4, padding: '10px 12px', background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.15)', borderRadius: 10 }}>
                <div style={{ color: '#fbbf24', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Active agent</div>
                <div style={{ color: '#94a3b8', fontSize: 11, lineHeight: 1.5 }}>
                  {callPhase === 'calling' ? 'IVR_Navigator' : 'Claims_Agent'}
                  <br />
                  <span style={{ color: '#475569' }}>{currentEvent.carrier}</span>
                </div>
              </div>
            )}
          </div>

          {/* ── SCORECARD (done state, spans full width) ── */}
          {phase === 'done' && (
            <div style={{
              gridColumn: '1 / -1',
              borderTop: '1px solid #111c2b', paddingTop: 20,
              display: 'flex', flexDirection: 'column', gap: 16, flexShrink: 0,
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
                {[
                  { label: 'Calls placed',    value: `${EVENTS.length}`,                                                  sub: 'zero staff involvement' },
                  { label: 'Resolved',         value: `${EVENTS.filter(e => e.kind === 'resolved').length}`,               sub: 'claims closed'          },
                  { label: 'Recovered',        value: fmtCAD(EVENTS.filter(e=>e.kind==='resolved').reduce((s,e)=>s+e.amount,0)), sub: 'CAD confirmed'    },
                  { label: 'Needs attention',  value: `${EVENTS.filter(e=>e.kind==='escalated'||e.kind==='denied').length}`, sub: 'flagged for you'      },
                  { label: 'Staff calls',      value: '0',                                                                 sub: 'not one'                },
                ].map(s => (
                  <div key={s.label} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #1e2a3a', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: s.label === 'Staff calls' ? '#22c55e' : '#f1f5f9', fontFamily: 'monospace' }}>{s.value}</div>
                    <div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>{s.label}</div>
                    <div style={{ color: '#334155', fontSize: 10 }}>{s.sub}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <p style={{ fontSize: 'clamp(15px, 2.5vw, 20px)', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.3px', marginBottom: 4 }}>
                    This runs every business day.
                  </p>
                  <p style={{ color: '#475569', fontSize: 13 }}>
                    Connect your Abeldent database — one afternoon of setup — and we start calling tomorrow.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <a
                    href="mailto:khalidegeh97@gmail.com?subject=CollectRx pilot setup"
                    style={{ background: '#16a34a', color: '#fff', padding: '10px 24px', borderRadius: 8, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}
                  >
                    Get started →
                  </a>
                  <button onClick={reset} style={{ background: 'none', border: '1px solid #1e2a3a', color: '#64748b', padding: '10px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                    Watch again
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`* { box-sizing: border-box; margin: 0; padding: 0; }`}</style>
    </div>
  )
}
