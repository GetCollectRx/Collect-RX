import { useState, useEffect } from 'react'

// ─── Brand tokens ────────────────────────────────────────────────────────────

const B = {
  bg:        '#F7F4EF',   // cream page background
  surface:   '#FFFFFF',   // card surface
  border:    '#E8E2D8',   // card border
  borderMd:  '#D4CEC4',   // medium border
  green:     '#0F6E56',   // CollectRx green
  greenLt:   '#E6F2EE',   // light green tint
  greenMd:   '#1A8A6A',   // mid green
  red:       '#C0392B',
  redLt:     '#FDECEA',
  amber:     '#B45309',
  amberLt:   '#FEF3C7',
  text:      '#1C1C1E',
  textMd:    '#4A4A4A',
  textMuted: '#8A8A8A',
  mono:      "'JetBrains Mono', 'Fira Code', monospace",
}

// ─── Brand icon set ──────────────────────────────────────────────────────────

type IconName = 'dollar' | 'clock' | 'shield' | 'eye' | 'phone' | 'warning' | 'x-circle' | 'check-circle' | 'chevron-right' | 'arrow-right' | 'refresh' | 'user' | 'chart'

const PATHS: Record<IconName, string> = {
  dollar:        'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
  clock:         'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm0-10V7m0 5l3 3',
  shield:        'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  eye:           'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 12m-3 0a3 3 0 106 0 3 3 0 00-6 0',
  phone:         'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z',
  warning:       'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4m0 4h.01',
  'x-circle':    'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm3-13l-6 6m0-6l6 6',
  'check-circle':'M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3',
  'chevron-right':'M9 18l6-6-6-6',
  'arrow-right':  'M5 12h14m-7-7l7 7-7 7',
  refresh:        'M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15',
  user:           'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  chart:          'M18 20V10M12 20V4M6 20v-6',
}

function Icon({ name, size = 16, color = B.green, strokeWidth = 1.8 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d={PATHS[name]} />
    </svg>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Acts ─────────────────────────────────────────────────────────────────────

type Act = 'idle' | 'problem' | 'oldway' | 'pipeline' | 'scale' | 'summary'

// ── Shared card ──────────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: B.surface, border: `1px solid ${B.border}`, borderRadius: 12, ...style }}>
      {children}
    </div>
  )
}

// ── Act 1: The Problem ────────────────────────────────────────────────────────

function ActProblem({ onNext }: { onNext: () => void }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const t = [
      setTimeout(() => setStep(1), 400),
      setTimeout(() => setStep(2), 1000),
      setTimeout(() => setStep(3), 1700),
    ]
    return () => t.forEach(clearTimeout)
  }, [])

  const stats = [
    { value: '$107,510', label: 'Owed by carriers', sub: 'for work already done', icon: 'dollar' as IconName, color: B.green, bg: B.greenLt },
    { value: '22 claims', label: 'Over 30 days old', sub: 'no one has called yet', icon: 'clock' as IconName, color: B.amber, bg: B.amberLt },
    { value: '3 claims', label: 'Near deadline', sub: 'appeal window closing', icon: 'warning' as IconName, color: B.red, bg: B.redLt },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 20px', textAlign: 'center', gap: 0 }}>
      <p style={{ color: B.textMuted, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 18 }}>
        Monday · June 9 · 8:00 AM · Before your first patient
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, maxWidth: 540, width: '100%', marginBottom: 28 }}>
        {stats.map((s, i) => (
          <Card key={s.label} style={{
            padding: '18px 14px',
            opacity: step > i ? 1 : 0, transform: step > i ? 'none' : 'translateY(8px)',
            transition: 'opacity 0.5s ease, transform 0.5s ease',
            background: s.bg, border: `1px solid ${s.color}33`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
              <Icon name={s.icon} size={22} color={s.color} />
            </div>
            <div style={{ fontSize: 'clamp(16px, 2.5vw, 22px)', fontWeight: 800, color: s.color, fontFamily: B.mono, marginBottom: 5 }}>{s.value}</div>
            <div style={{ color: B.textMd, fontSize: 12, fontWeight: 600 }}>{s.label}</div>
            <div style={{ color: B.textMuted, fontSize: 11, marginTop: 2 }}>{s.sub}</div>
          </Card>
        ))}
      </div>

      <p style={{ color: B.textMuted, fontSize: 14, maxWidth: 380, lineHeight: 1.65, marginBottom: 28, opacity: step >= 3 ? 1 : 0, transition: 'opacity 0.6s ease 0.3s' }}>
        Sarah, your front desk coordinator, arrives. She knows the backlog. She picks up the phone.
      </p>

      <button onClick={onNext} style={{
        background: 'none', border: `1px solid ${B.borderMd}`, color: B.textMuted,
        borderRadius: 8, padding: '10px 28px', cursor: 'pointer', fontSize: 13,
        opacity: step >= 3 ? 1 : 0, transition: 'opacity 0.4s ease 0.6s',
        display: 'flex', alignItems: 'center', gap: 6, margin: '0 auto',
      }}>
        See what happens <Icon name="arrow-right" size={14} color={B.textMuted} />
      </button>
    </div>
  )
}

