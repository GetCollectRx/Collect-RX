/**
 * CollectRx — Public Marketing Landing Page
 * Route: / (unauthenticated)
 *
 * Aesthetic: warm cream · muted forest green · generous space · clean
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

/* ── Design tokens ─────────────────────────────────────────────────────── */
const C = {
  bg:       '#FAFAF7',
  bgWarm:   '#F5F2EB',
  white:    '#FFFFFF',
  cream:    '#F0EDE5',
  border:   'rgba(0,0,0,0.08)',
  borderMd: 'rgba(0,0,0,0.12)',

  forest:   '#1A5E48',
  forestLt: '#E8F2EE',
  forestMd: '#2D7A60',
  forestDim:'#5C9E88',

  ink:      '#1C1C1A',
  inkMd:    '#4A4A46',
  inkLt:    '#8C8880',

  display:  "'Fraunces', Georgia, serif",
  body:     "'DM Sans', sans-serif",
  mono:     "'DM Mono', monospace",
}

/* ── Intersection-reveal hook ──────────────────────────────────────────── */
function useVisible(threshold = 0.1) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setVisible(true); obs.unobserve(el) }
    }, { threshold })
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return { ref, visible }
}

/* ── Animated counter hook ─────────────────────────────────────────────── */
function useCounter(target: number, decimals = 0, active = false) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!active) return
    const dur = 1600; const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min((now - start) / dur, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setVal(parseFloat((target * eased).toFixed(decimals)))
      if (p < 1) requestAnimationFrame(tick); else setVal(target)
    }
    requestAnimationFrame(tick)
  }, [active, target, decimals])
  return val
}

/* ── Fade-in wrapper ───────────────────────────────────────────────────── */
function Fade({ children, delay = 0, style = {} }: {
  children: React.ReactNode; delay?: number; style?: React.CSSProperties
}) {
  const { ref, visible } = useVisible(0.08)
  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(18px)',
      transition: `opacity 0.7s ease ${delay}ms, transform 0.7s ease ${delay}ms`,
      ...style,
    }}>
      {children}
    </div>
  )
}

