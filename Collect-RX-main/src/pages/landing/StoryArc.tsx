import { useCallback, useEffect, useRef, useState } from 'react'
import StoryScene, { type StoryAct } from './StoryIllustrations'

const ACT_DURATION_MS = 6500
const ACT_COUNT = 5
const AGENT_COUNT = 4

const STYLES = `
  .sa-root {
    --sa-cream: #fcfcfa;
    --sa-parchment: #f8f5ee;
    --sa-ink: #1f1f1f;
    --sa-graphite: #60605f;
    --sa-mist: #cacac8;
    --sa-green: #0f9d58;
    --sa-green-dark: #0b5b47;
    --sa-green-lo: rgba(15,157,88,0.10);
    --sa-gold: #c98f12;
    --sa-red-lo: rgba(192,57,43,0.10);
    --sa-red: #c0392b;
    --sa-bdr: rgba(31,31,31,0.10);
    --sa-fn: 'Inter', system-ui, sans-serif;
    --sa-fs: 'Source Serif 4', Georgia, serif;
  }

  .sa-hero {
    position: relative;
    min-height: calc(100vh - 68px);
    padding: 88px 0 48px;
    background: var(--sa-cream);
    background-image: linear-gradient(257deg, rgba(15,157,88,0.04) -32%, rgba(15,157,88,0.08) 24%, transparent 80%);
    overflow: hidden;
  }

  .sa-bg-glow {
    position: absolute;
    border-radius: 50%;
    filter: blur(90px);
    pointer-events: none;
    transition: opacity 1s ease;
  }
  .sa-bg-glow.g0 { width: 500px; height: 500px; top: -120px; right: -80px; background: rgba(201,143,18,0.10); }
  .sa-bg-glow.g1 { width: 450px; height: 450px; bottom: -80px; left: -100px; background: rgba(192,57,43,0.08); opacity: 0; }
  .sa-bg-glow.g2 { width: 520px; height: 520px; top: 10%; left: 30%; background: rgba(15,157,88,0.12); opacity: 0; }
  .sa-hero[data-act="0"] .sa-bg-glow.g0 { opacity: 1; }
  .sa-hero[data-act="1"] .sa-bg-glow.g1 { opacity: 1; }
  .sa-hero[data-act="2"] .sa-bg-glow.g2,
  .sa-hero[data-act="3"] .sa-bg-glow.g2,
  .sa-hero[data-act="4"] .sa-bg-glow.g2 { opacity: 1; }

  .sa-wrap {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 40px;
    position: relative;
    z-index: 1;
  }

  .sa-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--sa-cream);
    border: 1px solid rgba(31,31,31,0.18);
    padding: 6px 12px;
    border-radius: 4px;
    font-family: var(--sa-fn);
    font-size: 12px;
    font-weight: 500;
    color: var(--sa-ink);
    margin-bottom: 20px;
  }
  .sa-badge svg { width: 12px; height: 12px; fill: var(--sa-green); }

  .sa-h1 {
    font-family: var(--sa-fs);
    font-size: clamp(32px, 5vw, 56px);
    font-weight: 500;
    line-height: 1.08;
    letter-spacing: -0.01em;
    color: var(--sa-ink);
    margin-bottom: 28px;
    max-width: 640px;
  }
  .sa-h1 .dot { color: var(--sa-green); }

  .sa-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 28px;
    flex-wrap: wrap;
  }

  .sa-stepper { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .sa-step {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 6px 6px;
    font-family: var(--sa-fn);
    font-size: 11px;
    font-weight: 500;
    color: var(--sa-mist);
    transition: color 0.3s;
  }
  .sa-step:hover { color: var(--sa-graphite); }
  .sa-step.on { color: var(--sa-green-dark); }
  .sa-step-bar {
    width: 32px; height: 4px; border-radius: 999px;
    background: var(--sa-bdr); overflow: hidden; position: relative;
  }
  .sa-step-fill {
    position: absolute; inset: 0 auto 0 0; width: 0%;
    background: var(--sa-green); border-radius: 999px;
  }

  .sa-play-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 14px; border-radius: 8px;
    border: 1px solid var(--sa-bdr); background: var(--sa-cream);
    font-family: var(--sa-fn); font-size: 12px; font-weight: 500;
    color: var(--sa-graphite); cursor: pointer;
  }
  .sa-play-btn:hover { border-color: var(--sa-green); color: var(--sa-green-dark); }
  .sa-play-btn svg { width: 14px; height: 14px; fill: currentColor; }

  .sa-grid {
    display: grid;
    grid-template-columns: 42% 58%;
    gap: 40px;
    align-items: center;
  }

  .sa-copy { animation: sa-fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; }
  @keyframes sa-fade-up {
    from { opacity: 0; transform: translateY(14px); }
    to { opacity: 1; transform: none; }
  }

  .sa-act-label {
    font-family: var(--sa-fn);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 10px;
  }
  .sa-act-label.manual { color: var(--sa-gold); }
  .sa-act-label.pain { color: var(--sa-red); }
  .sa-act-label.tool { color: var(--sa-green); }

  .sa-story-h {
    font-family: var(--sa-fs);
    font-size: clamp(22px, 3vw, 32px);
    font-weight: 500;
    line-height: 1.15;
    letter-spacing: -0.01em;
    color: var(--sa-ink);
    margin-bottom: 14px;
  }
  .sa-story-h .dot { color: var(--sa-green); }

  .sa-body {
    font-family: var(--sa-fn);
    font-size: 16px;
    color: var(--sa-graphite);
    line-height: 1.65;
    margin-bottom: 24px;
  }

  .sa-cta-pair { display: flex; gap: 12px; flex-wrap: wrap; }
  .sa-btn-primary {
    background: var(--sa-green); color: #fcfcfa; border: none;
    padding: 12px 24px; border-radius: 8px;
    font-family: var(--sa-fn); font-size: 16px; font-weight: 500;
    cursor: pointer; display: inline-flex; align-items: center; gap: 8px;
    transition: background 0.2s, transform 0.2s;
  }
  .sa-btn-primary:hover { background: var(--sa-green-dark); transform: translateY(-1px); }
  .sa-btn-primary svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.2; }
  .sa-btn-ghost {
    background: transparent; color: var(--sa-green);
    border: 1.5px solid var(--sa-green);
    padding: 11px 24px; border-radius: 8px;
    font-family: var(--sa-fn); font-size: 16px; font-weight: 500;
    cursor: pointer;
  }
  .sa-btn-ghost:hover { background: var(--sa-green-lo); }

  .sa-theatre {
    position: relative;
    height: min(420px, 50vh);
    border-radius: 20px;
    background: linear-gradient(160deg, var(--sa-parchment) 0%, var(--sa-cream) 100%);
    border: 1px solid var(--sa-bdr);
    box-shadow: 0 32px 80px -32px rgba(31,31,31,0.18);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px 12px;
    transition: box-shadow 0.8s ease, border-color 0.8s ease;
  }
  .sa-theatre[data-act="0"] { border-color: rgba(201,143,18,0.25); }
  .sa-theatre[data-act="1"] { border-color: rgba(192,57,43,0.2); box-shadow: 0 32px 80px -32px rgba(192,57,43,0.12); }
  .sa-theatre[data-act="2"],
  .sa-theatre[data-act="3"],
  .sa-theatre[data-act="4"] { border-color: rgba(15,157,88,0.25); box-shadow: 0 32px 80px -32px rgba(15,157,88,0.15); }

  .ill-scene {
    width: 100%;
    max-width: 480px;
    height: auto;
    display: block;
  }

  /* ── Shared scene motion ── */
  .ill-scene.live .ill-admin { transition: transform 0.7s cubic-bezier(0.22, 1, 0.36, 1); }
  .ill-scene.live .ill-tint { transition: fill 0.8s ease; }
  .ill-scene.live .ill-manual-phone,
  .ill-scene.live .ill-crx-panel {
    transition: opacity 0.85s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .ill-scene.live .ill-crx-panel {
    transform-origin: 338px 200px;
    transition: opacity 0.85s ease, transform 0.7s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .ill-scene.live .ill-crx-panel.expanded {
    transform: translate(-18px, -22px) scale(1.12);
  }

  .ill-scene.live .ill-claim-card { animation: ill-card-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both; }
  .ill-scene.live .ill-claim-0 { animation-delay: 0.05s; }
  .ill-scene.live .ill-claim-1 { animation-delay: 0.12s; }
  .ill-scene.live .ill-claim-2 { animation-delay: 0.19s; }
  .ill-scene.live .ill-claim-3 { animation-delay: 0.26s; }
  @keyframes ill-card-in {
    from { opacity: 0; transform: translateX(12px); }
    to { opacity: 1; transform: none; }
  }

  .ill-scene.live .ill-tray.live .ill-claim-3 { animation: ill-age-pulse 2.5s ease-in-out infinite; }
  @keyframes ill-age-pulse {
    0%, 100% { transform: translateY(30px); }
    50% { transform: translateY(28px); }
  }

  .ill-scene.live .ill-clock-h { animation: ill-tick 5s linear infinite; }
  .ill-scene.live .ill-clock-m { animation: ill-tick 30s linear infinite; }
  @keyframes ill-tick { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  .ill-scene.live .ill-vibe { animation: ill-vibe 0.35s ease-in-out infinite; transform-origin: 285px 224px; }
  @keyframes ill-vibe {
    0%, 100% { transform: rotate(0deg); }
    25% { transform: rotate(-3deg); }
    75% { transform: rotate(3deg); }
  }

  .ill-scene.live .ill-wave-a { animation: ill-wave-p 1.1s ease-in-out infinite; }
  .ill-scene.live .ill-wave-b { animation: ill-wave-p 1.1s ease-in-out 0.25s infinite; }
  .ill-scene.live .ill-hbar-0 { animation: ill-bar 0.8s ease-in-out infinite alternate; }
  .ill-scene.live .ill-hbar-1 { animation: ill-bar 0.8s ease-in-out 0.1s infinite alternate; }
  .ill-scene.live .ill-hbar-2 { animation: ill-bar 0.8s ease-in-out 0.2s infinite alternate; }
  .ill-scene.live .ill-hbar-3 { animation: ill-bar 0.8s ease-in-out 0.3s infinite alternate; }
  .ill-scene.live .ill-hbar-4 { animation: ill-bar 0.8s ease-in-out 0.15s infinite alternate; }
  @keyframes ill-wave-p { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
  @keyframes ill-bar { from { opacity: 0.35; transform: scaleY(0.6); } to { opacity: 1; transform: scaleY(1); } }

  .ill-scene.live .ill-crx-panel.on .ill-panel-glow { animation: ill-glow 2.5s ease-in-out infinite; }
  @keyframes ill-glow {
    0%, 100% { filter: drop-shadow(0 0 0 rgba(15,157,88,0)); }
    50% { filter: drop-shadow(0 0 10px rgba(15,157,88,0.35)); }
  }
  .ill-scene.live .ill-pulse-dot { animation: ill-pulse 1.4s ease-in-out infinite; }
  @keyframes ill-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

  .ill-scene.live .ill-flow-track { animation: ill-dash 1.2s linear infinite; }
  @keyframes ill-dash { to { stroke-dashoffset: -28; } }

  .ill-scene.live .ill-pipe-node.active circle:nth-child(2) {
    animation: ill-node-pulse 1s ease-in-out infinite;
    transform-box: fill-box;
  }
  @keyframes ill-node-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.2); }
  }

  .ill-scene.live .ill-metric { animation: ill-metric-in 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
  .ill-scene.live .ill-metric-money { animation-delay: 0.15s; }
  .ill-scene.live .ill-ar-green { animation: ill-green-in 0.7s cubic-bezier(0.34, 1.4, 0.64, 1) 0.2s both; }
  @keyframes ill-metric-in {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: none; }
  }
  @keyframes ill-green-in {
    from { opacity: 0; transform: scale(0.9); }
    to { opacity: 1; transform: scale(1); }
  }

  .ill-scene.live .ill-patient { animation: ill-float 3s ease-in-out infinite; }
  @keyframes ill-float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }

  @media (max-width: 960px) {
    .sa-grid { grid-template-columns: 1fr; gap: 24px; }
    .sa-theatre { height: 340px; order: -1; }
    .sa-h1 { font-size: clamp(28px, 7vw, 40px); }
    .sa-step-label { display: none; }
  }
  @media (max-width: 480px) {
    .sa-wrap { padding: 0 20px; }
    .sa-hero { padding-top: 80px; }
    .sa-theatre { height: 280px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .ill-scene.live * { animation: none !important; }
    .sa-copy { animation: none; }
    .ill-scene.live .ill-manual-phone,
    .ill-scene.live .ill-crx-panel { transition: opacity 0.3s; }
  }
`