// ── Act 2: The Old Way ────────────────────────────────────────────────────────

const OLD_WAY_EVENTS = [
  { time: '8:02 AM', icon: 'phone' as IconName, iconColor: B.textMuted, text: 'Sarah calls Sun Life', hold: '18 min on hold', outcome: '1 claim checked', bad: false },
  { time: '9:14 AM', icon: 'phone' as IconName, iconColor: B.textMuted, text: 'Sarah calls Canada Life', hold: '31 min on hold', outcome: 'Disconnected. No status.', bad: true },
  { time: '10:08 AM', icon: 'phone' as IconName, iconColor: B.textMuted, text: 'Sarah calls Manulife', hold: '22 min on hold', outcome: '1 claim checked', bad: false },
  { time: '11:00 AM', icon: 'warning' as IconName, iconColor: B.amber, text: 'Patients backing up at reception', hold: null, outcome: 'Sarah puts the phone down. 19 claims still waiting.', bad: true },
  { time: 'Last quarter', icon: 'x-circle' as IconName, iconColor: B.red, text: 'Claim #CL-2024-8842 expired quietly', hold: '$2,400 crown · 90 days old · appeal window closed', outcome: 'Written off. You never knew.', bad: true, loss: true },
]

function ActOldWay({ onNext }: { onNext: () => void }) {
  const [visible, setVisible] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    OLD_WAY_EVENTS.forEach((_, i) => timers.push(setTimeout(() => setVisible(i + 1), 700 + i * 1600)))
    timers.push(setTimeout(() => setDone(true), 700 + OLD_WAY_EVENTS.length * 1600 + 500))
    return () => timers.forEach(clearTimeout)
  }, [])

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
            background: e.loss ? B.redLt : B.surface,
            border: `1px solid ${e.loss ? B.red + '44' : B.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon name={e.icon} size={14} color={e.iconColor} />
              <span style={{ color: B.textMuted, fontSize: 10, fontFamily: B.mono, minWidth: 68 }}>{e.time}</span>
              <span style={{ color: B.textMd, fontSize: 12, flex: 1, fontWeight: 500 }}>{e.text}</span>
            </div>
            {e.hold && <div style={{ marginTop: 4, marginLeft: 24, color: B.textMuted, fontSize: 11 }}>{e.hold}</div>}
            <div style={{ marginTop: 4, marginLeft: 24, color: e.loss ? B.red : B.textMuted, fontSize: 11, fontWeight: e.loss ? 700 : 400 }}>
              → {e.outcome}
            </div>
          </Card>
        ))}
      </div>

      {done && (
        <Card style={{ marginTop: 12, padding: '14px 18px', flexShrink: 0, background: B.redLt, border: `1px solid ${B.red}33` }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
            {[
              { label: 'Time spent', value: '3.5 hrs' },
              { label: 'Claims checked', value: '2 of 22' },
              { label: 'Recovered', value: '$0' },
              { label: 'Lost to expiry', value: '$2,400' },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: B.red, fontFamily: B.mono }}>{s.value}</div>
                <div style={{ color: B.textMuted, fontSize: 10, marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <button onClick={onNext} style={{ width: '100%', background: B.green, color: '#fff', border: 'none', borderRadius: 8, padding: '11px', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            See what CollectRx does instead <Icon name="arrow-right" size={14} color="#fff" />
          </button>
        </Card>
      )}
    </div>
  )
}

// ── Act 3: The Pipeline ───────────────────────────────────────────────────────

const PIPELINE_STEPS = [
  {
    name: 'Phone Navigator',
    role: 'Gets past the phone tree',
    steps: ['Dialed Sun Life claims line', 'Navigated menus: Claims → Status → Dental', '4:12 on hold — no staff needed'],
    duration: 3200,
  },
  {
    name: 'Claims Specialist',
    role: 'Speaks with the carrier rep',
    steps: ['Jennifer M. answered', 'Stated claim #, patient details, procedure date', 'Asked for adjudication status'],
    duration: 3200,
  },
  {
    name: 'Resolution Agent',
    role: 'Records and confirms the outcome',
    steps: ['Claim adjudicated in full', 'Payment $1,840 EFT by June 21', 'Reference SL-847291 confirmed'],
    duration: 2400,
  },
]

function ActPipeline({ onNext }: { onNext: () => void }) {
  const [agentIdx, setAgentIdx] = useState(-1)
  const [stepIdx, setStepIdx] = useState(0)
  const [resolved, setResolved] = useState(false)
  const [showNext, setShowNext] = useState(false)

  useEffect(() => {
    let delay = 600
    PIPELINE_STEPS.forEach((agent, ai) => {
      setTimeout(() => { setAgentIdx(ai); setStepIdx(0) }, delay)
      agent.steps.forEach((_, si) => setTimeout(() => setStepIdx(si + 1), delay + 400 + si * 700))
      delay += agent.duration
    })
    setTimeout(() => setResolved(true), delay + 400)
    setTimeout(() => setShowNext(true), delay + 1200)
  }, [])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '14px 20px', maxWidth: 600, margin: '0 auto', width: '100%', minHeight: 0 }}>

      <Card style={{
        padding: '14px 18px', marginBottom: 14, flexShrink: 0,
        background: resolved ? B.greenLt : B.surface,
        border: `1px solid ${resolved ? B.green + '55' : B.border}`,
        transition: 'all 0.6s ease',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
      }}>
        <div>
          <div style={{ color: B.text, fontWeight: 700, fontSize: 14 }}>Sun Life · SL-2025-002341</div>
          <div style={{ color: B.textMuted, fontSize: 12, marginTop: 2 }}>Crown procedure · 47 days outstanding</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {resolved ? (
            <>
              <div style={{ color: B.green, fontWeight: 800, fontSize: 17, fontFamily: B.mono }}>$1,840 recovered</div>
              <div style={{ color: B.textMuted, fontSize: 11 }}>EFT June 21 · Ref SL-847291</div>
            </>
          ) : (
            <div style={{ color: B.amber, fontWeight: 600, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="phone" size={12} color={B.amber} /> Calling now
            </div>
          )}
        </div>
      </Card>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', minHeight: 0 }}>
        {PIPELINE_STEPS.map((agent, ai) => {
          const isActive = agentIdx === ai
          const isDone = agentIdx > ai || resolved
          return (
            <Card key={ai} style={{
              padding: '12px 16px',
              background: isActive ? B.greenLt : isDone ? '#FAFAFA' : B.surface,
              border: `1px solid ${isActive ? B.green + '55' : B.border}`,
              transition: 'all 0.4s ease',
              opacity: agentIdx < ai && !isDone ? 0.4 : 1,
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  background: isDone ? B.green : isActive ? B.greenLt : B.border,
                  border: `1.5px solid ${isDone ? B.green : isActive ? B.green : B.borderMd}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.4s ease',
                }}>
                  {isDone
                    ? <Icon name="check-circle" size={13} color="#fff" strokeWidth={2.5} />
                    : <span style={{ color: isActive ? B.green : B.textMuted, fontSize: 11, fontWeight: 700 }}>{ai + 1}</span>
                  }
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

      {showNext && (
        <button onClick={onNext} style={{ marginTop: 12, background: B.green, color: '#fff', border: 'none', borderRadius: 8, padding: '11px', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          That happened on 9 other claims at the same time <Icon name="arrow-right" size={14} color="#fff" />
        </button>
      )}
    </div>
  )
}

