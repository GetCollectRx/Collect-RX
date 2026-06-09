import { useState, useEffect } from 'react'

// ─── Shared helpers ─────────────────────────────────────────────────────────

function fmtCAD(n: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n)
}

function useCountUp(target: number, active: boolean) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!active) return
    setVal(0)
    const steps = 32
    let i = 0
    const t = setInterval(() => {
      i++
      setVal(Math.round(target * (i / steps)))
      if (i >= steps) clearInterval(t)
    }, 28)
    return () => clearInterval(t)
  }, [target, active])
  return val
}

// ─── Acts ───────────────────────────────────────────────────────────────────

type Act = 'idle' | 'problem' | 'oldway' | 'pipeline' | 'scale' | 'summary'

// ── Act 1: The Problem ───────────────────────────────────────────────────────

function ActProblem({ onNext }: { onNext: () => void }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 400)
    const t2 = setTimeout(() => setStep(2), 1000)
    const t3 = setTimeout(() => setStep(3), 1700)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', textAlign: 'center', gap: 0 }}>
      <p style={{ color: '#475569', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 20 }}>
        Monday · June 9 · 8:00 AM · Before your first patient
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, maxWidth: 560, width: '100%', marginBottom: 32 }}>
        {[
          { value: '$107,510', label: 'Owed by carriers', sub: 'for work already done', show: step >= 1, accent: false },
          { value: '22 claims', label: 'Over 30 days old', sub: 'not yet followed up', show: step >= 2, accent: false },
          { value: '3 claims', label: 'Near deadline', sub: 'appeal window closing soon', show: step >= 3, accent: true },
        ].map((s) => (
          <div key={s.label} style={{
            background: s.accent ? 'rgba(239,68,68,0.07)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${s.accent ? 'rgba(239,68,68,0.3)' : '#1e2a3a'}`,
            borderRadius: 12, padding: '18px 12px',
            opacity: s.show ? 1 : 0, transform: s.show ? 'none' : 'translateY(8px)',
            transition: 'opacity 0.5s ease, transform 0.5s ease',
          }}>
            <div style={{ fontSize: 'clamp(18px, 3vw, 26px)', fontWeight: 800, color: s.accent ? '#f87171' : '#f1f5f9', fontFamily: 'monospace', marginBottom: 6 }}>{s.value}</div>
            <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>{s.label}</div>
            <div style={{ color: '#334155', fontSize: 11, marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <p style={{ color: '#475569', fontSize: 14, maxWidth: 400, lineHeight: 1.6, marginBottom: 28, opacity: step >= 3 ? 1 : 0, transition: 'opacity 0.6s ease 0.3s' }}>
        Sarah, your front desk coordinator, arrives. She knows the backlog. She picks up the phone.
      </p>

      <button
        onClick={onNext}
        style={{
          background: 'none', border: '1px solid #1e2a3a', color: '#64748b',
          borderRadius: 8, padding: '10px 28px', cursor: 'pointer', fontSize: 13,
          opacity: step >= 3 ? 1 : 0, transition: 'opacity 0.4s ease 0.6s',
        }}
      >
        See what happens →
      </button>
    </div>
  )
}

// ── Act 2: The Old Way ────────────────────────────────────────────────────────

const OLD_WAY_EVENTS = [
  { time: '8:02 AM', icon: '📞', text: 'Sarah calls Sun Life claims line', detail: null, hold: '18 min on hold', outcome: '1 claim checked', kind: 'ok' },
  { time: '9:14 AM', icon: '📞', text: 'Sarah calls Canada Life', detail: null, hold: '31 min on hold', outcome: 'Disconnected. No status.', kind: 'bad' },
  { time: '10:08 AM', icon: '📞', text: 'Sarah calls Manulife', detail: null, hold: '22 min on hold', outcome: '1 claim checked', kind: 'ok' },
  { time: '11:00 AM', icon: '⚠️', text: 'Patients backing up at reception', detail: 'Sarah puts the phone down.', hold: null, outcome: '19 claims still waiting.', kind: 'bad' },
  { time: 'Last quarter', icon: '💸', text: 'Claim #CL-2024-8842 expired quietly', detail: '$2,400 crown procedure. 90 days old. Appeal window closed. Written off.', hold: null, outcome: 'Gone. You never knew.', kind: 'loss' },
]

function ActOldWay({ onNext }: { onNext: () => void }) {
  const [visible, setVisible] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    OLD_WAY_EVENTS.forEach((_, i) => {
      timers.push(setTimeout(() => setVisible(i + 1), 800 + i * 1800))
    })
    timers.push(setTimeout(() => setDone(true), 800 + OLD_WAY_EVENTS.length * 1800 + 600))
    return () => timers.forEach(clearTimeout)
  }, [])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '24px 20px', maxWidth: 600, margin: '0 auto', width: '100%' }}>
      <div style={{ marginBottom: 20, flexShrink: 0 }}>
        <p style={{ color: '#ef4444', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>The old way</p>
        <h2 style={{ fontSize: 'clamp(18px, 3vw, 26px)', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.5px' }}>Sarah's Monday morning</h2>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'hidden', justifyContent: 'flex-start' }}>
        {OLD_WAY_EVENTS.map((e, i) => (
          <div key={i} style={{
            opacity: i < visible ? 1 : 0, transform: i < visible ? 'none' : 'translateX(-12px)',
            transition: 'opacity 0.4s ease, transform 0.4s ease',
            background: e.kind === 'loss' ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${e.kind === 'loss' ? 'rgba(239,68,68,0.25)' : e.kind === 'bad' ? '#1e2a3a' : '#1e2a3a'}`,
            borderRadius: 10, padding: '12px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16 }}>{e.icon}</span>
              <span style={{ color: '#64748b', fontSize: 11, fontFamily: 'monospace', minWidth: 72 }}>{e.time}</span>
              <span style={{ color: '#94a3b8', fontSize: 13, flex: 1 }}>{e.text}</span>
            </div>
            {e.hold && (
              <div style={{ marginTop: 6, marginLeft: 36, color: '#475569', fontSize: 12 }}>⏱ {e.hold}</div>
            )}
            {e.detail && (
              <div style={{ marginTop: 4, marginLeft: 36, color: '#64748b', fontSize: 12 }}>{e.detail}</div>
            )}
            <div style={{ marginTop: 6, marginLeft: 36, color: e.kind === 'loss' ? '#f87171' : e.kind === 'bad' ? '#64748b' : '#64748b', fontSize: 12, fontWeight: e.kind === 'loss' ? 700 : 400 }}>
              → {e.outcome}
            </div>
          </div>
        ))}
      </div>

      {done && (
        <div style={{ marginTop: 16, padding: '16px 20px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            {[
              { label: 'Time spent', value: '3.5 hrs', color: '#f87171' },
              { label: 'Claims checked', value: '2 of 22', color: '#f87171' },
              { label: 'Recovered today', value: '$0', color: '#f87171' },
              { label: 'Lost to expiry', value: '$2,400', color: '#ef4444' },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: s.color, fontFamily: 'monospace' }}>{s.value}</div>
                <div style={{ color: '#475569', fontSize: 11 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <button
            onClick={onNext}
            style={{ width: '100%', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, padding: '11px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            See what CollectRx does instead →
          </button>
        </div>
      )}
    </div>
  )
}

// ── Act 3: The Pipeline ───────────────────────────────────────────────────────

const PIPELINE_STEPS = [
  {
    agent: 'IVR_Navigator',
    role: 'Handles the phone tree',
    color: '#3b82f6',
    steps: ['Dialed Sun Life claims line', 'Navigated IVR: Claims → Status → Dental', '4:12 on hold — no human needed'],
    duration: 3200,
  },
  {
    agent: 'Claims_Agent',
    role: 'Speaks with the rep',
    color: '#8b5cf6',
    steps: ['Jennifer M. answered', 'Stated claim #, patient token, procedure date', 'Asked for adjudication status'],
    duration: 3200,
  },
  {
    agent: 'Resolution_Closer',
    role: 'Extracts & confirms outcome',
    color: '#22c55e',
    steps: ['Claim adjudicated in full', 'Payment $1,840 EFT by June 21', 'Reference: SL-847291 confirmed'],
    duration: 2400,
  },
]

function ActPipeline({ onNext }: { onNext: () => void }) {
  const [agentIdx, setAgentIdx] = useState(-1)
  const [stepIdx, setStepIdx] = useState(0)
  const [resolved, setResolved] = useState(false)
  const [showNext, setShowNext] = useState(false)

  useEffect(() => {
    let totalDelay = 600

    PIPELINE_STEPS.forEach((agent, ai) => {
      // Activate agent
      const activateDelay = totalDelay
      setTimeout(() => { setAgentIdx(ai); setStepIdx(0) }, activateDelay)

      // Reveal each step
      agent.steps.forEach((_, si) => {
        const stepDelay = activateDelay + 400 + si * 700
        setTimeout(() => setStepIdx(si + 1), stepDelay)
      })

      totalDelay = activateDelay + agent.duration
    })

    // Resolve
    setTimeout(() => setResolved(true), totalDelay + 400)
    setTimeout(() => setShowNext(true), totalDelay + 1400)
  }, [])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 20px', maxWidth: 640, margin: '0 auto', width: '100%' }}>

      {/* Claim card */}
      <div style={{
        background: resolved ? 'rgba(34,197,94,0.07)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${resolved ? 'rgba(34,197,94,0.35)' : '#1e2a3a'}`,
        borderRadius: 12, padding: '14px 18px', marginBottom: 20, flexShrink: 0,
        transition: 'all 0.6s ease',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
      }}>
        <div>
          <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 14 }}>Sun Life · SL-2025-002341</div>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>Crown procedure · 47 days outstanding</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {resolved ? (
            <>
              <div style={{ color: '#22c55e', fontWeight: 800, fontSize: 18, fontFamily: 'monospace' }}>✓ $1,840 recovered</div>
              <div style={{ color: '#475569', fontSize: 11 }}>EFT June 21 · Ref SL-847291</div>
            </>
          ) : (
            <>
              <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 13 }}>● Calling now</div>
              <div style={{ color: '#475569', fontSize: 12, fontFamily: 'monospace' }}>$2,340 outstanding</div>
            </>
          )}
        </div>
      </div>

      {/* Agent pipeline */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, overflowY: 'hidden' }}>
        {PIPELINE_STEPS.map((agent, ai) => {
          const isActive = agentIdx === ai
          const isDone = agentIdx > ai || resolved
          return (
            <div key={ai} style={{
              background: isActive ? `${agent.color}11` : isDone ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.2)',
              border: `1px solid ${isActive ? agent.color + '44' : isDone ? '#1e2a3a' : '#111c2b'}`,
              borderRadius: 12, padding: '14px 16px',
              transition: 'all 0.4s ease',
              opacity: agentIdx < ai && !isDone ? 0.4 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: isActive ? 10 : 0 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: isDone ? agent.color : isActive ? agent.color + '33' : '#1e2a3a',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
                  transition: 'all 0.4s ease',
                }}>
                  {isDone ? '✓' : isActive ? '●' : String(ai + 1)}
                </div>
                <div>
                  <div style={{ color: isActive || isDone ? '#f1f5f9' : '#475569', fontWeight: 600, fontSize: 13 }}>{agent.agent}</div>
                  <div style={{ color: '#475569', fontSize: 11 }}>{agent.role}</div>
                </div>
              </div>

              {(isActive || isDone) && (
                <div style={{ marginLeft: 38, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {agent.steps.slice(0, isActive ? stepIdx : agent.steps.length).map((s, si) => (
                    <div key={si} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ color: agent.color, fontSize: 11, marginTop: 1, flexShrink: 0 }}>›</span>
                      <span style={{ color: '#94a3b8', fontSize: 12 }}>{s}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {showNext && (
        <button
          onClick={onNext}
          style={{ marginTop: 16, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, padding: '11px', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
        >
          That happened on 9 other claims at the same time →
        </button>
      )}
    </div>
  )
}

// ── Act 4: At Scale ────────────────────────────────────────────────────────────

const SCALE_CALLS = [
  { carrier: 'Canada Life',      amount: 980,  kind: 'resolved',  time: '8:14 AM' },
  { carrier: 'Manulife',         amount: 1560, kind: 'resolved',  time: '8:52 AM' },
  { carrier: 'Green Shield',     amount: 890,  kind: 'escalated', time: '8:54 AM', note: 'x-rays required — flagged' },
  { carrier: 'Sun Life',         amount: 2200, kind: 'resolved',  time: '9:27 AM' },
  { carrier: 'Canada Life',      amount: 1380, kind: 'resolved',  time: '9:41 AM' },
  { carrier: 'Manulife',         amount: 3180, kind: 'processing',time: '9:58 AM', note: 'follow-up in 7 days' },
  { carrier: 'RBC Insurance',    amount: 760,  kind: 'resolved',  time: '10:35 AM' },
  { carrier: 'Sun Life',         amount: 3200, kind: 'resolved',  time: '11:06 AM' },
  { carrier: 'TELUS AdjudiCare', amount: 1120, kind: 'resolved',  time: '11:31 AM' },
]

const KIND_COLOR: Record<string, string> = { resolved: '#22c55e', escalated: '#f97316', processing: '#64748b', denied: '#ef4444' }
const KIND_LABEL: Record<string, string> = { resolved: '✓', escalated: '⚠', processing: '⟳', denied: '✕' }

function ActScale({ onNext }: { onNext: () => void }) {
  const [visible, setVisible] = useState(0)
  const [totalRecovered, setTotalRecovered] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    SCALE_CALLS.forEach((c, i) => {
      setTimeout(() => {
        setVisible(i + 1)
        if (c.kind === 'resolved') setTotalRecovered(p => p + c.amount)
      }, 400 + i * 900)
    })
    setTimeout(() => setDone(true), 400 + SCALE_CALLS.length * 900 + 600)
  }, [])

  const display = useCountUp(totalRecovered, true)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 20px', maxWidth: 640, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexShrink: 0 }}>
        <div>
          <p style={{ color: '#22c55e', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Simultaneously</p>
          <h3 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 16 }}>9 other calls running in parallel</h3>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#22c55e', fontFamily: 'monospace' }}>{fmtCAD(display)}</div>
          <div style={{ color: '#475569', fontSize: 11 }}>recovered so far today</div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'hidden' }}>
        {SCALE_CALLS.map((c, i) => (
          <div key={i} style={{
            opacity: i < visible ? 1 : 0, transform: i < visible ? 'none' : 'translateX(12px)',
            transition: 'opacity 0.35s ease, transform 0.35s ease',
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'rgba(255,255,255,0.02)', border: '1px solid #111c2b',
            borderRadius: 8, padding: '9px 14px',
          }}>
            <span style={{ color: '#475569', fontSize: 11, fontFamily: 'monospace', minWidth: 64 }}>{c.time}</span>
            <span style={{ color: '#94a3b8', fontSize: 12, flex: 1 }}>{c.carrier}</span>
            {c.note && <span style={{ color: '#475569', fontSize: 11 }}>{c.note}</span>}
            <span style={{ color: KIND_COLOR[c.kind], fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
              {KIND_LABEL[c.kind]} {c.kind === 'resolved' ? fmtCAD(c.amount) : c.kind}
            </span>
          </div>
        ))}
      </div>

      {done && (
        <button
          onClick={onNext}
          style={{ marginTop: 16, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, padding: '11px', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
        >
          See your end-of-day summary →
        </button>
      )}
    </div>
  )
}

// ── Act 5: The Summary ────────────────────────────────────────────────────────

function ActSummary() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const timers = [
      setTimeout(() => setStep(1), 300),
      setTimeout(() => setStep(2), 800),
      setTimeout(() => setStep(3), 1300),
      setTimeout(() => setStep(4), 1800),
      setTimeout(() => setStep(5), 2600),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  const VALUE_ROWS = [
    {
      icon: '💰',
      headline: '$18,580 recovered',
      detail: "10 claims resolved. Money you'd already earned — just sitting at the carrier.",
      color: '#22c55e',
    },
    {
      icon: '⏱',
      headline: '3.5 hours back to Sarah',
      detail: 'She checked in 34 patients, scheduled 12 follow-ups, quoted 8 treatment plans.',
      color: '#3b82f6',
    },
    {
      icon: '🛡',
      headline: '$5,400 saved from expiry',
      detail: '2 claims were within 3 weeks of their appeal deadline. Both caught and resolved.',
      color: '#f97316',
    },
    {
      icon: '👁',
      headline: '58 claims — nothing in the dark',
      detail: "Every claim tracked, every status known. You're not relying on memory anymore.",
      color: '#8b5cf6',
    },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 20px', maxWidth: 640, margin: '0 auto', width: '100%' }}>
      <div style={{ marginBottom: 20, flexShrink: 0, opacity: step >= 1 ? 1 : 0, transition: 'opacity 0.5s ease' }}>
        <p style={{ color: '#475569', fontSize: 13, marginBottom: 4 }}>5:00 PM · Your day.</p>
        <p style={{ color: '#64748b', fontSize: 12 }}>While you saw 34 patients. <span style={{ color: '#22c55e' }}>Staff calls to carriers: 0.</span></p>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'hidden' }}>
        {VALUE_ROWS.map((row, i) => (
          <div key={i} style={{
            opacity: step >= i + 2 ? 1 : 0, transform: step >= i + 2 ? 'none' : 'translateY(10px)',
            transition: 'opacity 0.5s ease, transform 0.5s ease',
            background: `${row.color}08`,
            border: `1px solid ${row.color}30`,
            borderRadius: 12, padding: '14px 18px',
            display: 'flex', gap: 14, alignItems: 'flex-start',
          }}>
            <span style={{ fontSize: 22, flexShrink: 0, marginTop: 2 }}>{row.icon}</span>
            <div>
              <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{row.headline}</div>
              <div style={{ color: '#64748b', fontSize: 12, lineHeight: 1.5 }}>{row.detail}</div>
            </div>
          </div>
        ))}
      </div>

      {step >= 5 && (
        <div style={{ marginTop: 16, padding: '16px 18px', background: 'rgba(22,163,74,0.07)', border: '1px solid rgba(22,163,74,0.25)', borderRadius: 12, flexShrink: 0 }}>
          <p style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
            This is every business day.
          </p>
          <p style={{ color: '#475569', fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
            Connect your Abeldent database — one afternoon — and we start calling tomorrow morning.
          </p>
          <a
            href="mailto:khalidegeh97@gmail.com?subject=CollectRx pilot setup"
            style={{ display: 'inline-block', background: '#16a34a', color: '#fff', padding: '10px 28px', borderRadius: 8, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}
          >
            Let's get started →
          </a>
        </div>
      )}
    </div>
  )
}

// ─── Progress indicator ──────────────────────────────────────────────────────

const ACT_LABELS: Partial<Record<Act, string>> = {
  problem: 'The situation',
  oldway: 'Without CollectRx',
  pipeline: 'How it works',
  scale: 'At scale',
  summary: 'Your outcome',
}

// ─── Root component ──────────────────────────────────────────────────────────

export default function PilotDemo() {
  const [act, setAct] = useState<Act>('idle')

  const steps = Object.keys(ACT_LABELS) as Act[]
  const currentStep = steps.indexOf(act)

  return (
    <div style={{
      height: '100vh', background: '#080e18', color: '#e2e8f0',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <header style={{
        borderBottom: '1px solid #111c2b', padding: '12px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
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

        {act !== 'idle' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* step dots */}
            <div style={{ display: 'flex', gap: 6 }}>
              {steps.map((s, i) => (
                <div key={s} style={{
                  width: i === currentStep ? 20 : 6, height: 6,
                  borderRadius: 3, transition: 'all 0.3s ease',
                  background: i < currentStep ? '#22c55e' : i === currentStep ? '#22c55e' : '#1e2a3a',
                }} />
              ))}
            </div>
            <button
              onClick={() => setAct('idle')}
              style={{ background: 'none', border: '1px solid #1e2a3a', color: '#475569', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}
            >
              Restart
            </button>
          </div>
        )}
      </header>

      {/* Act label */}
      {act !== 'idle' && (
        <div style={{ padding: '8px 20px', background: '#080e18', borderBottom: '1px solid #0d1520', flexShrink: 0 }}>
          <span style={{ color: '#334155', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {ACT_LABELS[act]}
          </span>
        </div>
      )}

      {/* Act content */}
      {act === 'idle' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center', gap: 24 }}>
          <div>
            <h1 style={{ fontSize: 'clamp(24px, 4vw, 40px)', fontWeight: 800, letterSpacing: '-1px', color: '#f1f5f9', lineHeight: 1.15, marginBottom: 14 }}>
              Your AR is already earned.<br />You just haven't collected it yet.
            </h1>
            <p style={{ color: '#475569', fontSize: 15, maxWidth: 420, margin: '0 auto' }}>
              A 4-minute walkthrough of exactly how CollectRx fixes that — for your practice, in your numbers.
            </p>
          </div>
          <button
            onClick={() => setAct('problem')}
            style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 10, padding: '14px 40px', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: '0 0 0 4px rgba(22,163,74,0.18)', letterSpacing: '-0.3px' }}
          >
            ▶ Show me
          </button>
        </div>
      )}

      {act === 'problem'  && <ActProblem  onNext={() => setAct('oldway')} />}
      {act === 'oldway'   && <ActOldWay   onNext={() => setAct('pipeline')} />}
      {act === 'pipeline' && <ActPipeline onNext={() => setAct('scale')} />}
      {act === 'scale'    && <ActScale    onNext={() => setAct('summary')} />}
      {act === 'summary'  && <ActSummary />}

      <style>{`* { box-sizing: border-box; margin: 0; padding: 0; }`}</style>
    </div>
  )
}