/* ── Main component ────────────────────────────────────────────────────── */
export default function LandingPage() {
  const { ref: statsRef, visible: statsOn } = useVisible(0.4)
  const n1 = useCounter(94,  0, statsOn)
  const n2 = useCounter(2.4, 1, statsOn)
  const n3 = useCounter(12,  0, statsOn)

  const carriers = [
    'Sun Life', 'Canada Life', 'Manulife',
    'Green Shield', 'RBC Insurance', 'TELUS AdjudiCare',
  ]

  const steps = [
    { label: '01', title: 'IVR Navigator',       body: 'Dials the carrier and navigates automated phone trees. No hold music for your staff.' },
    { label: '02', title: 'Claims Agent',         body: 'Speaks with a live rep, captures claim status, reason codes, and payment timelines.' },
    { label: '03', title: 'Escalation Closer',    body: 'Disputes denied claims, requests reconsideration, and logs every exchange.' },
    { label: '04', title: 'Resolution Closer',    body: 'Confirms payment, updates the balance, and marks the claim resolved.' },
  ]

  const features = [
    {
      title: 'Eligibility & Estimates',
      body: 'Generate pre-treatment cost estimates with carrier-specific coverage percentages, deductibles, and annual maximums across all 6 supported carriers.',
    },
    {
      title: 'Smart Queue Rules',
      body: 'Claims under 30 days wait. Claims over 90 days escalate to a human. Max 3 attempts per claim, Mon–Fri 8am–5pm Eastern only.',
    },
    {
      title: 'Patient Balance Reminders',
      body: 'After insurance settles, outstanding balances trigger polite email and SMS reminders with a Stripe payment link. Opt-out is always included.',
    },
    {
      title: 'Abeldent Connector',
      body: 'Syncs directly with Abeldent Local Plus. Patients, claims, and insurance data flow in via SQL Server. No CSV exports needed.',
    },
    {
      title: 'Built for Canada',
      body: 'CDCP 2026 ready. Provincial fee guides, TELUS TPA identification by group number prefix, and iTrans 2 protocol support.',
    },
    {
      title: 'Full Audit Trail',
      body: 'Every call outcome, agent action, and claim state change is timestamped and logged, ready for compliance review or dispute resolution.',
    },
  ]

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,300;1,9..144,400&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@400;500&display=swap');

        .crx *, .crx *::before, .crx *::after { box-sizing: border-box; }
        .crx { font-family: 'DM Sans', sans-serif; background: #FAFAF7; color: #1C1C1A; line-height: 1.6; overflow-x: hidden; -webkit-font-smoothing: antialiased; }
        .crx a { text-decoration: none; color: inherit; }

        /* Nav */
        .crx-nav {
          position: fixed; top: 0; left: 0; right: 0; z-index: 100;
          background: rgba(250,250,247,0.92);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-bottom: 1px solid rgba(0,0,0,0.07);
        }
        .crx-nav-inner {
          max-width: 1100px; margin: 0 auto; padding: 0 32px;
          height: 62px; display: flex; align-items: center; justify-content: space-between;
        }
        .crx-logo-text {
          font-family: 'Fraunces', Georgia, serif;
          font-size: 19px; font-weight: 600; color: #1C1C1A; letter-spacing: -0.02em;
        }
        .crx-logo-text em { font-style: normal; color: #1A5E48; }

        .crx-nav-links { display: flex; gap: 2px; list-style: none; margin: 0; padding: 0; }
        .crx-nav-links a {
          font-size: 14px; font-weight: 500; color: #6B6B67;
          padding: 6px 12px; border-radius: 8px; transition: color 0.15s, background 0.15s;
        }
        .crx-nav-links a:hover { color: #1C1C1A; background: rgba(0,0,0,0.04); }

        /* Buttons */
        .crx-btn {
          display: inline-flex; align-items: center; gap: 7px;
          font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600;
          padding: 10px 20px; border-radius: 10px; border: none; cursor: pointer;
          transition: all 0.15s; white-space: nowrap;
        }
        .crx-btn-ghost { color: #6B6B67; background: transparent; }
        .crx-btn-ghost:hover { color: #1C1C1A; background: rgba(0,0,0,0.05); }
        .crx-btn-primary {
          background: #1A5E48; color: #FFFFFF;
          box-shadow: 0 1px 3px rgba(26,94,72,0.25);
        }
        .crx-btn-primary:hover { background: #2D7A60; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(26,94,72,0.2); }
        .crx-btn-outline {
          background: transparent; color: #1A5E48;
          border: 1.5px solid rgba(26,94,72,0.3);
        }
        .crx-btn-outline:hover { background: #E8F2EE; border-color: #1A5E48; }
        .crx-btn-lg { font-size: 15px; padding: 13px 28px; border-radius: 12px; }

        /* Layout */
        .crx-wrap { max-width: 1100px; margin: 0 auto; padding: 0 32px; }

        /* Step cards */
        .crx-step {
          background: #FFFFFF; border: 1px solid rgba(0,0,0,0.08);
          border-radius: 16px; padding: 28px 24px;
          transition: box-shadow 0.2s, transform 0.2s;
        }
        .crx-step:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.07); transform: translateY(-2px); }

        /* Feature cards */
        .crx-feat {
          background: #FFFFFF; border: 1px solid rgba(0,0,0,0.08);
          border-radius: 16px; padding: 28px 24px;
          transition: box-shadow 0.2s, transform 0.2s;
        }
        .crx-feat:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.07); transform: translateY(-2px); }

        /* Carrier pills */
        .crx-pill {
          display: inline-flex; align-items: center;
          background: #FFFFFF; border: 1px solid rgba(0,0,0,0.09);
          border-radius: 100px; padding: 7px 16px;
          font-size: 13px; font-weight: 500; color: #4A4A46;
          transition: border-color 0.15s, background 0.15s;
        }
        .crx-pill:hover { border-color: rgba(26,94,72,0.3); background: #F0EDE5; }

        /* Divider */
        .crx-hr { border: none; border-top: 1px solid rgba(0,0,0,0.07); margin: 0; }

        /* CTA box */
        .crx-cta-inner {
          background: #1A5E48; border-radius: 24px; padding: 72px 48px; text-align: center;
          position: relative; overflow: hidden;
        }
        .crx-cta-inner::before {
          content: ''; position: absolute; top: -80px; right: -80px;
          width: 300px; height: 300px; border-radius: 50%;
          background: rgba(255,255,255,0.04); pointer-events: none;
        }
        .crx-cta-inner::after {
          content: ''; position: absolute; bottom: -60px; left: -60px;
          width: 240px; height: 240px; border-radius: 50%;
          background: rgba(255,255,255,0.03); pointer-events: none;
        }

        @media (max-width: 860px) {
          .crx-nav-links { display: none; }
          .crx-hero-grid { grid-template-columns: 1fr !important; }
          .crx-steps-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .crx-feat-grid  { grid-template-columns: repeat(2, 1fr) !important; }
          .crx-stats-row  { grid-template-columns: 1fr !important; gap: 1px !important; }
          .crx-wrap { padding: 0 20px; }
          .crx-cta-inner { padding: 48px 24px; }
          .crx-cta-btns { flex-direction: column; align-items: center !important; }
        }
        @media (max-width: 580px) {
          .crx-steps-grid { grid-template-columns: 1fr !important; }
          .crx-feat-grid  { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div className="crx" style={{ minHeight: '100vh', background: C.bg }}>

        {/* ── NAV ── */}
        <nav className="crx-nav">
          <div className="crx-nav-inner">
            <a href="/" className="crx-logo-text">Collect<em>Rx</em></a>

            <ul className="crx-nav-links">
              <li><a href="#how-it-works">How it works</a></li>
              <li><a href="#features">Features</a></li>
              <li><a href="#carriers">Carriers</a></li>
            </ul>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Link to="/login" className="crx-btn crx-btn-ghost">Sign in</Link>
              <a href="#cta" className="crx-btn crx-btn-primary">Book a demo</a>
            </div>
          </div>
        </nav>

        {/* ── HERO ── */}
        <section style={{ paddingTop: 128, paddingBottom: 100 }}>
          <div className="crx-wrap">

            <Fade>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.forestLt, borderRadius: 100, padding: '5px 14px', marginBottom: 32 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.forest, display: 'block' }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: C.forest, fontFamily: C.mono }}>
                  Live with 6 Canadian carriers · 78% market coverage
                </span>
              </div>
            </Fade>

            <Fade delay={80}>
              <h1 style={{
                fontFamily: C.display,
                fontSize: 'clamp(42px, 5.5vw, 72px)',
                fontWeight: 600,
                letterSpacing: '-0.025em',
                lineHeight: 1.1,
                color: C.ink,
                maxWidth: 780,
                marginBottom: 28,
              }}>
                Your front desk shouldn't<br />
                spend the day on hold<span style={{ color: C.forest }}>.</span>
              </h1>
            </Fade>

            <Fade delay={160}>
              <p style={{ fontSize: 18, color: C.inkMd, maxWidth: 520, lineHeight: 1.75, marginBottom: 40, fontWeight: 400 }}>
                CollectRx sends AI voice agents to chase your dental insurance claims: checking status, resolving denials, and closing balances. Automatically.
              </p>
            </Fade>

            <Fade delay={240}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 72 }}>
                <a href="#cta" className="crx-btn crx-btn-primary crx-btn-lg">Book a demo</a>
                <a href="#how-it-works" className="crx-btn crx-btn-outline crx-btn-lg">See how it works</a>
              </div>
            </Fade>

            {/* Stats */}
            <Fade delay={80}>
              <div
                ref={statsRef}
                className="crx-stats-row"
                style={{
                  display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                  border: `1px solid ${C.border}`, borderRadius: 20,
                  overflow: 'hidden', background: C.white,
                  boxShadow: '0 2px 16px rgba(0,0,0,0.05)',
                }}
              >
                {[
                  { val: `${n1}%`,    label: 'Claims resolved without human follow-up' },
                  { val: `$${n2}M+`,  label: 'Insurance A/R recovered per practice / year' },
                  { val: `${n3}h`,    label: 'Front desk hours saved each week' },
                ].map((s, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '28px 32px',
                      borderRight: i < 2 ? `1px solid ${C.border}` : 'none',
                    }}
                  >
                    <div style={{
                      fontFamily: C.display,
                      fontSize: 44,
                      fontWeight: 600,
                      letterSpacing: '-0.03em',
                      color: C.forest,
                      lineHeight: 1,
                      marginBottom: 8,
                    }}>
                      {s.val}
                    </div>
                    <div style={{ fontSize: 13, color: C.inkLt, lineHeight: 1.5, fontWeight: 400 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </Fade>
          </div>
        </section>

        <hr className="crx-hr" />

        {/* ── HOW IT WORKS ── */}
        <section id="how-it-works" style={{ padding: '88px 0' }}>
          <div className="crx-wrap">

            <Fade style={{ marginBottom: 52 }}>
              <p style={{ fontFamily: C.mono, fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.forestDim, marginBottom: 14 }}>
                How it works
              </p>
              <h2 style={{ fontFamily: C.display, fontSize: 'clamp(28px, 3.5vw, 46px)', fontWeight: 600, letterSpacing: '-0.025em', color: C.ink, maxWidth: 560, lineHeight: 1.15 }}>
                Four agents. One call.<br />No hold music.
              </h2>
              <p style={{ fontSize: 16, color: C.inkMd, marginTop: 16, maxWidth: 460, lineHeight: 1.75 }}>
                A coordinated AI squad handles the entire insurance follow-up call, from IVR navigation to payment confirmation.
              </p>
            </Fade>

            <div className="crx-steps-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
              {steps.map((s, i) => (
                <Fade key={s.label} delay={i * 70}>
                  <div className="crx-step" style={{ height: '100%' }}>
                    <div style={{
                      fontFamily: C.mono, fontSize: 11, fontWeight: 500,
                      color: C.forestDim, marginBottom: 18, letterSpacing: '0.05em',
                    }}>
                      {s.label}
                    </div>
                    <h3 style={{ fontFamily: C.display, fontSize: 17, fontWeight: 600, color: C.ink, marginBottom: 10, letterSpacing: '-0.01em' }}>
                      {s.title}
                    </h3>
                    <p style={{ fontSize: 14, color: C.inkMd, lineHeight: 1.7 }}>{s.body}</p>
                  </div>
                </Fade>
              ))}
            </div>

            {/* PHI note */}
            <Fade delay={120} style={{ marginTop: 20 }}>
              <div style={{
                display: 'flex', gap: 14, alignItems: 'flex-start',
                background: C.forestLt, borderRadius: 12, padding: '18px 22px',
                border: `1px solid rgba(26,94,72,0.12)`,
              }}>
                <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>🔒</span>
                <p style={{ fontSize: 13, color: C.inkMd, lineHeight: 1.6 }}>
                  <strong style={{ color: C.ink, fontWeight: 600 }}>Patient data never reaches the AI.</strong>{' '}
                  All identifiers are tokenized before any call. The agents operate on UUID tokens only. PHIPA &amp; PIPEDA compliant.
                </p>
              </div>
            </Fade>
          </div>
        </section>

        {/* ── CARRIERS ── */}
        <section id="carriers" style={{ background: C.bgWarm, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, padding: '72px 0' }}>
          <div className="crx-wrap">
            <Fade>
              <p style={{ textAlign: 'center', fontFamily: C.mono, fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.inkLt, marginBottom: 28 }}>
                Supported carriers
              </p>
            </Fade>
            <Fade delay={80}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginBottom: 36 }}>
                {carriers.map(name => (
                  <span key={name} className="crx-pill">{name}</span>
                ))}
              </div>
            </Fade>
            <Fade delay={160}>
              <p style={{ textAlign: 'center', fontSize: 15, color: C.inkMd }}>
                Together covering{' '}
                <strong style={{ fontFamily: C.display, fontSize: 22, fontWeight: 600, color: C.forest }}>78%</strong>
                {' '}of the Canadian private dental insurance market.
              </p>
            </Fade>
          </div>
        </section>

        {/* ── FEATURES ── */}
        <section id="features" style={{ padding: '88px 0' }}>
          <div className="crx-wrap">
            <Fade style={{ marginBottom: 52 }}>
              <p style={{ fontFamily: C.mono, fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.forestDim, marginBottom: 14 }}>
                Features
              </p>
              <h2 style={{ fontFamily: C.display, fontSize: 'clamp(28px, 3.5vw, 46px)', fontWeight: 600, letterSpacing: '-0.025em', color: C.ink, lineHeight: 1.15 }}>
                Everything your A/R<br />process actually needs.
              </h2>
            </Fade>

            <div className="crx-feat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              {features.map((f, i) => (
                <Fade key={f.title} delay={i * 60}>
                  <div className="crx-feat" style={{ height: '100%' }}>
                    <h3 style={{ fontFamily: C.display, fontSize: 17, fontWeight: 600, color: C.ink, marginBottom: 10, letterSpacing: '-0.01em' }}>
                      {f.title}
                    </h3>
                    <p style={{ fontSize: 14, color: C.inkMd, lineHeight: 1.7 }}>{f.body}</p>
                  </div>
                </Fade>
              ))}
            </div>
          </div>
        </section>

        <hr className="crx-hr" />

        {/* ── COMPLIANCE ── */}
        <section style={{ padding: '56px 0', background: C.bgWarm, borderBottom: `1px solid ${C.border}` }}>
          <div className="crx-wrap">
            <Fade>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 40, justifyContent: 'center', alignItems: 'center' }}>
                {[
                  { icon: '🔐', label: 'PHIPA Compliant' },
                  { icon: '🍁', label: 'PIPEDA Compliant' },
                  { icon: '💳', label: 'Stripe Payments' },
                  { icon: '🛡️', label: 'PHI Tokenized' },
                  { icon: '🚫', label: 'Auto Carrier Block' },
                ].map(c => (
                  <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ fontSize: 17 }}>{c.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.inkMd }}>{c.label}</span>
                  </div>
                ))}
              </div>
            </Fade>
          </div>
        </section>

        {/* ── CTA ── */}
        <section id="cta" style={{ padding: '88px 0' }}>
          <div className="crx-wrap">
            <Fade>
              <div className="crx-cta-inner">
                <p style={{ fontFamily: C.mono, fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: 20 }}>
                  Get started
                </p>
                <h2 style={{ fontFamily: C.display, fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 600, letterSpacing: '-0.025em', color: '#FFFFFF', marginBottom: 18, lineHeight: 1.15, position: 'relative', zIndex: 1 }}>
                  Ready to stop chasing<br />insurance claims?
                </h2>
                <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.7)', maxWidth: 400, margin: '0 auto 36px', lineHeight: 1.75, position: 'relative', zIndex: 1 }}>
                  We're onboarding Canadian dental practices in a pilot program. Book a 20-minute call to see a live demo.
                </p>
                <div className="crx-cta-btns" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', position: 'relative', zIndex: 1 }}>
                  <a
                    href="mailto:hello@collectrx.ca?subject=Demo Request"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      background: '#FFFFFF', color: C.forest,
                      fontFamily: C.body, fontSize: 15, fontWeight: 600,
                      padding: '13px 28px', borderRadius: 12, border: 'none', cursor: 'pointer',
                      transition: 'all 0.15s', boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)' }}
                  >
                    Book a demo
                  </a>
                  <Link
                    to="/login"
                    style={{
                      display: 'inline-flex', alignItems: 'center',
                      background: 'transparent', color: 'rgba(255,255,255,0.85)',
                      fontFamily: C.body, fontSize: 15, fontWeight: 500,
                      padding: '13px 28px', borderRadius: 12,
                      border: '1.5px solid rgba(255,255,255,0.25)', cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.6)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.25)' }}
                  >
                    Sign in to your practice
                  </Link>
                </div>
                <p style={{ marginTop: 20, fontSize: 12, color: 'rgba(255,255,255,0.4)', position: 'relative', zIndex: 1 }}>
                  No commitment required · Canadian practices only
                </p>
              </div>
            </Fade>
          </div>
        </section>

        {/* ── FOOTER ── */}
        <footer style={{ borderTop: `1px solid ${C.border}`, padding: '48px 0 40px', background: C.white }}>
          <div className="crx-wrap">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 40 }}>
              <div>
                <a href="/" className="crx-logo-text" style={{ display: 'block', marginBottom: 10 }}>Collect<em style={{ fontStyle: 'normal', color: C.forest }}>Rx</em></a>
                <p style={{ fontSize: 13, color: C.inkLt, maxWidth: 220, lineHeight: 1.65 }}>
                  AI-powered dental insurance A/R for Canadian practices.
                </p>
              </div>

              <div style={{ display: 'flex', gap: 56, flexWrap: 'wrap' }}>
                {[
                  { title: 'Product',  links: [['#how-it-works','How it works'],['#features','Features'],['#carriers','Carriers'],['/changelog','Changelog']] },
                  { title: 'Company',  links: [['#cta','Book a demo'],['mailto:hello@collectrx.ca','Contact'],['/legal/privacy','Privacy'],['/legal/terms','Terms']] },
                  { title: 'Platform', links: [['/login','Sign in'],['/product','Product overview'],['/guide','Office guide']] },
                ].map(col => (
                  <div key={col.title}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: C.ink, marginBottom: 14, letterSpacing: '0.01em', textTransform: 'uppercase', fontFamily: C.mono }}>{col.title}</p>
                    <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
                      {col.links.map(([href, label]) => (
                        <li key={label}>
                          <a href={href} style={{ fontSize: 13, color: C.inkLt, transition: 'color 0.15s' }}
                            onMouseEnter={e => (e.currentTarget.style.color = C.ink)}
                            onMouseLeave={e => (e.currentTarget.style.color = C.inkLt)}>
                            {label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 48, paddingTop: 24, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <p style={{ fontSize: 12, color: C.inkLt }}>© 2026 CollectRx Inc. All rights reserved.</p>
              <p style={{ fontSize: 12, color: C.inkLt }}>Built for Canadian dental practices</p>
            </div>
          </div>
        </footer>

      </div>
    </>
  )
}