// ── Act 4: At Scale ───────────────────────────────────────────────────────────

const SCALE_CALLS = [
  { carrier: 'Canada Life',       amount: 980,  kind: 'resolved',   time: '8:14 AM' },
  { carrier: 'Manulife',          amount: 1560, kind: 'resolved',   time: '8:52 AM' },
  { carrier: 'Green Shield',      amount: 890,  kind: 'escalated',  time: '8:54 AM', note: 'x-rays required — flagged' },
  { carrier: 'Sun Life',          amount: 2200, kind: 'resolved',   time: '9:27 AM' },
  { carrier: 'Canada Life',       amount: 1380, kind: 'resolved',   time: '9:41 AM' },
  { carrier: 'Manulife',          amount: 3180, kind: 'processing', time: '9:58 AM', note: 'follow-up in 7 days' },
  { carrier: 'RBC Insurance',     amount: 760,  kind: 'resolved',   time: '10:35 AM' },
  { carrier: 'Sun Life',          amount: 3200, kind: 'resolved',   time: '11:06 AM' },
  { carrier: 'TELUS AdjudiCare',  amount: 1120, kind: 'resolved',   time: '11:31 AM' },
]

const KIND_META: Record<string, { color: string; bg: string; label: string; icon: IconName }> = {
  resolved:   { color: B.green,  bg: B.greenLt, label: 'Resolved',   icon: 'check-circle' },
  escalated:  { color: B.amber,  bg: B.amberLt, label: 'Flagged',    icon: 'warning'      },
  processing: { color: B.textMuted, bg: '#F5F5F5', label: 'Follow-up', icon: 'refresh'   },
  denied:     { color: B.red,    bg: B.redLt,   label: 'Denied',     icon: 'x-circle'     },
}

