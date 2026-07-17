import { useState, useEffect, useRef } from 'react'
import { TIERS } from '../billing/tiers'
import { MARKETING_TIER_FEATURES } from '../website/pricingContent'

// ─── Brand ────────────────────────────────────────────────────────────────────

const G = {
  greenDk:   '#0A5240',
  green:     '#0F6E56',
  greenLt:   '#D6EDE6',
  cream:     '#F0ECE4',
  white:     '#FFFFFF',
  border:    '#DDD7CC',
  text:      '#111111',
  textMd:    '#3D3D3D',
  textMuted: '#777777',
  red:       '#B91C1C',
  redLt:     '#FEE2E2',
  amber:     '#92400E',
  amberLt:   '#FDE68A',
  blue:      '#0369A1',
  blueLt:    '#EFF6FF',
  purple:    '#5B21B6',
  purpleLt:  '#F5F0FF',
  mono:      "'JetBrains Mono','Fira Code',monospace",
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true) }, { threshold })
    obs.observe(el); return () => obs.disconnect()
  }, [threshold])
  return { ref, visible }
}

function AnimatedNum({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    const steps = 40; let i = 0
    const t = setInterval(() => { i++; setN(Math.round(value * i / steps)); if (i >= steps) clearInterval(t) }, 30)
    return () => clearInterval(t)
  }, [value])
  return <>{n}{suffix}</>
}

function Section({ children, bg = G.white, id }: { children: React.ReactNode; bg?: string; id?: string }) {
  return (
    <section id={id} style={{ background: bg, padding: 'clamp(48px,6vw,80px) 24px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>{children}</div>
    </section>
  )
}

function Label({ text, color = G.green }: { text: string; color?: string }) {
  return <p style={{ color, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>{text}</p>
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 'clamp(22px,3.5vw,36px)', fontWeight: 800, color: G.text, letterSpacing: '-0.6px', lineHeight: 1.2, marginBottom: 14 }}>{children}</h2>
}

function Lead({ children, maxWidth = 640 }: { children: React.ReactNode; maxWidth?: number }) {
  return <p style={{ color: G.textMd, fontSize: 15, lineHeight: 1.7, maxWidth }}>{children}</p>
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: G.white, border: `1px solid ${G.border}`, borderRadius: 14, ...style }}>{children}</div>
}