const AGENTS = [
  { value: 'Dials every carrier IVR silently, menus, credentials, hold limits handled automatically.' },
  { value: 'Speaks with the rep, asks the status question, captures reference numbers and denial codes.' },
  { value: 'Routes denials, x-ray requests, and CDCP reconsiderations before your team gets involved.' },
  { value: 'Confirms payment, resubmit paths, and writes status back, every claim leaves resolved.' },
]

const ACTS = [
  {
    label: 'Manual process',
    labelClass: 'manual',
    stepLabel: 'Manual',
    headline: <>Insurance dollars pile up, uncollected<span className="dot">.</span></>,
    body: 'Claims sit on carrier systems past 30, 60, 90 days. Your team chases them by hand, paper stacks, phone calls, spreadsheets.',
  },
  {
    label: 'The manual grind',
    labelClass: 'pain',
    stepLabel: 'On hold',
    headline: <>Staff spend hours on hold every week<span className="dot">.</span></>,
    body: 'Front desk dials Sun Life, Canada Life, Manulife, navigating IVRs, waiting for reps, re-explaining the same claim. Time and morale drain away.',
  },
  {
    label: 'The replacement',
    labelClass: 'tool',
    stepLabel: 'CollectRx',
    headline: <>A sophisticated tool takes over<span className="dot">.</span></>,
    body: 'CollectRx replaces the manual phone queue. Upload a PMS export, AI voice agents call carriers, navigate IVRs, and write status back automatically.',
  },
  {
    label: 'How it works',
    labelClass: 'tool',
    stepLabel: 'Agents',
    headline: <>Four specialized agents, one chain<span className="dot">.</span></>,
    body: 'Each agent handles one part of the call, handing off mid-conversation so nothing falls through the cracks.',
  },
  {
    label: 'The payoff',
    labelClass: 'tool',
    stepLabel: 'Saved',
    headline: <>Time back. Revenue recovered<span className="dot">.</span></>,
    body: 'Hours freed from hold lines. Insurance AR collected instead of written off. Your team back at the front desk, with patients, not carriers.',
  },
]