function ActScale({ onNext }: { onNext: () => void }) {
  const [visible, setVisible] = useState(0)
  const [totalRecovered, setTotalRecovered] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    SCALE_CALLS.forEach((c, i) => {
      setTimeout(() => {
        setVisible(i + 1)
        if (c.kind === 'resolved') setTotalRecovered(p => p + c.amount)
      }, 400 + i * 800)
    })
    setTimeout(() => setDone(true), 400 + SCALE_CALLS.length * 800 + 500)
  }, [])

  const display = useCountUp(totalRecovered, true)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '14px 20px', maxWidth: 600, margin: '0 auto', width: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <p style={{ color: B.green, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3, fontWeight: 600 }}>Simultaneously</p>
          <h3 style={{ color: B.text, fontWeight: 700, fontSize: 16 }}>9 other calls running in parallel</h3>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: B.green, fontFamily: B.mono }}>{fmtCAD(display)}</div>
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

      {done && (
        <button onClick={onNext} style={{ marginTop: 12, background: B.green, color: '#fff', border: 'none', borderRadius: 8, padding: '11px', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          See your end-of-day summary <Icon name="arrow-right" size={14} color="#fff" />
        </button>
      )}
    </div>
  )
}

// ── Act 5: Summary ────────────────────────────────────────────────────────────

const VALUE_ROWS: { icon: IconName; headline: string; detail: string; color: string; bg: string }[] = [
  {
    icon: 'dollar',
    headline: '$18,580 recovered',
    detail: "10 claims resolved. Money you'd already earned — sitting at the carrier until today.",
    color: B.green, bg: B.greenLt,
  },
  {
    icon: 'clock',
    headline: '3.5 hours back to Sarah',
    detail: 'She checked in 34 patients, scheduled 12 follow-ups, quoted 8 treatment plans.',
    color: B.amber, bg: B.amberLt,
  },
  {
    icon: 'shield',
    headline: '$5,400 saved from expiry',
    detail: '2 claims were within 3 weeks of their appeal deadline. Both caught and resolved.',
    color: '#7C3AED', bg: '#F5F0FF',
  },
  {
    icon: 'eye',
    headline: '58 claims — nothing in the dark',
    detail: "Every claim tracked, every status known. You're not relying on memory anymore.",
    color: '#0369A1', bg: '#EFF6FF',
  },
]