function Check({ color = G.green }: { color?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M20 6L9 17l-5-5"/>
    </svg>
  )
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const OUTCOMES = [
  { id: 'resolved',   label: 'Resolved',    icon: '✓', color: G.green,     bg: G.greenLt,
    headline: 'Payment confirmed',
    description: 'The carrier confirmed the claim was adjudicated and payment is processing. The Resolution Agent extracts the EFT date, amount, and reference number.',
    nextStep: 'Claim marked resolved. Dashboard updated. No further action needed.',
    example: 'Sun Life confirmed $1,840 EFT by June 21. Ref: SL-847291.' },
  { id: 'processing', label: 'Processing',  icon: '⟳', color: G.blue,      bg: G.blueLt,
    headline: 'Still in adjudication',
    description: 'The carrier confirmed the claim was received and is in process, but no payment date yet. CollectRx schedules a follow-up automatically.',
    nextStep: 'Follow-up call scheduled in 7 days. No staff action required.',
    example: 'Canada Life: claim received June 1, in adjudication. ETA 5 business days.' },
  { id: 'escalated',  label: 'Escalated',   icon: '⚠', color: G.amber,     bg: G.amberLt,
    headline: 'Needs your attention',
    description: 'The carrier needs something from the practice before processing can continue. CollectRx identifies exactly what is needed and flags it.',
    nextStep: 'Flagged in dashboard with specific action required. Staff resolves, claim re-queues.',
    example: 'Green Shield: clinical notes and x-rays requested. Deadline June 23.' },
  { id: 'denied',     label: 'Denied',      icon: '✕', color: G.red,       bg: G.redLt,
    headline: 'Claim denied',
    description: 'The carrier denied the claim with a specific reason code. CollectRx categorizes the denial and routes it to the appropriate next action.',
    nextStep: 'Denial reason logged. Appeal window tracked. Staff notified if action is possible.',
    example: 'Sun Life: D2740 not covered under current plan. Appeal window: 12 months.' },
  { id: 'resubmit',   label: 'Resubmit',    icon: '↩', color: G.purple,    bg: G.purpleLt,
    headline: 'Resubmission required',
    description: 'The carrier could not process the claim due to missing or incorrect information on the original submission.',
    nextStep: 'Specific correction identified. Staff corrects and resubmits through Abeldent.',
    example: 'Manulife: missing NPI number on submission. Correct and resubmit.' },
  { id: 'no_answer',  label: 'No answer',   icon: '○', color: G.textMuted, bg: '#F5F5F5',
    headline: 'Could not reach carrier',
    description: 'The carrier line was busy, disconnected, or exceeded hold time limits. CollectRx schedules the next attempt automatically.',
    nextStep: 'Retry scheduled within 24 hours. Up to 3 attempts before escalation.',
    example: 'Canada Life: disconnected after 31 min hold. Retry tomorrow.' },
]

const CARRIERS = [
  { id: 'sun_life',   name: 'Sun Life',        color: '#C44C00', market: '28%', wait: 32, prev: 100, basic: 80, major: 50, max: 1500, notes: 'EFT within 2 business days of approval. 12-month ortho wait. Standard COB.' },
  { id: 'canada_life',name: 'Canada Life',     color: '#C8102E', market: '22%', wait: 32, prev: 100, basic: 80, major: 50, max: 1500, notes: '5 business day SLA. Do not call before day 7. Large group insurer.' },
  { id: 'manulife',   name: 'Manulife',        color: '#B30000', market: '18%', wait: 32, prev: 100, basic: 70, major: 50, max: 1000, notes: 'Large group plans. COB rules apply. Ortho lifetime max tracked separately.' },
  { id: 'green_shield',name: 'Green Shield',   color: '#007A3E', market: '7%',  wait: 32, prev: 100, basic: 80, major: 60, max: 2000, notes: 'Direct-pay model. Frequent documentation requests. Higher major coverage.' },
  { id: 'rbc',        name: 'RBC Insurance',   color: '#003DA5', market: '2%',  wait: 32, prev: 100, basic: 80, major: 50, max: 1500, notes: '6-month appeal window. Faster hold times than national carriers.' },
  { id: 'telus',      name: 'TELUS AdjudiCare',color: '#4B286D', market: '1%',  wait: 21, prev: 100, basic: 80, major: 50, max: 1500, notes: 'Clearinghouse only. TPA identified from group number prefix. Min wait: day 21.' },
]

const WORKFLOW = [
  { n: '01', title: 'Claims sync from Abeldent',         detail: 'A lightweight service on your Windows machine reads new claims from your Abeldent database every hour. Claims under 30 days old are held. Anything 31 days and older enters the queue automatically.' },
  { n: '02', title: 'Priority engine scores each claim',  detail: 'Every eligible claim is scored daily across four dimensions: days outstanding, dollar amount, carrier-specific appeal deadlines, and call history. Highest-priority claims are called first.' },
  { n: '03', title: 'Agent squad calls Mon-Fri 8am-5pm',  detail: 'Four specialized AI agents work as a team. The Phone Navigator handles the IVR, the Claims Specialist speaks with the rep, and the Resolution Agent records the structured outcome. Max 3 attempts per claim.' },
  { n: '04', title: 'Outcomes extracted, dashboard live', detail: 'After every call, structured data is extracted: payment amount, EFT date, reference number, denial code, or required next action. Your dashboard updates in real time. Escalations are flagged immediately.' },
]

const AGENTS = [
  { name: 'Phone Navigator',    role: 'IVR specialist',       color: G.blue,   bg: G.blueLt,   desc: 'Dials the carrier claims line, listens to menus, and navigates the phone tree to reach the claims department. Handles holds up to 8 minutes for claims over $1,000.', handles: ['Multi-level IVR navigation','Hold time management','Voicemail detection','Department transfer routing'] },
  { name: 'Claims Specialist',  role: 'Rep conversation',     color: G.purple, bg: G.purpleLt, desc: 'Speaks naturally with the carrier rep. States claim details, asks for status, and probes for specific actionable information. Never guesses on financial decisions.', handles: ['Claim authentication','Status inquiry','Denial reason extraction','Supervisor escalation request'] },
  { name: 'Escalation Agent',   role: 'Complex denials',      color: G.amber,  bg: G.amberLt,  desc: 'Engages when a claim is disputed, denied, or requires additional documentation. Attempts to resolve at the carrier level before flagging for human review.', handles: ['Denial dispute','Documentation requests','Supervisor escalation','Resubmission guidance'] },
  { name: 'Resolution Agent',   role: 'Outcome capture',      color: G.green,  bg: G.greenLt,  desc: 'Takes over once payment is confirmed. Extracts the exact EFT date, amount, and reference number. Closes the claim with complete documentation.', handles: ['Payment confirmation','EFT date extraction','Reference number capture','Claim closure'] },
]

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ProductOnePager() {
  const [activeOutcome, setActiveOutcome] = useState('resolved')
  const [activeCarrier, setActiveCarrier] = useState('sun_life')
  const statsRef = useInView(0.2)

  const outcome = OUTCOMES.find(o => o.id === activeOutcome)!
  const carrier = CARRIERS.find(c => c.id === activeCarrier)!

  return (
    <div style={{ background: G.cream, color: G.text, fontFamily: "'Inter',-apple-system,BlinkMacSystemFont,sans-serif", minHeight: '100vh' }}>

      {/* NAV */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: G.greenDk, padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="white"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd"/></svg>
          </div>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>CollectRx</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {['How it works','Carriers','Outcomes','Pricing'].map(l => (
            <a key={l} href={`#${l.toLowerCase().replace(' ','-')}`} style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, textDecoration: 'none', display: 'none' }} className="nav-link">{l}</a>
          ))}
          <a href="/demo" style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', padding: '7px 18px', borderRadius: 7, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
            Watch demo
          </a>
        </div>
      </nav>

      {/* HERO */}
      <section style={{ background: `linear-gradient(160deg,${G.greenDk} 0%,#1A4A3A 52%,${G.cream} 52%)`, padding: '0 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', paddingTop: 'clamp(48px,7vw,88px)', paddingBottom: 'clamp(48px,7vw,72px)' }}>
          <Card style={{ padding: 'clamp(28px,5vw,52px)', boxShadow: '0 24px 64px rgba(0,0,0,0.16)' }}>
            <div style={{ display: 'inline-flex', background: G.greenLt, borderRadius: 20, padding: '4px 14px', marginBottom: 20 }}>
              <span style={{ color: G.green, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Canadian Dental AR Automation</span>
            </div>
            <h1 style={{ fontSize: 'clamp(24px,4.5vw,46px)', fontWeight: 900, letterSpacing: '-1px', color: G.text, lineHeight: 1.1, marginBottom: 18 }}>
              Stop chasing insurance carriers.<br />
              <span style={{ color: G.green }}>Start collecting what you earned.</span>
            </h1>
            <p style={{ color: G.textMd, fontSize: 15, lineHeight: 1.7, maxWidth: 580, marginBottom: 32 }}>
              CollectRx uses AI voice agents to call Canadian insurance carriers on your behalf, navigate their IVR systems, speak with reps, and resolve outstanding claims. Every business day. While you see patients.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <a href="/demo" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: G.green, color: '#fff', padding: '13px 28px', borderRadius: 10, fontWeight: 700, fontSize: 14, textDecoration: 'none', boxShadow: `0 4px 20px ${G.green}55` }}>
                Watch the demo
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-7-7l7 7-7 7"/></svg>
              </a>
              <a href="/how-it-works" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'none', border: `1px solid ${G.border}`, color: G.textMd, padding: '13px 24px', borderRadius: 10, fontWeight: 600, fontSize: 14, textDecoration: 'none' }}>
                How it works
              </a>
            </div>
          </Card>
        </div>
      </section>

      {/* STATS BAR */}
      <section style={{ background: G.greenDk, padding: 'clamp(32px,5vw,52px) 24px' }}>
        <div ref={statsRef.ref} style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 32 }}>
          {[
            { value: 78,  suffix: '%',    label: 'of Canadian private dental market covered by our 6 carriers' },
            { value: 60,  suffix: '%+',   label: 'target claim resolution rate in the first 30 days' },
            { value: 95,  suffix: '%',    label: 'carrier acceptance rate target (calls not blocked)' },
            { value: 3700,suffix: '',     label: 'Canadian dental practices on Abeldent in our target market' },
          ].map((s, i) => (
            <div key={i} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 'clamp(28px,4vw,44px)', fontWeight: 900, color: '#6EE7B7', fontFamily: G.mono, letterSpacing: '-1px', lineHeight: 1 }}>
                {statsRef.visible ? <AnimatedNum value={s.value} suffix={s.suffix} /> : `0${s.suffix}`}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <Section id="how-it-works" bg={G.cream}>
        <Label text="End-to-end workflow" />
        <H2>Four steps. Zero calls from your staff.</H2>
        <Lead>From your Abeldent database to resolved claims, CollectRx handles the entire AR follow-up cycle automatically.</Lead>

        <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', gap: 0 }}>
          {WORKFLOW.map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 0, position: 'relative' }}>
              {i < WORKFLOW.length - 1 && (
                <div style={{ position: 'absolute', left: 19, top: 44, width: 2, height: 'calc(100% - 10px)', background: `linear-gradient(${G.greenLt},${G.border})` }} />
              )}
              <div style={{ flexShrink: 0, width: 40, height: 40, borderRadius: '50%', background: G.green, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, color: '#fff', marginRight: 20, marginTop: 2, zIndex: 1 }}>
                {step.n}
              </div>
              <Card style={{ flex: 1, padding: '16px 20px', marginBottom: 12 }}>
                <h3 style={{ color: G.text, fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{step.title}</h3>
                <p style={{ color: G.textMd, fontSize: 13, lineHeight: 1.6 }}>{step.detail}</p>
              </Card>
            </div>
          ))}
        </div>
      </Section>

      {/* AGENT SQUAD */}
      <Section bg={G.white}>
        <Label text="The agent squad" />
        <H2>Four specialized agents. One team.</H2>
        <Lead>Each agent has a defined role. They hand off to each other mid-call so the right specialist handles each phase of the conversation.</Lead>

        <div style={{ marginTop: 36, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
          {AGENTS.map((agent, i) => (
            <div key={i} style={{ background: agent.bg, border: `1px solid ${agent.color}30`, borderRadius: 14, padding: '20px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ background: agent.color, borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ color: '#fff', fontWeight: 900, fontSize: 11 }}>{String(i + 1).padStart(2,'0')}</span>
                </div>
                <div>
                  <div style={{ color: G.text, fontWeight: 700, fontSize: 13 }}>{agent.name}</div>
                  <div style={{ color: G.textMuted, fontSize: 11 }}>{agent.role}</div>
                </div>
              </div>
              <p style={{ color: G.textMd, fontSize: 12, lineHeight: 1.55, marginBottom: 14 }}>{agent.desc}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {agent.handles.map((h, hi) => (
                  <div key={hi} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: agent.color, flexShrink: 0 }} />
                    <span style={{ color: G.textMd, fontSize: 11 }}>{h}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* CLAIM OUTCOMES */}
      <Section id="outcomes" bg={G.cream}>
        <Label text="Every possible outcome" />
        <H2>CollectRx handles all of them.</H2>
        <Lead>Every call ends with a structured outcome. Every scenario has a defined next action. Nothing falls through the cracks.</Lead>

        <div style={{ marginTop: 36 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {OUTCOMES.map(o => (
              <button key={o.id} onClick={() => setActiveOutcome(o.id)} style={{
                padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all 0.2s ease',
                background: activeOutcome === o.id ? o.color : G.white,
                color: activeOutcome === o.id ? '#fff' : G.textMd,
                border: `1px solid ${activeOutcome === o.id ? 'transparent' : G.border}`,
                boxShadow: activeOutcome === o.id ? `0 2px 12px ${o.color}44` : 'none',
              }}>
                {o.icon} {o.label}
              </button>
            ))}
          </div>

          <Card style={{ padding: '24px 28px', borderLeft: `4px solid ${outcome.color}` }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 20 }}>
              <div>
                <div style={{ display: 'inline-flex', background: outcome.bg, borderRadius: 8, padding: '4px 12px', marginBottom: 12 }}>
                  <span style={{ color: outcome.color, fontWeight: 700, fontSize: 12 }}>{outcome.icon} {outcome.label}</span>
                </div>
                <h3 style={{ color: G.text, fontWeight: 700, fontSize: 18, marginBottom: 10 }}>{outcome.headline}</h3>
                <p style={{ color: G.textMd, fontSize: 14, lineHeight: 1.65, marginBottom: 16 }}>{outcome.description}</p>
                <div style={{ background: G.cream, borderRadius: 8, padding: '10px 14px' }}>
                  <span style={{ color: G.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>What happens next</span>
                  <p style={{ color: G.textMd, fontSize: 13, marginTop: 4 }}>{outcome.nextStep}</p>
                </div>
              </div>
              <div style={{ background: G.cream, borderRadius: 10, padding: '16px 18px', alignSelf: 'start' }}>
                <p style={{ color: G.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Real example</p>
                <p style={{ color: G.textMd, fontSize: 13, lineHeight: 1.6, fontStyle: 'italic' }}>"{outcome.example}"</p>
              </div>
            </div>
          </Card>
        </div>
      </Section>

      {/* CARRIERS */}
      <Section id="carriers" bg={G.white}>
        <Label text="Carrier coverage" />
        <H2>All 6 major Canadian dental carriers.</H2>
        <Lead>Sun Life, Canada Life, Manulife, Green Shield, RBC Insurance, and TELUS AdjudiCare. Together covering 78% of the Canadian private dental insurance market.</Lead>

        <div style={{ marginTop: 36 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
            {CARRIERS.map(c => (
              <button key={c.id} onClick={() => setActiveCarrier(c.id)} style={{
                padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.2s ease',
                background: activeCarrier === c.id ? c.color : G.white,
                color: activeCarrier === c.id ? '#fff' : G.textMd,
                border: `1px solid ${activeCarrier === c.id ? 'transparent' : G.border}`,
              }}>
                {c.name}
              </button>
            ))}
          </div>

          <Card style={{ padding: '24px 28px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 20 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <div style={{ background: carrier.color, borderRadius: 10, width: 42, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 16, flexShrink: 0 }}>
                    {carrier.name.charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: G.text }}>{carrier.name}</div>
                    <div style={{ color: G.textMuted, fontSize: 12 }}>~{carrier.market} of Canadian dental market</div>
                  </div>
                </div>
                <div style={{ background: G.cream, borderRadius: 8, padding: '12px 14px' }}>
                  <p style={{ color: G.textMd, fontSize: 13, lineHeight: 1.65 }}>{carrier.notes}</p>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignContent: 'start' }}>
                {[
                  { label: 'Preventive', value: `${carrier.prev}%` },
                  { label: 'Basic restorative', value: `${carrier.basic}%` },
                  { label: 'Major restorative', value: `${carrier.major}%` },
                  { label: 'Annual max', value: `$${carrier.max.toLocaleString()}` },
                  { label: 'Min wait (days)', value: String(carrier.wait) },
                  { label: 'Clearinghouse', value: carrier.id === 'telus' ? 'Yes' : 'No' },
                ].map((item, i) => (
                  <div key={i} style={{ background: G.cream, borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ color: G.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{item.label}</div>
                    <div style={{ color: G.text, fontWeight: 700, fontSize: 15, fontFamily: G.mono }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </Section>

      {/* CALL RULES */}
      <Section bg={G.cream}>
        <Label text="Operating guardrails" />
        <H2>Built-in rules. No manual configuration needed.</H2>

        <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
          {[
            { rule: 'Calls Mon-Fri 8am-5pm ET only',     why: 'Carriers are fully staffed. Calls outside this window reach voicemail and waste an attempt.' },
            { rule: 'Max 3 attempts per claim',           why: 'After 3 failed attempts the claim escalates to human review. Prevents flagging your practice.' },
            { rule: 'Claims under 30 days held',          why: 'Carriers have not had time to process new submissions. Calling too early wastes the attempt.' },
            { rule: 'Claims over 90 days escalated',      why: 'Very aged claims require human judgment. They go directly to staff with full call history attached.' },
          ].map((item, i) => (
            <div key={i} style={{ background: G.white, border: `1px solid ${G.border}`, borderLeft: `3px solid ${G.green}`, borderRadius: 10, padding: '16px 18px' }}>
              <p style={{ color: G.text, fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{item.rule}</p>
              <p style={{ color: G.textMuted, fontSize: 12, lineHeight: 1.55 }}>{item.why}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* PRIVACY */}
      <Section bg={G.white}>
        <Label text="Privacy and compliance" />
        <H2>PHIPA and PIPEDA compliant by design.</H2>
        <Lead>Patient identifiers never leave your server. The AI agents operate entirely on anonymous tokens. Real data is re-attached server-side after every call.</Lead>

        <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
          {[
            { color: G.green,  title: 'PHI boundary enforced',      desc: 'Patient names, dates of birth, and health card numbers are replaced with UUID tokens before any data reaches the AI. No identifiable information crosses to Vapi.' },
            { color: G.blue,   title: 'AI disclosure on every call', desc: 'Every call opens with a mandatory disclosure: "This is an automated calling system." Required by Canadian telecommunications law. No exceptions.' },
            { color: G.red,    title: 'Carrier block protocol',      desc: 'If any carrier signals automated detection, all calls to that carrier are suspended immediately practice-wide. You are alerted by SMS within minutes.' },
            { color: G.purple, title: 'Complete audit trail',        desc: 'Every call attempt, outcome, and state transition is logged with timestamps. Full history available for compliance review, appeals, or dispute resolution.' },
          ].map((item, i) => (
            <Card key={i} style={{ padding: '20px 20px' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: `${item.color}18`, border: `1.5px solid ${item.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <Check color={item.color} />
              </div>
              <h3 style={{ color: G.text, fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{item.title}</h3>
              <p style={{ color: G.textMd, fontSize: 13, lineHeight: 1.6 }}>{item.desc}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* PRICING */}
      <Section id="pricing" bg={G.cream}>
        <Label text="Pricing" />
        <H2>Simple, transparent pricing.</H2>
        <Lead>Minutes-based tiers. No setup fees for pilot partners.</Lead>

        <div style={{ marginTop: 36, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 }}>
          {(['core', 'growth', 'scale'] as const).map((id) => {
            const plan = TIERS[id]
            const highlight = id === 'growth'
            return (
            <div key={id} style={{
              background: highlight ? G.green : G.white,
              border: `1px solid ${highlight ? 'transparent' : G.border}`,
              borderRadius: 16, padding: '24px 22px',
              boxShadow: highlight ? `0 8px 32px ${G.green}44` : 'none',
              transform: highlight ? 'scale(1.02)' : 'none',
            }}>
              {highlight && (
                <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.2)', borderRadius: 8, padding: '3px 10px', marginBottom: 14 }}>
                  <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>Most popular</span>
                </div>
              )}
              <div style={{ color: highlight ? 'rgba(255,255,255,0.7)' : G.textMuted, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{plan.name}</div>
              <div style={{ fontSize: 36, fontWeight: 900, color: highlight ? '#fff' : G.text, fontFamily: G.mono, letterSpacing: '-1px', marginBottom: 4 }}>
                ${plan.price}<span style={{ fontSize: 14, fontWeight: 500, color: highlight ? 'rgba(255,255,255,0.6)' : G.textMuted }}>/mo</span>
              </div>
              <p style={{ color: highlight ? 'rgba(255,255,255,0.65)' : G.textMuted, fontSize: 13, marginBottom: 20 }}>{plan.description}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {MARKETING_TIER_FEATURES[id].map((f, fi) => (
                  <div key={fi} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Check color={highlight ? 'rgba(255,255,255,0.8)' : G.green} />
                    <span style={{ color: highlight ? 'rgba(255,255,255,0.85)' : G.textMd, fontSize: 13 }}>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          )})}
        </div>
        <p style={{ color: G.textMuted, fontSize: 13, marginTop: 20, textAlign: 'center' }}>All prices in CAD. HST applied where applicable. Pilot partners start at no cost.</p>
      </Section>

      {/* CTA */}
      <section style={{ background: G.greenDk, padding: 'clamp(48px,6vw,80px) 24px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.1)', borderRadius: 20, padding: '4px 14px', marginBottom: 20 }}>
            <span style={{ color: '#6EE7B7', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Founding practice pilot</span>
          </div>
          <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#fff', letterSpacing: '-0.6px', lineHeight: 1.2, marginBottom: 16 }}>
            Start with one afternoon of setup.<br />Calls begin the next business day.
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, lineHeight: 1.7, marginBottom: 32, maxWidth: 500, margin: '0 auto 32px' }}>
            Connect your PMS via CSV import or the desktop connector. CollectRx starts calling your aged AR the next business morning. Zero cost during the pilot. Results visible within 30 days.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="/demo" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', color: G.greenDk, padding: '13px 28px', borderRadius: 10, fontWeight: 800, fontSize: 14, textDecoration: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
              Watch the demo
            </a>
            <a href="https://calendly.com/collectrx/pilot-setup" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: G.green, color: '#fff', padding: '13px 28px', borderRadius: 10, fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
              Book your setup call
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-7-7l7 7-7 7"/></svg>
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ background: '#060E14', padding: '28px 24px', textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ width: 22, height: 22, borderRadius: 5, background: G.green, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="12" height="12" viewBox="0 0 20 20" fill="white"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5z" clipRule="evenodd"/></svg>
          </div>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>CollectRx</span>
        </div>
        <p style={{ color: '#334155', fontSize: 12 }}>Dental insurance AR automation for Canadian practices. collectrx.ca</p>
      </footer>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @media (min-width: 640px) { .nav-link { display: inline !important; } }
      `}</style>
    </div>
  )
}
