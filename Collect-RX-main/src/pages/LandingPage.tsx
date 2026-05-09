import React, { useState, useEffect, useRef, useCallback } from 'react'

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;1,9..144,300;1,9..144,400&family=DM+Sans:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #FAFAF7;
    --bg2:      #F3F0E8;
    --bg3:      #EDE9DF;
    --border:   #E0DDD4;
    --ink:      #1C1C1A;
    --ink2:     #6B6760;
    --forest:   #1A5E48;
    --forest2:  #2D8F6A;
    --sage:     #E8F2ED;
    --amber:    #C4885A;
    --font-serif: 'Fraunces', Georgia, serif;
    --font-sans:  'DM Sans', sans-serif;
    --font-mono:  'JetBrains Mono', monospace;
  }

  .crx-root {
    background: var(--bg);
    color: var(--ink);
    font-family: var(--font-sans);
    font-weight: 300;
    line-height: 1.6;
    overflow-x: hidden;
    min-height: 100vh;
  }

  /* Nav */
  .crx-nav {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 48px;
    transition: background 0.3s, box-shadow 0.3s;
  }
  .crx-nav.scrolled {
    background: rgba(250,250,247,0.94);
    box-shadow: 0 1px 0 var(--border);
    backdrop-filter: blur(12px);
  }
  .crx-logo {
    font-family: var(--font-serif);
    font-size: 20px;
    color: var(--ink);
    letter-spacing: -0.02em;
    font-weight: 400;
  }
  .crx-logo span { color: var(--forest); }
  .crx-nav-cta {
    background: var(--forest);
    color: #fff;
    border: none;
    padding: 10px 22px;
    border-radius: 100px;
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s, transform 0.15s;
  }
  .crx-nav-cta:hover { background: var(--forest2); transform: translateY(-1px); }

  /* Hero */
  .crx-hero {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: center;
    gap: 64px;
    padding: 120px 48px 80px;
    max-width: 1280px;
    margin: 0 auto;
  }
  .crx-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--forest);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    background: var(--sage);
    border: 1px solid rgba(45,143,106,0.2);
    padding: 6px 14px;
    border-radius: 100px;
    margin-bottom: 28px;
  }
  .crx-eyebrow-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--forest2);
    animation: crx-pulse 2s ease-in-out infinite;
  }
  @keyframes crx-pulse {
    0%,100% { opacity:1; transform:scale(1); }
    50%      { opacity:0.5; transform:scale(0.7); }
  }
  .crx-headline {
    font-family: var(--font-serif);
    font-size: clamp(40px, 4.5vw, 64px);
    line-height: 1.08;
    letter-spacing: -0.02em;
    color: var(--ink);
    margin-bottom: 24px;
    font-weight: 300;
  }
  .crx-headline em { font-style: italic; color: var(--forest); }
  .crx-subhead {
    font-size: 16px;
    color: var(--ink2);
    max-width: 420px;
    margin-bottom: 44px;
    line-height: 1.75;
    font-weight: 300;
  }
  .crx-actions { display: flex; gap: 12px; flex-wrap: wrap; }
  .crx-btn-primary {
    background: var(--forest);
    color: #fff; border: none;
    padding: 14px 28px; border-radius: 100px;
    font-family: var(--font-sans); font-size: 14px; font-weight: 500;
    cursor: pointer; transition: background 0.2s, transform 0.15s;
  }
  .crx-btn-primary:hover { background: var(--forest2); transform: translateY(-1px); }
  .crx-btn-ghost {
    background: transparent; color: var(--ink2);
    border: 1px solid var(--border);
    padding: 14px 28px; border-radius: 100px;
    font-family: var(--font-sans); font-size: 14px; font-weight: 300;
    cursor: pointer; transition: border-color 0.2s, color 0.2s;
  }
  .crx-btn-ghost:hover { border-color: var(--ink2); color: var(--ink); }

  /* Terminal */
  .crx-terminal {
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 16px;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 12.5px;
    box-shadow: 0 4px 6px rgba(0,0,0,0.04), 0 20px 60px rgba(26,94,72,0.08);
  }
  .crx-terminal-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    background: var(--bg2);
  }
  .crx-terminal-dots { display: flex; gap: 6px; }
  .crx-terminal-dots span { width: 10px; height: 10px; border-radius: 50%; }
  .crx-terminal-dots span:nth-child(1) { background: #FF5F57; }
  .crx-terminal-dots span:nth-child(2) { background: #FFBD2E; }
  .crx-terminal-dots span:nth-child(3) { background: #28CA41; }
  .crx-terminal-title { font-size: 11px; color: var(--ink2); letter-spacing: 0.04em; }
  .crx-terminal-live {
    display: flex; align-items: center; gap: 6px;
    font-size: 11px; color: var(--forest);
    background: var(--sage); border: 1px solid rgba(45,143,106,0.2);
    padding: 4px 10px; border-radius: 100px;
  }
  .crx-live-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--forest2);
    animation: crx-pulse 1.5s ease-in-out infinite;
  }
  .crx-tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
    overflow-x: auto; scrollbar-width: none;
    background: var(--bg2);
  }
  .crx-tabs::-webkit-scrollbar { display: none; }
  .crx-tab {
    flex-shrink: 0; padding: 10px 16px;
    font-size: 11px; color: var(--ink2);
    cursor: pointer; border-bottom: 2px solid transparent;
    transition: color 0.2s, border-color 0.2s;
    white-space: nowrap; background: none;
    border-top: none; border-left: none; border-right: none;
    font-family: var(--font-mono);
  }
  .crx-tab:hover { color: var(--ink); }
  .crx-tab.active { color: var(--forest); border-bottom-color: var(--forest); }
  .crx-terminal-body {
    padding: 20px 20px 12px;
    min-height: 240px; max-height: 300px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
    background: #fff;
  }
  .crx-line {
    display: flex; align-items: flex-start; gap: 10px;
    margin-bottom: 9px;
    animation: crx-fadein 0.3s ease;
  }
  @keyframes crx-fadein {
    from { opacity:0; transform:translateY(3px); }
    to   { opacity:1; transform:none; }
  }
  .crx-prefix   { color: var(--border); user-select: none; flex-shrink: 0; }
  .crx-t-sys    { color: var(--ink2); }
  .crx-t-ivr    { color: #2563EB; }
  .crx-t-action { color: var(--ink); }
  .crx-t-ok     { color: var(--forest); font-weight: 500; }
  .crx-t-done   { color: var(--amber); font-weight: 500; }
  .crx-cursor {
    display: inline-block; width: 7px; height: 13px;
    background: var(--forest); vertical-align: middle; margin-left: 3px;
    animation: crx-blink 1s step-end infinite;
  }
  @keyframes crx-blink { 0%,100%{opacity:1;} 50%{opacity:0;} }
  .crx-terminal-footer {
    display: flex; justify-content: space-between; align-items: center;
    padding: 11px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg2);
    font-size: 11px; color: var(--ink2);
  }
  .crx-terminal-footer .saved { color: var(--forest); font-weight: 500; }

  /* Stats */
  .crx-stats {
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    display: grid; grid-template-columns: repeat(4,1fr);
  }
  .crx-stat {
    padding: 40px 48px;
    border-right: 1px solid var(--border);
  }
  .crx-stat:last-child { border-right: none; }
  .crx-stat-num {
    font-family: var(--font-serif);
    font-size: 48px; color: var(--ink);
    line-height: 1; letter-spacing: -0.03em; margin-bottom: 6px;
    font-weight: 300;
  }
  .crx-stat-num span { color: var(--forest); }
  .crx-stat-label { font-size: 13px; color: var(--ink2); }

  /* Sections */
  .crx-section { max-width: 1280px; margin: 0 auto; padding: 100px 48px; }
  .crx-section-tag {
    font-family: var(--font-mono); font-size: 11px; color: var(--forest);
    letter-spacing: 0.1em; text-transform: uppercase;
    display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
  }
  .crx-section-tag::before { content:''; display:block; width:20px; height:1px; background:var(--forest2); }
  .crx-section-title {
    font-family: var(--font-serif);
    font-size: clamp(30px,3.5vw,48px);
    line-height: 1.1; letter-spacing: -0.02em;
    color: var(--ink); margin-bottom: 60px; max-width: 540px; font-weight: 300;
  }
  .crx-section-title em { font-style: italic; color: var(--forest); }

  /* Steps */
  .crx-steps { display: grid; grid-template-columns: repeat(4,1fr); gap: 16px; }
  .crx-step {
    background: #fff; border: 1px solid var(--border);
    border-radius: 12px; padding: 32px 28px;
    transition: box-shadow 0.25s, transform 0.25s;
    position: relative; overflow: hidden;
  }
  .crx-step::after {
    content: ''; position: absolute; bottom: 0; left: 0; right: 0;
    height: 3px; background: linear-gradient(90deg, var(--forest), var(--forest2));
    transform: scaleX(0); transform-origin: left;
    transition: transform 0.35s ease;
  }
  .crx-step:hover { box-shadow: 0 8px 32px rgba(26,94,72,0.1); transform: translateY(-2px); }
  .crx-step:hover::after { transform: scaleX(1); }
  .crx-step-num { font-family: var(--font-mono); font-size: 11px; color: var(--forest2); margin-bottom: 20px; }
  .crx-step-icon { font-size: 28px; margin-bottom: 16px; display: block; }
  .crx-step-title { font-family: var(--font-serif); font-size: 19px; color: var(--ink); margin-bottom: 10px; font-weight: 400; }
  .crx-step-desc { font-size: 13.5px; color: var(--ink2); line-height: 1.65; }

  /* Carriers */
  .crx-carriers-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; margin-top: 16px; }
  .crx-carrier-card {
    background: #fff; border: 1px solid var(--border); border-radius: 10px;
    padding: 22px 24px;
    display: flex; align-items: center; justify-content: space-between;
    cursor: pointer; transition: box-shadow 0.2s, border-color 0.2s, transform 0.2s;
  }
  .crx-carrier-card:hover { box-shadow: 0 4px 16px rgba(26,94,72,0.08); transform: translateY(-1px); }
  .crx-carrier-card.active { border-color: var(--forest2); background: var(--sage); box-shadow: 0 0 0 3px rgba(45,143,106,0.12); }
  .crx-carrier-name { font-size: 14px; color: var(--ink); }
  .crx-carrier-pct {
    font-family: var(--font-mono); font-size: 11px;
    padding: 4px 10px; border-radius: 100px;
    background: var(--sage); color: var(--forest);
    border: 1px solid rgba(45,143,106,0.2);
  }
  .crx-market-note { margin-top: 20px; font-size: 13px; color: var(--ink2); text-align: center; }

  /* Compliance */
  .crx-compliance {
    background: var(--sage);
    border-top: 1px solid rgba(45,143,106,0.15);
    border-bottom: 1px solid rgba(45,143,106,0.15);
    padding: 40px 48px;
    display: flex; align-items: center; justify-content: center;
    gap: 48px; flex-wrap: wrap;
  }
  .crx-badge { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--forest); }
  .crx-badge-icon {
    width: 32px; height: 32px;
    background: #fff; border: 1px solid rgba(45,143,106,0.2);
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 16px;
    box-shadow: 0 1px 4px rgba(26,94,72,0.08);
  }

  /* CTA */
  .crx-cta { max-width: 1280px; margin: 0 auto; padding: 100px 48px; text-align: center; }
  .crx-cta-inner {
    background: var(--forest);
    border-radius: 20px; padding: 80px 64px;
    position: relative; overflow: hidden;
  }
  .crx-cta-inner::before {
    content: ''; position: absolute;
    top: -80px; right: -80px;
    width: 320px; height: 320px; border-radius: 50%;
    background: rgba(255,255,255,0.04); pointer-events: none;
  }
  .crx-cta-inner::after {
    content: ''; position: absolute;
    bottom: -60px; left: -60px;
    width: 240px; height: 240px; border-radius: 50%;
    background: rgba(255,255,255,0.03); pointer-events: none;
  }
  .crx-cta-title {
    font-family: var(--font-serif); font-weight: 300;
    font-size: clamp(30px,3.5vw,50px);
    letter-spacing: -0.02em; color: #fff; margin-bottom: 16px;
  }
  .crx-cta-title em { font-style: italic; color: rgba(255,255,255,0.75); }
  .crx-cta-sub { font-size: 15px; color: rgba(255,255,255,0.7); margin-bottom: 40px; }
  .crx-btn-white {
    background: #fff; color: var(--forest); border: none;
    padding: 15px 32px; border-radius: 100px;
    font-family: var(--font-sans); font-size: 14px; font-weight: 500;
    cursor: pointer; transition: opacity 0.2s, transform 0.15s;
  }
  .crx-btn-white:hover { opacity: 0.92; transform: translateY(-1px); }
  .crx-btn-outline-white {
    background: transparent; color: rgba(255,255,255,0.85);
    border: 1px solid rgba(255,255,255,0.3);
    padding: 15px 32px; border-radius: 100px;
    font-family: var(--font-sans); font-size: 14px; font-weight: 300;
    cursor: pointer; transition: border-color 0.2s, color 0.2s;
  }
  .crx-btn-outline-white:hover { border-color: rgba(255,255,255,0.6); color: #fff; }

  /* Footer */
  .crx-footer {
    border-top: 1px solid var(--border);
    padding: 32px 48px;
    display: flex; align-items: center; justify-content: space-between;
    font-size: 13px; color: var(--ink2);
  }

  /* Reveal */
  .crx-reveal {
    opacity: 0; transform: translateY(20px);
    transition: opacity 0.55s ease, transform 0.55s ease;
  }
  .crx-reveal.visible { opacity: 1; transform: none; }

  @media (max-width: 960px) {
    .crx-hero { grid-template-columns: 1fr; padding: 100px 24px 60px; gap: 48px; }
    .crx-stats { grid-template-columns: repeat(2,1fr); }
    .crx-stat { padding: 28px 24px; }
    .crx-steps { grid-template-columns: 1fr 1fr; }
    .crx-carriers-grid { grid-template-columns: 1fr 1fr; }
    .crx-section { padding: 64px 24px; }
    .crx-nav { padding: 16px 24px; }
    .crx-compliance { gap: 24px; padding: 32px 24px; }
    .crx-footer { flex-direction: column; gap: 12px; text-align: center; padding: 28px 24px; }
    .crx-cta { padding: 64px 24px; }
    .crx-cta-inner { padding: 56px 32px; }
  }
  @media (max-width: 600px) {
    .crx-steps { grid-template-columns: 1fr; }
    .crx-carriers-grid { grid-template-columns: 1fr; }
    .crx-stat-num { font-size: 38px; }
  }
`

const CARRIERS = [
  { name: 'Sun Life',         pct: '31%', lines: [
    { text: 'Dialing Sun Life Financial...', kind: 'sys' },
    { text: 'IVR connected — navigating menus', kind: 'sys' },
    { text: '"For claim status, press 2"', kind: 'ivr' },
    { text: 'Entering group #28941 + member ID', kind: 'action' },
    { text: '"Please wait while I retrieve..."', kind: 'ivr' },
    { text: 'Claim #SL-847291: APPROVED', kind: 'ok' },
    { text: 'Insurer pays: $1,240.00', kind: 'ok' },
    { text: 'EFT deposit in 3 business days', kind: 'ok' },
    { text: 'Complete. 4m 12s saved.', kind: 'done' },
  ]},
  { name: 'Canada Life',      pct: '22%', lines: [
    { text: 'Dialing Canada Life...', kind: 'sys' },
    { text: 'IVR connected — navigating menus', kind: 'sys' },
    { text: '"Enter plan number followed by #"', kind: 'ivr' },
    { text: 'Entering plan #GFL-4920', kind: 'action' },
    { text: '"One moment while I check..."', kind: 'ivr' },
    { text: 'Claim #CL-1048231: APPROVED', kind: 'ok' },
    { text: 'Insurer pays: $890.00', kind: 'ok' },
    { text: 'Cheque mailed in 5 business days', kind: 'ok' },
    { text: 'Complete. 6m 44s saved.', kind: 'done' },
  ]},
  { name: 'Manulife',         pct: '12%', lines: [
    { text: 'Dialing Manulife Financial...', kind: 'sys' },
    { text: 'IVR connected — holding for agent', kind: 'sys' },
    { text: '"All agents are currently busy"', kind: 'ivr' },
    { text: 'Holding — 9m 30s elapsed', kind: 'action' },
    { text: 'Agent connected', kind: 'action' },
    { text: 'Claim #MFC-39821: PROCESSING', kind: 'ok' },
    { text: 'Adjudication in progress', kind: 'ok' },
    { text: 'EFT expected in 7 business days', kind: 'ok' },
    { text: 'Complete. 14m 03s saved.', kind: 'done' },
  ]},
  { name: 'Green Shield',     pct: '7%', lines: [
    { text: 'Dialing Green Shield Canada...', kind: 'sys' },
    { text: 'IVR connected — navigating menus', kind: 'sys' },
    { text: '"Enter group certificate number"', kind: 'ivr' },
    { text: 'Entering cert #GSC-77110', kind: 'action' },
    { text: 'Claim #GS-20847: APPROVED', kind: 'ok' },
    { text: 'Insurer pays: $540.00', kind: 'ok' },
    { text: 'Direct deposit in 2 business days', kind: 'ok' },
    { text: 'Complete. 3m 51s saved.', kind: 'done' },
  ]},
  { name: 'RBC Insurance',    pct: '4%', lines: [
    { text: 'Dialing RBC Insurance...', kind: 'sys' },
    { text: 'IVR connected — navigating menus', kind: 'sys' },
    { text: '"For claims, say or press 3"', kind: 'ivr' },
    { text: 'Entering plan ID #RBC-20210', kind: 'action' },
    { text: 'Claim #RBC-58320: APPROVED', kind: 'ok' },
    { text: 'Insurer pays: $720.00', kind: 'ok' },
    { text: 'EFT deposit in 4 business days', kind: 'ok' },
    { text: 'Complete. 5m 20s saved.', kind: 'done' },
  ]},
  { name: 'TELUS AdjudiCare', pct: '2%', lines: [
    { text: 'Dialing TELUS AdjudiCare...', kind: 'sys' },
    { text: 'IVR connected — identifying TPA', kind: 'sys' },
    { text: 'Group prefix: Johnston Group plan', kind: 'action' },
    { text: '"Enter member ID + date of birth"', kind: 'ivr' },
    { text: 'Claim #TA-67021: APPROVED', kind: 'ok' },
    { text: 'Insurer pays: $310.00', kind: 'ok' },
    { text: 'Direct deposit in 2 business days', kind: 'ok' },
    { text: 'Complete. 2m 58s saved.', kind: 'done' },
  ]},
]

const STEPS = [
  { icon: '🔗', num: '01', title: 'Sync',    desc: 'Connect your practice management software. CollectRx reads outstanding claims automatically.' },
  { icon: '📞', num: '02', title: 'Call',    desc: 'AI voice agents dial carriers, navigate IVRs, hold on queue, and speak with reps — hands free.' },
  { icon: '🔒', num: '03', title: 'Protect', desc: 'Patient data never leaves your server. Agents work on anonymous tokens only.' },
  { icon: '✓',  num: '04', title: 'Resolve', desc: 'Approvals, denials, and status updates land in a clean report. Nothing falls through the cracks.' },
]

function useScrolled() {
  const [s, setS] = useState(false)
  useEffect(() => {
    const fn = () => setS(window.scrollY > 40)
    window.addEventListener('scroll', fn, { passive: true })
    return () => window.removeEventListener('scroll', fn)
  }, [])
  return s
}

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.crx-reveal')
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible') })
    }, { threshold: 0.1 })
    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [])
}

function useCounter(target: number) {
  const [val, setVal] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      obs.disconnect()
      const start = performance.now()
      const dur = 1500
      const tick = (now: number) => {
        const p = Math.min((now - start) / dur, 1)
        setVal(Math.round(p * p * target))
        if (p < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, { threshold: 0.5 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [target])
  return { val, ref }
}

function Terminal({ activeIdx, onSelect }: { activeIdx: number; onSelect: (i: number) => void }) {
  const [lines, setLines] = useState<typeof CARRIERS[0]['lines']>([])
  const [done, setDone] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const run = useCallback((idx: number) => {
    timers.current.forEach(clearTimeout); timers.current = []
    setLines([]); setDone(false)
    CARRIERS[idx].lines.forEach((line, i) => {
      const t = setTimeout(() => {
        setLines(prev => [...prev, line])
        if (i === CARRIERS[idx].lines.length - 1) setDone(true)
        if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
      }, i * 680)
      timers.current.push(t)
    })
  }, [])

  useEffect(() => { run(activeIdx); return () => timers.current.forEach(clearTimeout) }, [activeIdx, run])

  const saved = done ? CARRIERS[activeIdx].lines.find(l => l.kind === 'done')?.text.match(/\d+m \d+s/)?.[0] : null

  return (
    <div className="crx-terminal">
      <div className="crx-terminal-bar">
        <div className="crx-terminal-dots"><span /><span /><span /></div>
        <span className="crx-terminal-title">collectrx — agent-call</span>
        <div className="crx-terminal-live"><div className="crx-live-dot" />LIVE</div>
      </div>
      <div className="crx-tabs">
        {CARRIERS.map((c, i) => (
          <button key={c.name} className={`crx-tab${i === activeIdx ? ' active' : ''}`} onClick={() => onSelect(i)}>
            {c.name}
          </button>
        ))}
      </div>
      <div className="crx-terminal-body" ref={bodyRef}>
        {lines.map((l, i) => (
          <div className="crx-line" key={i}>
            <span className="crx-prefix">›</span>
            <span className={`crx-t-${l.kind}`}>{l.text}</span>
          </div>
        ))}
        {!done && <span className="crx-cursor" />}
      </div>
      <div className="crx-terminal-footer">
        <span>{CARRIERS[activeIdx].name.toLowerCase()}</span>
        {saved ? <span className="saved">saved {saved}</span> : <span>processing...</span>}
      </div>
    </div>
  )
}

function Stat({ target, suffix, label }: { target: number; suffix: string; label: string }) {
  const { val, ref } = useCounter(target)
  return (
    <div className="crx-stat" ref={ref}>
      <div className="crx-stat-num">{val.toLocaleString()}<span>{suffix}</span></div>
      <div className="crx-stat-label">{label}</div>
    </div>
  )
}

export default function LandingPage() {
  const scrolled = useScrolled()
  const [active, setActive] = useState(0)
  useReveal()

  const to = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  return (
    <>
      <style>{STYLES}</style>
      <div className="crx-root">

        <nav className={`crx-nav${scrolled ? ' scrolled' : ''}`}>
          <div className="crx-logo">Collect<span>Rx</span></div>
          <button className="crx-nav-cta" onClick={() => to('crx-cta')}>Book a Demo</button>
        </nav>

        <section className="crx-hero">
          <div>
            <div className="crx-eyebrow"><div className="crx-eyebrow-dot" />AI Insurance AR for Canadian Dental</div>
            <h1 className="crx-headline">Your claims.<br /><em>Called.</em><br />Done.</h1>
            <p className="crx-subhead">
              AI voice agents call Canadian carriers, navigate IVRs, chase denials,
              and report back — so your front desk never waits on hold again.
            </p>
            <div className="crx-actions">
              <button className="crx-btn-primary" onClick={() => to('crx-cta')}>Book a Demo</button>
              <button className="crx-btn-ghost" onClick={() => to('crx-how')}>How it works</button>
            </div>
          </div>
          <Terminal activeIdx={active} onSelect={setActive} />
        </section>

        <div className="crx-stats crx-reveal">
          <Stat target={6}  suffix=" carriers" label="Canadian carriers supported" />
          <Stat target={78} suffix="%"         label="of the private dental market" />
          <Stat target={12} suffix="h"         label="saved per office per week" />
          <Stat target={3}  suffix=" max"      label="AI call attempts per claim" />
        </div>

        <section className="crx-section" id="crx-how">
          <div className="crx-reveal">
            <div className="crx-section-tag">How it works</div>
            <h2 className="crx-section-title">Four steps.<br /><em>Zero hold music.</em></h2>
          </div>
          <div className="crx-steps">
            {STEPS.map((s, i) => (
              <div className="crx-step crx-reveal" key={s.num} style={{ transitionDelay: `${i * 80}ms` }}>
                <div className="crx-step-num">{s.num}</div>
                <span className="crx-step-icon">{s.icon}</span>
                <div className="crx-step-title">{s.title}</div>
                <div className="crx-step-desc">{s.desc}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="crx-section" style={{ paddingTop: 0 }}>
          <div className="crx-reveal">
            <div className="crx-section-tag">Carriers</div>
            <h2 className="crx-section-title">Every major<br /><em>Canadian carrier.</em></h2>
          </div>
          <div className="crx-carriers-grid crx-reveal">
            {CARRIERS.map((c, i) => (
              <div
                key={c.name}
                className={`crx-carrier-card${i === active ? ' active' : ''}`}
                onClick={() => { setActive(i); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
              >
                <span className="crx-carrier-name">{c.name}</span>
                <span className="crx-carrier-pct">{c.pct} market</span>
              </div>
            ))}
          </div>
          <p className="crx-market-note crx-reveal">Click any carrier to watch the AI call simulate live above</p>
        </section>

        <div className="crx-compliance crx-reveal">
          {[
            { icon: '🔒', label: 'PHIPA Compliant' },
            { icon: '🇨🇦', label: 'PIPEDA Compliant' },
            { icon: '🛡️', label: 'PHI never sent to AI' },
            { icon: '📞', label: 'Mon–Fri 8am–5pm EST' },
            { icon: '⚡', label: 'Real-time reporting' },
          ].map(b => (
            <div className="crx-badge" key={b.label}>
              <div className="crx-badge-icon">{b.icon}</div>
              {b.label}
            </div>
          ))}
        </div>

        <div className="crx-cta" id="crx-cta">
          <div className="crx-cta-inner crx-reveal">
            <h2 className="crx-cta-title">Stop holding.<br /><em>Start collecting.</em></h2>
            <p className="crx-cta-sub">Pilot launching with select Canadian dental practices.</p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="crx-btn-white">Request Early Access</button>
              <button className="crx-btn-outline-white">Watch Full Demo</button>
            </div>
          </div>
        </div>

        <footer className="crx-footer">
          <div className="crx-logo" style={{ fontSize: '16px' }}>Collect<span style={{ color: 'var(--forest)' }}>Rx</span></div>
          <span>© 2026 CollectRx Inc. Built for Canadian dental.</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--ink2)' }}>v1.0 — pilot</span>
        </footer>

      </div>
    </>
  )
}
