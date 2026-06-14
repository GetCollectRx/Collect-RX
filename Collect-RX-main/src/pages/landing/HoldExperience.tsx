import { useCallback, useEffect, useRef, useState } from 'react'
import { HOLD_LOG_LINES } from './holdExperienceData'

export const HOLD_EXPERIENCE_STYLES = `
  .hx-hold {
    position: fixed;
    inset: 0;
    z-index: 250;
    background: #0c100e;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 24px;
    transition: opacity 0.65s ease, transform 0.65s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .hx-hold.leaving {
    opacity: 0;
    transform: scale(1.03);
    pointer-events: none;
  }

  .hx-hold-inner {
    width: 100%;
    max-width: 380px;
    text-align: center;
    animation: hx-in 0.5s ease both;
  }
  @keyframes hx-in {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: none; }
  }

  .hx-carrier {
    font-family: var(--fn, Inter, system-ui, sans-serif);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.45);
    margin-bottom: 28px;
  }

  .hx-wave {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    height: 32px;
    margin-bottom: 28px;
  }
  .hx-wave span {
    width: 3px;
    border-radius: 2px;
    background: rgba(15,157,88,0.55);
    animation: hx-bar 0.85s ease-in-out infinite alternate;
  }
  .hx-wave span:nth-child(1) { height: 8px; animation-delay: 0s; }
  .hx-wave span:nth-child(2) { height: 16px; animation-delay: 0.08s; }
  .hx-wave span:nth-child(3) { height: 24px; animation-delay: 0.16s; }
  .hx-wave span:nth-child(4) { height: 18px; animation-delay: 0.24s; }
  .hx-wave span:nth-child(5) { height: 28px; animation-delay: 0.12s; }
  .hx-wave span:nth-child(6) { height: 14px; animation-delay: 0.2s; }
  .hx-wave span:nth-child(7) { height: 22px; animation-delay: 0.04s; }
  .hx-wave span:nth-child(8) { height: 10px; animation-delay: 0.28s; }
  @keyframes hx-bar {
    from { transform: scaleY(0.35); opacity: 0.35; }
    to { transform: scaleY(1); opacity: 0.9; }
  }

  .hx-timer {
    font-family: var(--fm, 'DM Mono', monospace);
    font-size: clamp(48px, 12vw, 64px);
    font-weight: 500;
    color: #fcfcfa;
    letter-spacing: 0.04em;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    margin-bottom: 20px;
  }
  .hx-timer-label {
    font-family: var(--fn, Inter, system-ui, sans-serif);
    font-size: 13px;
    color: rgba(255,255,255,0.4);
    margin-bottom: 32px;
  }

  .hx-quote {
    font-family: var(--fn, Inter, system-ui, sans-serif);
    font-size: 15px;
    font-style: italic;
    color: rgba(255,255,255,0.55);
    line-height: 1.5;
    margin-bottom: 12px;
  }

  .hx-knife {
    font-family: var(--fn, Inter, system-ui, sans-serif);
    font-size: 14px;
    color: rgba(201,143,18,0.95);
    margin-bottom: 36px;
    min-height: 22px;
    opacity: 0;
    transform: translateY(6px);
    transition: opacity 0.6s ease, transform 0.6s ease;
  }
  .hx-knife.show { opacity: 1; transform: none; }

  .hx-end-btn {
    background: transparent;
    color: #fcfcfa;
    border: 1.5px solid rgba(255,255,255,0.35);
    padding: 14px 32px;
    border-radius: 999px;
    font-family: var(--fn, Inter, system-ui, sans-serif);
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.25s, border-color 0.25s, transform 0.25s, box-shadow 0.25s;
  }
  .hx-end-btn:hover {
    background: rgba(15,157,88,0.15);
    border-color: #0f9d58;
    transform: translateY(-1px);
    box-shadow: 0 0 32px rgba(15,157,88,0.25);
  }

  .hx-release {
    position: fixed;
    inset: 0;
    z-index: 250;
    background: #fcfcfa;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 24px;
  }

  .hx-release-inner { width: 100%; max-width: 480px; }

  .hx-log {
    font-family: var(--fm, 'DM Mono', monospace);
    font-size: 13px;
    line-height: 1.7;
    margin-bottom: 24px;
    min-height: 120px;
  }
  .hx-log-line {
    opacity: 0;
    transform: translateX(-8px);
    animation: hx-log-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }
  @keyframes hx-log-in {
    to { opacity: 1; transform: none; }
  }
  .hx-log-tag {
    display: inline-block;
    min-width: 72px;
    font-weight: 500;
  }
  .hx-log-tag.ivr { color: #60605f; }
  .hx-log-tag.claims { color: #3b7fd4; }
  .hx-log-tag.resolution { color: #0f9d58; }
  .hx-log-tag.sync { color: #0b5b47; }

  .hx-claim-card {
    background: rgba(15,157,88,0.08);
    border: 1px solid rgba(15,157,88,0.28);
    border-radius: 12px;
    padding: 20px 24px;
    opacity: 0;
    transform: scale(0.96);
    animation: hx-claim-pop 0.55s cubic-bezier(0.34, 1.4, 0.64, 1) forwards;
  }
  @keyframes hx-claim-pop {
    to { opacity: 1; transform: scale(1); }
  }
  .hx-claim-id {
    font-family: var(--fm, 'DM Mono', monospace);
    font-size: 12px;
    color: #60605f;
    margin-bottom: 6px;
  }
  .hx-claim-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .hx-claim-amt {
    font-family: var(--fs, 'Source Serif 4', Georgia, serif);
    font-size: 28px;
    font-weight: 500;
    color: #1f1f1f;
  }
  .hx-claim-badge {
    font-family: var(--fn, Inter, system-ui, sans-serif);
    font-size: 12px;
    font-weight: 600;
    color: #0b5b47;
    background: rgba(15,157,88,0.12);
    border: 1px solid rgba(15,157,88,0.25);
    padding: 5px 12px;
    border-radius: 999px;
  }

  @media (max-width: 480px) {
    .hx-end-btn { width: 100%; }
  }

  @media (prefers-reduced-motion: reduce) {
    .hx-wave span, .hx-log-line, .hx-claim-card { animation: none !important; }
    .hx-hold { transition: opacity 0.3s; transform: none !important; }
    .hx-log-line, .hx-claim-card { opacity: 1; transform: none; }
  }
`

