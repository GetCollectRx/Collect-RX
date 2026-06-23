import { useState, useEffect, useRef, useCallback } from 'react'

// ─── Brand tokens ─────────────────────────────────────────────────────────────

const B = {
  bg:        '#F0ECE4',
  surface:   '#FFFFFF',
  border:    '#DDD7CC',
  borderMd:  '#C8C0B4',
  green:     '#0F6E56',
  greenDk:   '#0A5240',
  greenLt:   '#D6EDE6',
  red:       '#B91C1C',
  redLt:     '#FEE2E2',
  amber:     '#92400E',
  amberLt:   '#FDE68A',
  text:      '#111111',
  textMd:    '#3D3D3D',
  textMuted: '#777777',
  mono:      "'JetBrains Mono', 'Fira Code', monospace",
}

const PRACTICE = 'Tenth Line Family Dentistry'

/** PMS-agnostic setup copy — AbelDent, Dentrix, ClearDent, etc. use the same connector/export path. */
const PMS_CONNECT_LINE = 'your practice management software'
const PMS_CONNECT_SHORT = 'your PMS'

// ─── SVG icon pack ────────────────────────────────────────────────────────────

type IconName = 'dollar'|'clock'|'shield'|'eye'|'phone'|'warning'|'x-circle'|'check-circle'|'chevron-right'|'arrow-right'|'refresh'|'pause'|'play'

const PATHS: Record<IconName, string> = {
  dollar:          'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
  clock:           'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm0-10V7m0 5l3 3',
  shield:          'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  eye:             'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 12m-3 0a3 3 0 106 0 3 3 0 00-6 0',
  phone:           'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z',
  warning:         'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4m0 4h.01',
  'x-circle':      'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm3-13l-6 6m0-6l6 6',
  'check-circle':  'M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3',
  'chevron-right': 'M9 18l6-6-6-6',
  'arrow-right':   'M5 12h14m-7-7l7 7-7 7',
  refresh:         'M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15',
  pause:           'M6 4h4v16H6zM14 4h4v16h-4z',
  play:            'M5 3l14 9-14 9V3z',
}

function Icon({ name, size = 16, color = B.green, strokeWidth = 1.8 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d={PATHS[name]} />
    </svg>
  )
}

function fmtCAD(n: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n)
}

function useCountUp(target: number, active: boolean) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!active) return
    setVal(0)
    const steps = 32; let i = 0
    const t = setInterval(() => { i++; setVal(Math.round(target * i / steps)); if (i >= steps) clearInterval(t) }, 28)
    return () => clearInterval(t)
  }, [target, active])
  return val
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 12, ...style }}>{children}</div>
}

// ─── Acts ─────────────────────────────────────────────────────────────────────

type Act = 'idle' | 'problem' | 'oldway' | 'pipeline' | 'scale' | 'summary' | 'close'

const ACTS: Act[] = ['problem', 'oldway', 'pipeline', 'scale', 'summary', 'close']
const ACT_LABELS: Record<Act, string> = {
  idle: '', problem: 'The situation', oldway: 'Without CollectRx',
  pipeline: 'How it works', scale: 'At scale', summary: 'Your outcome',
  close: 'The ask',
}

const ACT_DURATION: Partial<Record<Act, number>> = {
  problem:  8500,
  oldway:   14500,
  pipeline: 15500,
  scale:    11500,
  summary:  11000,
  // close stays
}

// ─── Progress bar (CSS animation) ────────────────────────────────────────────