function ActSummary() {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const t = [300, 750, 1200, 1650, 2400].map((ms, i) => setTimeout(() => setStep(i + 1), ms))
    return () => t.forEach(clearTimeout)
  }, [])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '14px 20px', maxWidth: 600, margin: '0 auto', width: '100%', minHeight: 0 }}>
      <div style={{ marginBottom: 14, flexShrink: 0, opacity: step >= 1 ? 1 : 0, transition: 'opacity 0.5s ease' }}>
        <p style={{ color: B.textMuted, fontSize: 13 }}>5:00 PM · Your day at a glance.</p>
        <p style={{ color: B.green, fontSize: 12, fontWeight: 600, marginTop: 2 }}>Staff calls to carriers: 0.</p>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', minHeight: 0 }}>
        {VALUE_ROWS.map((row, i) => (
          <Card key={i} style={{
            flexShrink: 0, padding: '14px 16px',
            opacity: step >= i + 2 ? 1 : 0, transform: step >= i + 2 ? 'none' : 'translateY(8px)',
            transition: 'opacity 0.5s ease, transform 0.5s ease',
            background: row.bg, border: `1px solid ${row.color}22`,
            display: 'flex', gap: 14, alignItems: 'flex-start',
          }}>
            <div style={{ background: '#fff', border: `1.5px solid ${row.color}33`, borderRadius: 8, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon name={row.icon} size={18} color={row.color} />
            </div>
            <div>
              <div style={{ color: B.text, fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{row.headline}</div>
              <div style={{ color: B.textMd, fontSize: 12, lineHeight: 1.55 }}>{row.detail}</div>
            </div>
          </Card>
        ))}
      </div>

      {step >= 5 && (
        <Card style={{ marginTop: 12, padding: '16px 18px', flexShrink: 0, background: B.greenLt, border: `1px solid ${B.green}33` }}>
          <p style={{ color: B.text, fontWeight: 700, fontSize: 15, marginBottom: 5 }}>This is every business day.</p>
          <p style={{ color: B.textMd, fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
            Connect your Abeldent database — one afternoon of setup — and we start calling tomorrow morning.
          </p>
          <a
            href="mailto:khalidegeh97@gmail.com?subject=CollectRx pilot setup"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: B.green, color: '#fff', padding: '10px 24px', borderRadius: 8, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}
          >
            Let's get started <Icon name="arrow-right" size={14} color="#fff" />
          </a>
        </Card>
      )}
    </div>
  )
}

// ─── Progress dots ────────────────────────────────────────────────────────────

const ACTS: Act[] = ['problem', 'oldway', 'pipeline', 'scale', 'summary']
const ACT_LABELS: Record<Act, string> = {
  idle: '', problem: 'The situation', oldway: 'Without CollectRx',
  pipeline: 'How it works', scale: 'At scale', summary: 'Your outcome',
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function PilotDemo() {
  const [act, setAct] = useState<Act>('idle')
  const idx = ACTS.indexOf(act)

  return (
    <div style={{
      height: '100vh', background: B.bg, color: B.text,
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <header style={{
        background: B.surface, borderBottom: `1px solid ${B.border}`,
        padding: '11px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: 6, background: B.green, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="white">
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" /><path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
            </svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: 14, color: B.text }}>CollectRx</span>
          <span style={{ color: B.border, fontSize: 16 }}>·</span>
          <span style={{ color: B.textMuted, fontSize: 13 }}>Hasan Family Dental</span>
        </div>

        {act !== 'idle' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ display: 'flex', gap: 5 }}>
              {ACTS.map((s, i) => (
                <div key={s} style={{
                  height: 6, borderRadius: 3, transition: 'all 0.3s ease',
                  width: i === idx ? 22 : 6,
                  background: i < idx ? B.green : i === idx ? B.green : B.border,
                }} />
              ))}
            </div>
            <button onClick={() => setAct('idle')} style={{ background: 'none', border: `1px solid ${B.border}`, color: B.textMuted, borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Icon name="refresh" size={11} color={B.textMuted} /> Restart
            </button>
          </div>
        )}
      </header>

      {/* Act label */}
      {act !== 'idle' && (
        <div style={{ padding: '7px 20px', background: B.surface, borderBottom: `1px solid ${B.border}`, flexShrink: 0 }}>
          <span style={{ color: B.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>
            {ACT_LABELS[act]}
          </span>
        </div>
      )}

      {/* Idle */}
      {act === 'idle' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center', gap: 24 }}>
          <div>
            <h1 style={{ fontSize: 'clamp(22px, 4vw, 38px)', fontWeight: 800, letterSpacing: '-0.8px', color: B.text, lineHeight: 1.2, marginBottom: 14 }}>
              Your AR is already earned.<br />You just haven't collected it yet.
            </h1>
            <p style={{ color: B.textMuted, fontSize: 15, maxWidth: 400, margin: '0 auto' }}>
              A walkthrough of exactly how CollectRx fixes that — for your practice, in your numbers.
            </p>
          </div>
          <button
            onClick={() => setAct('problem')}
            style={{ background: B.green, color: '#fff', border: 'none', borderRadius: 10, padding: '13px 36px', fontSize: 15, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, margin: '0 auto' }}
          >
            <Icon name="arrow-right" size={16} color="#fff" /> Show me
          </button>
        </div>
      )}

      {act === 'problem'  && <ActProblem  onNext={() => setAct('oldway')} />}
      {act === 'oldway'   && <ActOldWay   onNext={() => setAct('pipeline')} />}
      {act === 'pipeline' && <ActPipeline onNext={() => setAct('scale')} />}
      {act === 'scale'    && <ActScale    onNext={() => setAct('summary')} />}
      {act === 'summary'  && <ActSummary />}

      <style>{`* { box-sizing: border-box; margin: 0; padding: 0; } ::-webkit-scrollbar { width: 0; }`}</style>
    </div>
  )
}