type Phase = 'hold' | 'release'

type HoldExperienceProps = {
  onComplete: () => void
  /** Auto-click through after knife line appears (demo mode) */
  autoAdvance?: boolean
  autoAdvanceDelayMs?: number
  endButtonLabel?: string
  knifeLine?: string
}

function useHoldClock(running: boolean, startSecs = 727) {
  const [secs, setSecs] = useState(startSecs)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setSecs(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [running])
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function HoldExperience({
  onComplete,
  autoAdvance = false,
  autoAdvanceDelayMs = 4200,
  endButtonLabel = 'End hold',
  knifeLine = 'Your front desk sees this 4–5 hours a week.',
}: HoldExperienceProps) {
  const [phase, setPhase] = useState<Phase>('hold')
  const [holdLeaving, setHoldLeaving] = useState(false)
  const [showKnife, setShowKnife] = useState(false)
  const [logCount, setLogCount] = useState(0)
  const [showClaim, setShowClaim] = useState(false)
  const releaseStarted = useRef(false)
  const autoTriggered = useRef(false)

  const timer = useHoldClock(phase === 'hold')

  useEffect(() => {
    if (phase !== 'hold') return
    const id = setTimeout(() => setShowKnife(true), 2800)
    return () => clearTimeout(id)
  }, [phase])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const finish = useCallback(() => {
    document.body.style.overflow = ''
    onComplete()
  }, [onComplete])

  const endHold = useCallback(() => {
    if (phase !== 'hold') return
    setHoldLeaving(true)
    setTimeout(() => setPhase('release'), 650)
  }, [phase])

  useEffect(() => {
    if (!autoAdvance || phase !== 'hold' || !showKnife || autoTriggered.current) return
    autoTriggered.current = true
    const id = setTimeout(endHold, autoAdvanceDelayMs)
    return () => clearTimeout(id)
  }, [autoAdvance, autoAdvanceDelayMs, endHold, phase, showKnife])

  useEffect(() => {
    if (phase !== 'release' || releaseStarted.current) return
    releaseStarted.current = true

    const timers: ReturnType<typeof setTimeout>[] = []
    HOLD_LOG_LINES.forEach((_, i) => {
      timers.push(setTimeout(() => setLogCount(i + 1), 300 + i * 450))
    })
    timers.push(setTimeout(() => setShowClaim(true), 300 + HOLD_LOG_LINES.length * 450 + 200))
    timers.push(setTimeout(finish, 300 + HOLD_LOG_LINES.length * 450 + 1400))

    return () => timers.forEach(clearTimeout)
  }, [phase, finish])

  return (
    <>
      <style>{HOLD_EXPERIENCE_STYLES}</style>
      {phase === 'hold' && (
        <div className={`hx-hold${holdLeaving ? ' leaving' : ''}`} role="dialog" aria-label="On hold with insurance carrier">
          <div className="hx-hold-inner">
            <div className="hx-carrier">Sun Life · Provider line</div>
            <div className="hx-wave" aria-hidden="true">
              {[1, 2, 3, 4, 5, 6, 7, 8].map(i => <span key={i} />)}
            </div>
            <div className="hx-timer">{timer}</div>
            <div className="hx-timer-label">Estimated wait time</div>
            <p className="hx-quote">&ldquo;Your call is important to us.<br />Please continue to hold.&rdquo;</p>
            <p className={`hx-knife${showKnife ? ' show' : ''}`}>{knifeLine}</p>
            {!autoAdvance && (
              <button type="button" className="hx-end-btn" onClick={endHold}>
                {endButtonLabel}
              </button>
            )}
            {autoAdvance && showKnife && (
              <p className="hx-knife show" style={{ color: 'rgba(255,255,255,0.45)', fontStyle: 'normal', fontSize: 13 }}>
                CollectRx takes over…
              </p>
            )}
          </div>
        </div>
      )}

      {phase === 'release' && (
        <div className="hx-release" aria-live="polite">
          <div className="hx-release-inner">
            <div className="hx-log">
              {HOLD_LOG_LINES.slice(0, logCount).map(line => (
                <div key={line.tag} className="hx-log-line">
                  <span className={`hx-log-tag ${line.tag}`}>[{line.tag}]</span>
                  {' '}{line.text}
                </div>
              ))}
            </div>
            {showClaim && (
              <div className="hx-claim-card">
                <div className="hx-claim-id">#SL-847291 · Crown, Unit 14</div>
                <div className="hx-claim-row">
                  <span className="hx-claim-amt">$1,240</span>
                  <span className="hx-claim-badge">Approved · written back</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