function useHoldTimer(active: boolean) {
  const [secs, setSecs] = useState(487)
  useEffect(() => {
    if (!active) { setSecs(487); return }
    const id = setInterval(() => setSecs(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [active])
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function useAgingCycle(active: boolean) {
  const [days, setDays] = useState(94)
  useEffect(() => {
    if (!active) { setDays(94); return }
    const seq = [94, 78, 62, 47, 94]
    let i = 0
    const id = setInterval(() => {
      i = (i + 1) % seq.length
      setDays(seq[i])
    }, 2200)
    return () => clearInterval(id)
  }, [active])
  return days
}

function useCountUp(active: boolean, target: number, ms = 2000) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!active) { setVal(0); return }
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min((now - start) / ms, 1)
      setVal(Math.round((1 - (1 - p) ** 3) * target))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, target, ms])
  return val
}

type StoryHeroProps = {
  onRequestAccess: () => void
  onScrollTo?: (id: string) => void
}

export default function StoryHero({ onRequestAccess, onScrollTo }: StoryHeroProps) {
  const sectionRef = useRef<HTMLElement>(null)
  const [act, setAct] = useState(0)
  const [agentIndex, setAgentIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [inView, setInView] = useState(true)
  const [actProgress, setActProgress] = useState(0)
  const [copyKey, setCopyKey] = useState(0)
  const actStartRef = useRef(performance.now())
  const elapsedRef = useRef(0)
  const manualPauseRef = useRef(false)

  const moneySaved = useCountUp(act === 4, 38400)
  const hoursSaved = useCountUp(act === 4, 208)
  const holdTimer = useHoldTimer(act === 1)
  const agingDays = useAgingCycle(act === 0)

  const pauseTimeline = useCallback(() => {
    elapsedRef.current = performance.now() - actStartRef.current
  }, [])

  const resumeTimeline = useCallback(() => {
    actStartRef.current = performance.now() - elapsedRef.current
  }, [])

  const goToAct = useCallback((next: number) => {
    setAct(next)
    setAgentIndex(0)
    setActProgress(0)
    setCopyKey(k => k + 1)
    actStartRef.current = performance.now()
    elapsedRef.current = 0
  }, [])

  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.15 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!playing || !inView) return
    let raf = 0
    const loop = (now: number) => {
      const elapsed = now - actStartRef.current
      setActProgress(Math.min(elapsed / ACT_DURATION_MS, 1) * 100)
      if (act === 3) {
        setAgentIndex(Math.min(AGENT_COUNT - 1, Math.floor(elapsed / (ACT_DURATION_MS / AGENT_COUNT))))
      }
      if (elapsed >= ACT_DURATION_MS) goToAct((act + 1) % ACT_COUNT)
      else raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [act, playing, inView, goToAct])

  const togglePlay = () => {
    if (playing) { pauseTimeline(); manualPauseRef.current = true; setPlaying(false) }
    else { resumeTimeline(); manualPauseRef.current = false; setPlaying(true) }
  }

  const current = ACTS[act]
  const bodyText = act === 3 ? AGENTS[agentIndex].value : current.body

  return (
    <>
      <style>{STYLES}</style>
      <section
        ref={sectionRef}
        id="story"
        className="sa-root sa-hero"
        data-act={act}
        aria-label="CollectRx story"
        onMouseEnter={() => { pauseTimeline(); setPlaying(false) }}
        onMouseLeave={() => {
          if (!manualPauseRef.current) { resumeTimeline(); setPlaying(true) }
        }}
      >
        <div className="sa-bg-glow g0" aria-hidden="true" />
        <div className="sa-bg-glow g1" aria-hidden="true" />
        <div className="sa-bg-glow g2" aria-hidden="true" />

        <div className="sa-wrap">
          <div className="sa-badge">
            <svg viewBox="0 0 24 24"><path d="M12 0l2.5 9.5L24 12l-9.5 2.5L12 24l-2.5-9.5L0 12l9.5-2.5z" /></svg>
            Canadian Insurance AR Automation · Early Access
          </div>

          <h1 className="sa-h1">
            Collect outstanding insurance AR<br />
            without staff on hold<span className="dot">.</span>
          </h1>

          <div className="sa-controls">
            <div className="sa-stepper" role="tablist" aria-label="Story chapters">
              {ACTS.map((a, i) => (
                <button
                  key={a.stepLabel}
                  type="button"
                  role="tab"
                  aria-selected={i === act}
                  className={`sa-step${i === act ? ' on' : ''}`}
                  onClick={() => { goToAct(i); pauseTimeline(); manualPauseRef.current = true; setPlaying(false) }}
                >
                  <span className="sa-step-bar">
                    {i === act && <span className="sa-step-fill" style={{ width: `${actProgress}%` }} />}
                  </span>
                  <span className="sa-step-label">{a.stepLabel}</span>
                </button>
              ))}
            </div>
            <button type="button" className="sa-play-btn" onClick={togglePlay} aria-pressed={playing}>
              {playing ? (
                <><svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg> Pause</>
              ) : (
                <><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg> Play story</>
              )}
            </button>
          </div>

          <div className="sa-grid">
            <div className="sa-theatre" data-act={act} aria-live="polite">
              <StoryScene
                act={act as StoryAct}
                live
                agentIndex={agentIndex}
                holdTimer={holdTimer}
                money={moneySaved}
                hours={hoursSaved}
                agingDays={agingDays}
              />
            </div>

            <div className="sa-copy" key={copyKey}>
              <div className={`sa-act-label ${current.labelClass}`}>{current.label}</div>
              <h2 className="sa-story-h">{current.headline}</h2>
              <p className="sa-body">{bodyText}</p>
              <div className="sa-cta-pair">
                <button type="button" className="sa-btn-primary" onClick={onRequestAccess}>
                  Request Early Access
                  <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                </button>
                {onScrollTo && (
                  <button type="button" className="sa-btn-ghost" onClick={() => onScrollTo('how-it-works')}>
                    See how it works
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

// Keep default export alias for any existing imports
export { StoryHero as StoryArc }