function ActProgressBar({ act, paused }: { act: Act; paused: boolean }) {
  const dur = ACT_DURATION[act]
  if (!dur) return null
  return (
    <div style={{ height: 3, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
      <div style={{
        height: '100%', background: '#6EE7B7', width: paused ? '0%' : '100%',
        animation: paused ? 'none' : `fillBar ${dur}ms linear forwards`,
      }} />
    </div>
  )
}

// ─── Act 1: The Problem ───────────────────────────────────────────────────────

function ActProblem({ onComplete, paused }: { onComplete: () => void; paused: boolean }) {
  const [step, setStep] = useState(0)
  const fired = useRef(false)

  useEffect(() => {
    const t = [setTimeout(() => setStep(1), 500), setTimeout(() => setStep(2), 1100), setTimeout(() => setStep(3), 1800)]
    return () => t.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    if (paused || fired.current) return
    const t = setTimeout(() => { fired.current = true; onComplete() }, 8000)
    return () => clearTimeout(t)
  }, [paused, onComplete])

  const stats = [
    { value: '$107,510', label: 'Owed by carriers',  sub: 'for work already done', icon: 'dollar'  as IconName, bg: B.green   },
    { value: '22 claims', label: 'Over 30 days old', sub: 'no one has called yet', icon: 'clock'   as IconName, bg: '#92400E' },
    { value: '3 claims',  label: 'Near deadline',    sub: 'appeal window closing', icon: 'warning' as IconName, bg: B.red     },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 20px', textAlign: 'center' }}>
      <p style={{ color: B.textMuted, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 20 }}>
        Monday · June 9 · 8:00 AM · Before your first patient
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, maxWidth: 540, width: '100%', marginBottom: 30 }}>
        {stats.map((s, i) => (
          <div key={s.label} style={{
            padding: '22px 14px', borderRadius: 14,
            opacity: step > i ? 1 : 0, transform: step > i ? 'none' : 'translateY(10px)',
            transition: 'opacity 0.5s ease, transform 0.5s ease',
            background: s.bg, boxShadow: `0 6px 24px ${s.bg}88`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 8, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={s.icon} size={20} color="#fff" />
              </div>
            </div>
            <div style={{ fontSize: 'clamp(18px, 2.8vw, 24px)', fontWeight: 900, color: '#fff', fontFamily: B.mono, marginBottom: 6, letterSpacing: '-0.5px' }}>{s.value}</div>
            <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: 600 }}>{s.label}</div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>
      <p style={{ color: B.textMuted, fontSize: 14, maxWidth: 380, lineHeight: 1.65, opacity: step >= 3 ? 1 : 0, transition: 'opacity 0.6s ease 0.3s' }}>
        Sarah, your front desk coordinator, arrives. She knows the backlog. She picks up the phone.
      </p>
    </div>
  )
}

// ─── Act 2: The Old Way ───────────────────────────────────────────────────────

const OLD_WAY_EVENTS = [
  { time: '8:02 AM',      icon: 'phone'    as IconName, iconColor: B.textMuted, text: 'Sarah calls Sun Life',               hold: '18 min on hold',                                    outcome: '1 claim checked',                                  loss: false },
  { time: '9:14 AM',      icon: 'phone'    as IconName, iconColor: B.textMuted, text: 'Sarah calls Canada Life',            hold: '31 min on hold',                                    outcome: 'Disconnected. No status.',                          loss: false },
  { time: '10:08 AM',     icon: 'phone'    as IconName, iconColor: B.textMuted, text: 'Sarah calls Manulife',               hold: '22 min on hold',                                    outcome: '1 claim checked',                                  loss: false },
  { time: '11:00 AM',     icon: 'warning'  as IconName, iconColor: B.amber,     text: 'Patients backing up at reception',  hold: null,                                                outcome: 'Sarah puts the phone down. 19 claims still waiting.',loss: false },
  { time: 'Last quarter', icon: 'x-circle' as IconName, iconColor: B.red,       text: 'Claim #CL-2024-8842 expired quietly', hold: '$2,400 crown · 90 days old · appeal window closed', outcome: 'Written off. You never knew.',                      loss: true  },
]

function ActOldWay({ onComplete, paused }: { onComplete: () => void; paused: boolean }) {
  const [visible, setVisible] = useState(0)
  const [showSummary, setShowSummary] = useState(false)
  const fired = useRef(false)

  useEffect(() => {
    const t: ReturnType<typeof setTimeout>[] = []
    OLD_WAY_EVENTS.forEach((_, i) => t.push(setTimeout(() => setVisible(i + 1), 800 + i * 1700)))
    t.push(setTimeout(() => setShowSummary(true), 800 + OLD_WAY_EVENTS.length * 1700 + 300))
    return () => t.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    if (paused || fired.current) return
    const t = setTimeout(() => { fired.current = true; onComplete() }, 14000)
    return () => clearTimeout(t)
  }, [paused, onComplete])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 20px', maxWidth: 580, margin: '0 auto', width: '100%', minHeight: 0 }}>
      <div style={{ marginBottom: 14, flexShrink: 0 }}>
        <p style={{ color: B.red, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, fontWeight: 600 }}>Without CollectRx</p>
        <h2 style={{ fontSize: 'clamp(16px, 2.5vw, 22px)', fontWeight: 800, color: B.text }}>Sarah's Monday morning</h2>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', minHeight: 0 }}>
        {OLD_WAY_EVENTS.map((e, i) => (
          <Card key={i} style={{
            padding: '10px 14px', flexShrink: 0,
            opacity: i < visible ? 1 : 0, transform: i < visible ? 'none' : 'translateX(-10px)',
            transition: 'opacity 0.35s ease, transform 0.35s ease',
            background: e.loss ? B.redLt : B.surface, border: `1px solid ${e.loss ? B.red + '44' : B.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name={e.icon} size={13} color={e.iconColor} />
              <span style={{ color: B.textMuted, fontSize: 10, fontFamily: B.mono, minWidth: 68 }}>{e.time}</span>
              <span style={{ color: B.textMd, fontSize: 12, flex: 1, fontWeight: 500 }}>{e.text}</span>
            </div>
            {e.hold && <div style={{ marginTop: 4, marginLeft: 21, color: B.textMuted, fontSize: 11 }}>{e.hold}</div>}
            <div style={{ marginTop: 4, marginLeft: 21, color: e.loss ? B.red : B.textMuted, fontSize: 11, fontWeight: e.loss ? 700 : 400 }}>→ {e.outcome}</div>
          </Card>
        ))}
        {showSummary && (
          <Card style={{ padding: '14px 18px', flexShrink: 0, background: B.redLt, border: `1px solid ${B.red}33`, animation: 'fadeUp 0.4s ease' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {[['3.5 hrs','Time spent'],['2 of 22','Claims checked'],['$0','Recovered'],['$2,400','Lost to expiry']].map(([v, l]) => (
                <div key={l} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: B.red, fontFamily: B.mono }}>{v}</div>
                  <div style={{ color: B.textMuted, fontSize: 10, marginTop: 2 }}>{l}</div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

// ─── Act 3: The Pipeline ──────────────────────────────────────────────────────

const PIPELINE_STEPS = [
  { name: 'Phone Navigator',   role: 'Gets past the phone tree',    steps: ['Dialed Sun Life claims line', 'Navigated menus: Claims → Status → Dental', '4:12 on hold, no staff needed'],    duration: 3400 },
  { name: 'Claims Specialist', role: 'Speaks with the carrier rep', steps: ['Jennifer M. answered', 'Stated claim #, patient details, procedure date', 'Asked for adjudication status'],      duration: 3400 },
  { name: 'Resolution Agent',  role: 'Records and confirms outcome',steps: ['Claim adjudicated in full', 'Payment $1,840 EFT by June 21', 'Reference SL-847291 confirmed'],                   duration: 2600 },
]

function ActPipeline({ onComplete, paused }: { onComplete: () => void; paused: boolean }) {
  const [agentIdx, setAgentIdx] = useState(-1)
  const [stepIdx, setStepIdx]   = useState(0)
  const [resolved, setResolved] = useState(false)
  const fired = useRef(false)

  useEffect(() => {
    let delay = 700
    PIPELINE_STEPS.forEach((agent, ai) => {
      setTimeout(() => { setAgentIdx(ai); setStepIdx(0) }, delay)
      agent.steps.forEach((_, si) => setTimeout(() => setStepIdx(si + 1), delay + 500 + si * 700))
      delay += agent.duration
    })
    setTimeout(() => setResolved(true), delay + 400)
  }, [])

  useEffect(() => {
    if (paused || fired.current) return
    const t = setTimeout(() => { fired.current = true; onComplete() }, 15000)
    return () => clearTimeout(t)
  }, [paused, onComplete])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '14px 20px', maxWidth: 600, margin: '0 auto', width: '100%', minHeight: 0 }}>
      <Card style={{
        padding: '14px 18px', marginBottom: 14, flexShrink: 0,
        background: resolved ? B.greenLt : B.surface, border: `1px solid ${resolved ? B.green + '55' : B.border}`,
        transition: 'all 0.6s ease', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
      }}>
        <div>
          <div style={{ color: B.text, fontWeight: 700, fontSize: 14 }}>Sun Life · SL-2025-002341</div>
          <div style={{ color: B.textMuted, fontSize: 12, marginTop: 2 }}>Crown procedure · 47 days outstanding</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {resolved
            ? <><div style={{ color: B.green, fontWeight: 800, fontSize: 17, fontFamily: B.mono }}>$1,840 recovered</div><div style={{ color: B.textMuted, fontSize: 11 }}>EFT June 21 · Ref SL-847291</div></>
            : <div style={{ color: B.amber, fontWeight: 600, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="phone" size={12} color={B.amber} /> Calling now</div>
          }
        </div>
      </Card>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', minHeight: 0 }}>
        {PIPELINE_STEPS.map((agent, ai) => {
          const isActive = agentIdx === ai
          const isDone   = agentIdx > ai || resolved
          return (
            <Card key={ai} style={{
              padding: '12px 16px', flexShrink: 0,
              background: isActive ? B.greenLt : isDone ? '#FAFAFA' : B.surface,
              border: `1px solid ${isActive ? B.green + '55' : B.border}`,
              opacity: agentIdx < ai && !isDone ? 0.35 : 1, transition: 'all 0.4s ease',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  background: isDone ? B.green : isActive ? B.greenLt : B.border,
                  border: `1.5px solid ${isDone ? B.green : isActive ? B.green : B.borderMd}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.4s ease',
                }}>
                  {isDone ? <Icon name="check-circle" size={13} color="#fff" strokeWidth={2.5} /> : <span style={{ color: isActive ? B.green : B.textMuted, fontSize: 11, fontWeight: 700 }}>{ai + 1}</span>}
                </div>
                <div>
                  <div style={{ color: B.text, fontWeight: 600, fontSize: 13 }}>{agent.name}</div>
                  <div style={{ color: B.textMuted, fontSize: 11 }}>{agent.role}</div>
                </div>
              </div>
              {(isActive || isDone) && (
                <div style={{ marginLeft: 36, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {agent.steps.slice(0, isActive ? stepIdx : agent.steps.length).map((s, si) => (
                    <div key={si} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <Icon name="chevron-right" size={12} color={B.green} strokeWidth={2} />
                      <span style={{ color: B.textMd, fontSize: 12 }}>{s}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ─── Act 4: At Scale ──────────────────────────────────────────────────────────

const SCALE_CALLS = [
  { carrier: 'Canada Life',      amount: 980,  kind: 'resolved',   time: '8:14 AM' },
  { carrier: 'Manulife',         amount: 1560, kind: 'resolved',   time: '8:52 AM' },
  { carrier: 'Green Shield',     amount: 890,  kind: 'escalated',  time: '8:54 AM', note: 'x-rays required, flagged' },
  { carrier: 'Sun Life',         amount: 2200, kind: 'resolved',   time: '9:27 AM' },
  { carrier: 'Canada Life',      amount: 1380, kind: 'resolved',   time: '9:41 AM' },
  { carrier: 'Manulife',         amount: 3180, kind: 'processing', time: '9:58 AM', note: 'follow-up in 7 days' },
  { carrier: 'RBC Insurance',    amount: 760,  kind: 'resolved',   time: '10:35 AM' },
  { carrier: 'Sun Life',         amount: 3200, kind: 'resolved',   time: '11:06 AM' },
  { carrier: 'TELUS AdjudiCare', amount: 1120, kind: 'resolved',   time: '11:31 AM' },
]

const KIND_META: Record<string, { color: string; bg: string; icon: IconName; label: string }> = {
  resolved:   { color: B.green,     bg: B.greenLt, icon: 'check-circle', label: '' },
  escalated:  { color: B.amber,     bg: B.amberLt, icon: 'warning',      label: 'Flagged'    },
  processing: { color: B.textMuted, bg: '#F0F0F0',  icon: 'refresh',      label: 'Follow-up'  },
  denied:     { color: B.red,       bg: B.redLt,   icon: 'x-circle',     label: 'Denied'     },
}

function ActScale({ onComplete, paused }: { onComplete: () => void; paused: boolean }) {
  const [visible, setVisible]             = useState(0)
  const [totalRecovered, setTotalRecovered] = useState(0)
  const fired = useRef(false)

  useEffect(() => {
    SCALE_CALLS.forEach((c, i) => setTimeout(() => {
      setVisible(i + 1)
      if (c.kind === 'resolved') setTotalRecovered(p => p + c.amount)
    }, 400 + i * 850))
  }, [])

  useEffect(() => {
    if (paused || fired.current) return
    const t = setTimeout(() => { fired.current = true; onComplete() }, 11000)
    return () => clearTimeout(t)
  }, [paused, onComplete])

  const display = useCountUp(totalRecovered, true)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '14px 20px', maxWidth: 600, margin: '0 auto', width: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <p style={{ color: B.green, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3, fontWeight: 600 }}>Simultaneously</p>
          <h3 style={{ color: B.text, fontWeight: 700, fontSize: 16 }}>9 other calls running in parallel</h3>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: B.green, fontFamily: B.mono }}>{fmtCAD(display)}</div>
          <div style={{ color: B.textMuted, fontSize: 11 }}>recovered today</div>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', minHeight: 0 }}>
        {SCALE_CALLS.map((c, i) => {
          const meta = KIND_META[c.kind]
          return (
            <Card key={i} style={{
              flexShrink: 0, padding: '9px 14px',
              opacity: i < visible ? 1 : 0, transform: i < visible ? 'none' : 'translateX(10px)',
              transition: 'opacity 0.3s ease, transform 0.3s ease',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ color: B.textMuted, fontSize: 10, fontFamily: B.mono, minWidth: 64 }}>{c.time}</span>
              <span style={{ color: B.textMd, fontSize: 12, flex: 1 }}>{c.carrier}</span>
              {c.note && <span style={{ color: B.textMuted, fontSize: 11 }}>{c.note}</span>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: meta.bg, padding: '3px 8px', borderRadius: 6, flexShrink: 0 }}>
                <Icon name={meta.icon} size={11} color={meta.color} strokeWidth={2} />
                <span style={{ color: meta.color, fontSize: 11, fontWeight: 600 }}>
                  {c.kind === 'resolved' ? fmtCAD(c.amount) : meta.label}
                </span>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ─── Act 5: Summary ───────────────────────────────────────────────────────────

const VALUE_ROWS = [
  { icon: 'dollar' as IconName, headline: '$18,580 recovered',               detail: "10 claims resolved. Money already earned, sitting at the carrier until today.", color: '#fff', bg: B.green    },
  { icon: 'clock'  as IconName, headline: '3.5 hours back to Sarah',         detail: 'She checked in 34 patients, scheduled 12 follow-ups, quoted 8 treatment plans.', color: '#fff', bg: '#92400E' },
  { icon: 'shield' as IconName, headline: '$5,400 saved from expiry',        detail: '2 claims within 3 weeks of appeal deadline. Both caught and resolved.',          color: '#fff', bg: '#5B21B6' },
  { icon: 'eye'    as IconName, headline: '58 claims, nothing in the dark', detail: "Every claim tracked, every status known. No longer relying on memory.",           color: '#fff', bg: '#0369A1' },
]

function ActSummary({ onComplete, paused }: { onComplete: () => void; paused: boolean }) {
  const [step, setStep] = useState(0)
  const fired = useRef(false)

  useEffect(() => {
    const t = [300, 750, 1200, 1650, 2800].map((ms, i) => setTimeout(() => setStep(i + 1), ms))
    return () => t.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    if (paused || fired.current) return
    const t = setTimeout(() => { fired.current = true; onComplete() }, 10500)
    return () => clearTimeout(t)
  }, [paused, onComplete])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '14px 20px', maxWidth: 600, margin: '0 auto', width: '100%', minHeight: 0 }}>
      <div style={{ marginBottom: 14, flexShrink: 0, opacity: step >= 1 ? 1 : 0, transition: 'opacity 0.5s ease' }}>
        <p style={{ color: B.textMuted, fontSize: 13 }}>5:00 PM · Your day at a glance.</p>
        <p style={{ color: B.green, fontSize: 12, fontWeight: 600, marginTop: 2 }}>Staff calls to carriers today: 0.</p>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', minHeight: 0 }}>
        {VALUE_ROWS.map((row, i) => (
          <div key={i} style={{
            flexShrink: 0, padding: '14px 18px', borderRadius: 12,
            opacity: step >= i + 2 ? 1 : 0, transform: step >= i + 2 ? 'none' : 'translateY(8px)',
            transition: 'opacity 0.5s ease, transform 0.5s ease',
            background: row.bg, boxShadow: `0 4px 18px ${row.bg}66`,
            display: 'flex', gap: 14, alignItems: 'flex-start',
          }}>
            <div style={{ background: 'rgba(255,255,255,0.18)', borderRadius: 8, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
              <Icon name={row.icon} size={18} color={row.color} />
            </div>
            <div>
              <div style={{ color: row.color, fontWeight: 800, fontSize: 15, marginBottom: 3 }}>{row.headline}</div>
              <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, lineHeight: 1.55 }}>{row.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Act 6: The Close ─────────────────────────────────────────────────────────

function ActClose() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const t = [300, 800, 1400, 2100].map((ms, i) => setTimeout(() => setStep(i + 1), ms))
    return () => t.forEach(clearTimeout)
  }, [])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 20px', maxWidth: 640, margin: '0 auto', width: '100%', minHeight: 0, overflowY: 'auto' }}>

      {/* Headline */}
      <div style={{ marginBottom: 18, flexShrink: 0, opacity: step >= 1 ? 1 : 0, transform: step >= 1 ? 'none' : 'translateY(8px)', transition: 'all 0.5s ease' }}>
        <p style={{ color: B.green, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>You're the founding practice</p>
        <h2 style={{ fontSize: 'clamp(18px, 3vw, 26px)', fontWeight: 800, color: B.text, letterSpacing: '-0.5px', lineHeight: 1.2 }}>
          Here's what we're proposing.
        </h2>
      </div>

      {/* Deal terms */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14, flexShrink: 0, opacity: step >= 2 ? 1 : 0, transform: step >= 2 ? 'none' : 'translateY(8px)', transition: 'all 0.5s ease' }}>
        <Card style={{ padding: '16px 18px', background: B.greenLt, border: `1px solid ${B.green}30` }}>
          <p style={{ color: B.green, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>What you get</p>
          {[
            { icon: 'phone'  as IconName, text: 'Full carrier automation across all 6 Canadian carriers, every business day' },
            { icon: 'eye'    as IconName, text: 'Live dashboard: every claim, every status, every morning' },
            { icon: 'shield' as IconName, text: 'Direct line to the founder throughout the pilot' },
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: i < 2 ? 10 : 0 }}>
              <div style={{ background: B.green, borderRadius: 6, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                <Icon name={item.icon} size={12} color="#fff" />
              </div>
              <span style={{ color: B.textMd, fontSize: 12, lineHeight: 1.5 }}>{item.text}</span>
            </div>
          ))}
        </Card>

        <Card style={{ padding: '16px 18px' }}>
          <p style={{ color: B.textMuted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>What it takes</p>
          {[
            { icon: 'clock'       as IconName, text: `One afternoon to connect ${PMS_CONNECT_LINE} (we do it together)`, accent: false },
            { icon: 'refresh'     as IconName, text: '30 days to see real results in your AR', accent: false },
            { icon: 'check-circle'as IconName, text: 'Zero cost during the pilot', accent: true },
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: i < 2 ? 10 : 0 }}>
              <div style={{ background: item.accent ? B.greenLt : B.bg, border: `1px solid ${item.accent ? B.green + '44' : B.border}`, borderRadius: 6, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                <Icon name={item.icon} size={12} color={item.accent ? B.green : B.textMuted} />
              </div>
              <span style={{ color: B.textMd, fontSize: 12, lineHeight: 1.5 }}>{item.text}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* Urgency bar */}
      <div style={{ flexShrink: 0, marginBottom: 14, opacity: step >= 3 ? 1 : 0, transform: step >= 3 ? 'none' : 'translateY(8px)', transition: 'all 0.5s ease' }}>
        <div style={{ background: B.redLt, border: `1px solid ${B.red}33`, borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flexShrink: 0, marginTop: 1 }}><Icon name="warning" size={16} color={B.red} strokeWidth={2} /></div>
          <div>
            <p style={{ color: B.red, fontWeight: 700, fontSize: 13, marginBottom: 3 }}>Your 84-day Sun Life claim has 6 days before the 90-day soft deadline.</p>
            <p style={{ color: B.textMuted, fontSize: 12 }}>After 90 days, carrier recovery rates drop significantly. That's $2,340 at risk right now, and it is one of three claims in this window.</p>
          </div>
        </div>
      </div>

      {/* The ask */}
      {step >= 4 && (
        <div style={{ flexShrink: 0, animation: 'fadeUp 0.5s ease' }}>
          <div style={{ background: B.greenDk, borderRadius: 14, padding: '22px 24px', textAlign: 'center' }}>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>The ask</p>
            <p style={{ color: '#fff', fontWeight: 800, fontSize: 'clamp(16px, 2.5vw, 22px)', letterSpacing: '-0.5px', lineHeight: 1.3, marginBottom: 8 }}>
              One afternoon to connect {PMS_CONNECT_SHORT}.<br />Calls start the next business morning.
            </p>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 20 }}>
              At today's pace: $18,580 in one morning. Five mornings a week.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <a
                href="https://calendly.com/collectrx/pilot-setup"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', color: B.greenDk, padding: '12px 28px', borderRadius: 9, fontWeight: 800, fontSize: 14, textDecoration: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}
              >
                Book your setup call <Icon name="arrow-right" size={15} color={B.greenDk} />
              </a>
              <a
                href="tel:+1-your-number"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', padding: '12px 24px', borderRadius: 9, fontWeight: 600, fontSize: 13, textDecoration: 'none' }}
              >
                <Icon name="phone" size={13} color="#fff" /> Call Khalid
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function PilotDemo() {
  const [act, setAct]       = useState<Act>('idle')
  const [paused, setPaused] = useState(false)
  const idx = ACTS.indexOf(act)

  const advance = useCallback(() => {
    setAct(prev => { const i = ACTS.indexOf(prev); return i < ACTS.length - 1 ? ACTS[i + 1] : prev })
  }, [])

  useEffect(() => { setPaused(false) }, [act])

  return (
    <div style={{ height: '100vh', background: B.bg, color: B.text, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <header style={{ background: B.greenDk, padding: '11px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="white">
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" /><path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
            </svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>CollectRx</span>
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>·</span>
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>{PRACTICE}</span>
        </div>

        {act !== 'idle' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', gap: 5 }}>
              {ACTS.map((s, i) => (
                <button key={s} onClick={() => setAct(s)} title={ACT_LABELS[s]} style={{
                  height: 5, borderRadius: 3, border: 'none', cursor: 'pointer', padding: 0, transition: 'all 0.3s ease',
                  width: i === idx ? 24 : 5,
                  background: i < idx ? '#6EE7B7' : i === idx ? '#fff' : 'rgba(255,255,255,0.2)',
                }} />
              ))}
            </div>
            <button onClick={() => setPaused(p => !p)} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 6, width: 30, height: 30, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={paused ? 'play' : 'pause'} size={12} color="#fff" strokeWidth={2} />
            </button>
            <button onClick={() => { setAct('idle'); setPaused(false) }} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.7)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>
              ↺ Restart
            </button>
          </div>
        )}
      </header>

      {/* Act label + animated progress bar */}
      {act !== 'idle' && (
        <div style={{ background: B.greenDk, borderBottom: `2px solid ${B.green}`, flexShrink: 0 }}>
          <div style={{ padding: '5px 20px 0' }}>
            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>{ACT_LABELS[act]}</span>
          </div>
          <ActProgressBar act={act} paused={paused} />
        </div>
      )}

      {/* Idle / opening screen */}
      {act === 'idle' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center', background: `linear-gradient(160deg, ${B.greenDk} 0%, #1A4A3A 52%, ${B.bg} 52%)` }}>
          <div style={{ background: B.surface, borderRadius: 20, padding: '40px 48px', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.18)', border: `1px solid ${B.border}` }}>
            <div style={{ display: 'inline-flex', background: B.greenLt, borderRadius: 20, padding: '4px 14px', marginBottom: 20 }}>
              <span style={{ color: B.green, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Pilot Demo · {PRACTICE}</span>
            </div>
            <h1 style={{ fontSize: 'clamp(20px, 3.5vw, 32px)', fontWeight: 800, letterSpacing: '-0.8px', color: B.text, lineHeight: 1.2, marginBottom: 14 }}>
              Your AR is already earned.<br />You just haven't collected it yet.
            </h1>
            <p style={{ color: B.textMuted, fontSize: 14, maxWidth: 360, margin: '0 auto 28px', lineHeight: 1.65 }}>
              A 60-second walkthrough of exactly how CollectRx fixes that, using your practice's numbers.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
              <button onClick={() => setAct('problem')} style={{ background: B.green, color: '#fff', border: 'none', borderRadius: 10, padding: '14px 40px', fontSize: 15, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: `0 4px 20px ${B.green}55` }}>
                Show me <Icon name="arrow-right" size={16} color="#fff" />
              </button>
              <a href="/demo/process" style={{ color: B.green, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                Or watch the live process demo →
              </a>
            </div>
          </div>
        </div>
      )}

      {act === 'problem'  && <ActProblem  onComplete={advance} paused={paused} />}
      {act === 'oldway'   && <ActOldWay   onComplete={advance} paused={paused} />}
      {act === 'pipeline' && <ActPipeline onComplete={advance} paused={paused} />}
      {act === 'scale'    && <ActScale    onComplete={advance} paused={paused} />}
      {act === 'summary'  && <ActSummary  onComplete={advance} paused={paused} />}
      {act === 'close'    && <ActClose />}

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 0; }
        @keyframes fillBar { from { width: 0 } to { width: 100% } }
        @keyframes fadeUp  { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
      `}</style>
    </div>
  )
}
