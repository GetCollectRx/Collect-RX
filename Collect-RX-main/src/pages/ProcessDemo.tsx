import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import HoldExperience from './landing/HoldExperience'
import { DEMO_AGENTS, DEMO_CLAIM } from './landing/holdExperienceData'

type Step = 'intro' | 'hold' | 'agents' | 'dashboard' | 'outcome' | 'close'

const STEPS: Step[] = ['hold', 'agents', 'dashboard', 'outcome', 'close']
const STEP_LABELS: Record<Step, string> = {
  intro: '',
  hold: 'On hold',
  agents: 'Agent squad',
  dashboard: 'Written back',
  outcome: 'The payoff',
  close: 'Next step',
}

const PARALLEL_CALLS = [
  { carrier: 'Canada Life', amt: '$980', status: 'Approved' },
  { carrier: 'Manulife', amt: '$1,560', status: 'Approved' },
  { carrier: 'Green Shield', amt: '$890', status: 'Flagged' },
  { carrier: 'RBC Insurance', amt: '$760', status: 'Approved' },
]

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,500&family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600&family=DM+Mono:wght@400;500&display=swap');

  .pd-root {
    min-height: 100vh;
    background: #fcfcfa;
    color: #1f1f1f;
    font-family: 'Inter', system-ui, sans-serif;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .pd-header {
    background: #0b5b47;
    padding: 12px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-shrink: 0;
  }
  .pd-header-left { display: flex; align-items: center; gap: 12px; }
  .pd-logo {
    font-weight: 600;
    font-size: 14px;
    color: #fcfcfa;
    text-decoration: none;
  }
  .pd-logo span { color: #6ee7b7; }
  .pd-badge {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.55);
    padding-left: 12px;
    border-left: 1px solid rgba(255,255,255,0.2);
  }

  .pd-step-bar { display: flex; align-items: center; gap: 8px; }
  .pd-step-dot {
    height: 5px;
    border-radius: 3px;
    border: none;
    padding: 0;
    cursor: default;
    transition: all 0.3s ease;
    background: rgba(255,255,255,0.2);
  }
  .pd-step-dot.done { background: #6ee7b7; width: 5px; }
  .pd-step-dot.active { background: #fff; width: 24px; }
  .pd-step-dot.pending { width: 5px; }

  .pd-restart {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    color: rgba(255,255,255,0.8);
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  .pd-restart:hover { background: rgba(255,255,255,0.16); }

  .pd-label-bar {
    background: #0a5240;
    padding: 6px 24px;
    flex-shrink: 0;
  }
  .pd-label-bar span {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.45);
  }

  .pd-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 24px;
    overflow-y: auto;
  }

  .pd-intro-card {
    max-width: 520px;
    text-align: center;
    background: #fff;
    border: 1px solid rgba(31,31,31,0.1);
    border-radius: 20px;
    padding: 48px 40px;
    box-shadow: 0 24px 64px -24px rgba(31,31,31,0.18);
  }
  .pd-intro-tag {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #0f9d58;
    background: rgba(15,157,88,0.1);
    padding: 5px 14px;
    border-radius: 999px;
    margin-bottom: 20px;
  }
  .pd-intro-h1 {
    font-family: 'Source Serif 4', Georgia, serif;
    font-size: clamp(24px, 4vw, 34px);
    font-weight: 500;
    line-height: 1.15;
    margin-bottom: 14px;
  }
  .pd-intro-body {
    color: #60605f;
    font-size: 15px;
    line-height: 1.65;
    margin-bottom: 28px;
  }
  .pd-start-btn {
    background: #0f9d58;
    color: #fcfcfa;
    border: none;
    border-radius: 10px;
    padding: 14px 36px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 4px 20px rgba(15,157,88,0.35);
    transition: transform 0.2s, background 0.2s;
  }
  .pd-start-btn:hover { background: #0b5b47; transform: translateY(-1px); }

  .pd-panel {
    width: 100%;
    max-width: 640px;
    animation: pd-fade 0.5s ease both;
  }
  @keyframes pd-fade {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: none; }
  }

  .pd-claim-header {
    background: rgba(15,157,88,0.08);
    border: 1px solid rgba(15,157,88,0.25);
    border-radius: 14px;
    padding: 18px 22px;
    margin-bottom: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .pd-claim-title { font-weight: 600; font-size: 15px; }
  .pd-claim-sub { font-size: 12px; color: #60605f; margin-top: 4px; }
  .pd-claim-amt {
    font-family: 'Source Serif 4', Georgia, serif;
    font-size: 22px;
    font-weight: 500;
    color: #0f9d58;
    text-align: right;
  }

  .pd-agent {
    background: #fff;
    border: 1px solid rgba(31,31,31,0.1);
    border-radius: 12px;
    padding: 16px 18px;
    margin-bottom: 10px;
    opacity: 0.35;
    transform: translateX(-6px);
    transition: all 0.45s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .pd-agent.visible { opacity: 1; transform: none; }
  .pd-agent.active {
    border-color: rgba(15,157,88,0.4);
    background: rgba(15,157,88,0.06);
    box-shadow: 0 8px 24px -8px rgba(15,157,88,0.2);
  }
  .pd-agent.done { opacity: 1; }
  .pd-agent-top { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
  .pd-agent-num {
    width: 26px; height: 26px; border-radius: 50%;
    display: grid; place-items: center;
    font-size: 11px; font-weight: 700;
    background: rgba(31,31,31,0.06);
    color: #60605f;
    flex-shrink: 0;
  }
  .pd-agent.active .pd-agent-num,
  .pd-agent.done .pd-agent-num {
    background: #0f9d58;
    color: #fcfcfa;
  }
  .pd-agent-name { font-weight: 600; font-size: 14px; }
  .pd-agent-role { font-size: 12px; color: #60605f; }
  .pd-agent-detail {
    margin-left: 38px;
    font-size: 13px;
    color: #60605f;
    line-height: 1.5;
    max-height: 0;
    overflow: hidden;
    opacity: 0;
    transition: max-height 0.4s ease, opacity 0.35s ease;
  }
  .pd-agent.active .pd-agent-detail,
  .pd-agent.done .pd-agent-detail {
    max-height: 80px;
    opacity: 1;
    margin-top: 4px;
  }

  .pd-queue {
    background: #fff;
    border: 1px solid rgba(31,31,31,0.1);
    border-radius: 14px;
    overflow: hidden;
  }
  .pd-queue-head {
    padding: 14px 18px;
    border-bottom: 1px solid rgba(31,31,31,0.08);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .pd-queue-title { font-weight: 600; font-size: 14px; }
  .pd-queue-live {
    display: flex; align-items: center; gap: 6px;
    font-size: 11px; font-weight: 600; color: #0f9d58;
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .pd-queue-live span {
    width: 6px; height: 6px; border-radius: 50%;
    background: #0f9d58;
    animation: pd-pulse 1.2s ease infinite;
  }
  @keyframes pd-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.85); }
  }

  .pd-queue-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 18px;
    border-bottom: 1px solid rgba(31,31,31,0.06);
    gap: 12px;
    opacity: 0;
    transform: translateY(6px);
    animation: pd-row-in 0.4s ease forwards;
  }
  @keyframes pd-row-in {
    to { opacity: 1; transform: none; }
  }
  .pd-queue-row:last-child { border-bottom: none; }
  .pd-queue-id {
    font-family: 'DM Mono', monospace;
    font-size: 12px;
    color: #60605f;
  }
  .pd-queue-desc { font-size: 13px; margin-top: 2px; }
  .pd-queue-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .pd-queue-badge.approved {
    color: #0b5b47;
    background: rgba(15,157,88,0.12);
    border: 1px solid rgba(15,157,88,0.25);
  }
  .pd-queue-badge.flagged {
    color: #92400e;
    background: rgba(201,143,18,0.12);
    border: 1px solid rgba(201,143,18,0.25);
  }

  .pd-outcome-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 14px;
    margin-bottom: 24px;
  }
  .pd-stat {
    background: #fff;
    border: 1px solid rgba(31,31,31,0.1);
    border-radius: 14px;
    padding: 22px 20px;
    text-align: center;
  }
  .pd-stat-num {
    font-family: 'Source Serif 4', Georgia, serif;
    font-size: clamp(28px, 5vw, 36px);
    font-weight: 500;
    color: #0f9d58;
    line-height: 1;
    margin-bottom: 8px;
  }
  .pd-stat-lbl { font-size: 13px; color: #60605f; line-height: 1.45; }

  .pd-close-card {
    background: #0b5b47;
    border-radius: 16px;
    padding: 32px 28px;
    text-align: center;
    color: #fcfcfa;
  }
  .pd-close-h {
    font-family: 'Source Serif 4', Georgia, serif;
    font-size: clamp(20px, 3vw, 26px);
    font-weight: 500;
    line-height: 1.25;
    margin-bottom: 10px;
  }
  .pd-close-body {
    font-size: 14px;
    color: rgba(255,255,255,0.65);
    margin-bottom: 24px;
    line-height: 1.6;
  }
  .pd-close-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .pd-cta-primary {
    background: #fcfcfa;
    color: #0b5b47;
    padding: 12px 28px;
    border-radius: 9px;
    font-weight: 700;
    font-size: 14px;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .pd-cta-ghost {
    background: rgba(255,255,255,0.12);
    border: 1px solid rgba(255,255,255,0.25);
    color: #fcfcfa;
    padding: 12px 24px;
    border-radius: 9px;
    font-weight: 600;
    font-size: 13px;
    text-decoration: none;
  }

  @media (max-width: 520px) {
    .pd-outcome-grid { grid-template-columns: 1fr; }
    .pd-badge { display: none; }
  }
`

function useStepTimer(step: Step, ms: number, onDone: () => void, enabled: boolean) {
  const fired = useRef(false)
  useEffect(() => {
    fired.current = false
  }, [step])
  useEffect(() => {
    if (!enabled || fired.current) return
    const id = setTimeout(() => {
      fired.current = true
      onDone()
    }, ms)
    return () => clearTimeout(id)
  }, [step, ms, onDone, enabled])
}

function AgentsStep({ onComplete }: { onComplete: () => void }) {
  const [activeIdx, setActiveIdx] = useState(-1)

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    DEMO_AGENTS.forEach((_, i) => {
      timers.push(setTimeout(() => setActiveIdx(i), 400 + i * 2200))
    })
    timers.push(setTimeout(onComplete, 400 + DEMO_AGENTS.length * 2200 + 800))
    return () => timers.forEach(clearTimeout)
  }, [onComplete])

  return (
    <div className="pd-panel">
      <div className="pd-claim-header">
        <div>
          <div className="pd-claim-title">{DEMO_CLAIM.carrier} · {DEMO_CLAIM.id}</div>
          <div className="pd-claim-sub">{DEMO_CLAIM.desc} · {DEMO_CLAIM.daysOutstanding} days outstanding</div>
        </div>
        <div className="pd-claim-amt">{DEMO_CLAIM.amt}</div>
      </div>
      {DEMO_AGENTS.map((agent, i) => (
        <div
          key={agent.key}
          className={`pd-agent${i <= activeIdx ? ' visible' : ''}${i === activeIdx ? ' active' : ''}${i < activeIdx ? ' done' : ''}`}
        >
          <div className="pd-agent-top">
            <div className="pd-agent-num">{i < activeIdx ? '✓' : i + 1}</div>
            <div>
              <div className="pd-agent-name">{agent.name}</div>
              <div className="pd-agent-role">{agent.role}</div>
            </div>
          </div>
          <div className="pd-agent-detail">{agent.detail}</div>
        </div>
      ))}
    </div>
  )
}

function DashboardStep({ onComplete }: { onComplete: () => void }) {
  useStepTimer('dashboard', 5500, onComplete, true)

  return (
    <div className="pd-panel">
      <div className="pd-queue">
        <div className="pd-queue-head">
          <span className="pd-queue-title">Insurance AR queue</span>
          <div className="pd-queue-live"><span />Live sync</div>
        </div>
        <div className="pd-queue-row" style={{ animationDelay: '0ms' }}>
          <div>
            <div className="pd-queue-id">{DEMO_CLAIM.id}</div>
            <div className="pd-queue-desc">{DEMO_CLAIM.desc} · {DEMO_CLAIM.carrier}</div>
          </div>
          <span className="pd-queue-badge approved">{DEMO_CLAIM.amt} · Approved</span>
        </div>
        {PARALLEL_CALLS.map((c, i) => (
          <div key={c.carrier} className="pd-queue-row" style={{ animationDelay: `${(i + 1) * 120}ms` }}>
            <div>
              <div className="pd-queue-id">{c.carrier}</div>
              <div className="pd-queue-desc">Follow-up call completed</div>
            </div>
            <span className={`pd-queue-badge ${c.status === 'Approved' ? 'approved' : 'flagged'}`}>
              {c.amt} · {c.status}
            </span>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 16, fontSize: 13, color: '#60605f', textAlign: 'center', lineHeight: 1.55 }}>
        No staff action required. Outcomes written back to your queue automatically.
      </p>
    </div>
  )
}

function OutcomeStep({ onComplete }: { onComplete: () => void }) {
  useStepTimer('outcome', 6000, onComplete, true)

  return (
    <div className="pd-panel">
      <div className="pd-outcome-grid">
        <div className="pd-stat">
          <div className="pd-stat-num">4–5 hrs</div>
          <div className="pd-stat-lbl">Front-desk hold time eliminated per week</div>
        </div>
        <div className="pd-stat">
          <div className="pd-stat-num">$1,240</div>
          <div className="pd-stat-lbl">Recovered on this claim alone</div>
        </div>
        <div className="pd-stat">
          <div className="pd-stat-num">6</div>
          <div className="pd-stat-lbl">Major Canadian carriers covered</div>
        </div>
        <div className="pd-stat">
          <div className="pd-stat-num">0</div>
          <div className="pd-stat-lbl">New software for staff to learn</div>
        </div>
      </div>
    </div>
  )
}

function CloseStep() {
  return (
    <div className="pd-panel">
      <div className="pd-close-card">
        <div className="pd-close-h">Your AR is already earned.<br />CollectRx collects it for you.</div>
        <p className="pd-close-body">
          One afternoon to connect your PMS export. Calls start the next business morning.
        </p>
        <div className="pd-close-actions">
          <a href="https://calendly.com/collectrx/pilot-setup" target="_blank" rel="noopener noreferrer" className="pd-cta-primary">
            Book a setup call →
          </a>
          <Link to="/landing" className="pd-cta-ghost">Request early access</Link>
        </div>
      </div>
    </div>
  )
}

export default function ProcessDemo() {
  const [step, setStep] = useState<Step>('intro')

  const restart = useCallback(() => setStep('intro'), [])
  const start = useCallback(() => setStep('hold'), [])
  const advance = useCallback(() => {
    setStep(prev => {
      const i = STEPS.indexOf(prev as typeof STEPS[number])
      if (i < 0 || i >= STEPS.length - 1) return prev
      return STEPS[i + 1]
    })
  }, [])

  const stepIdx = STEPS.indexOf(step as typeof STEPS[number])

  return (
    <div className="pd-root">
      <style>{STYLES}</style>

      <header className="pd-header">
        <div className="pd-header-left">
          <Link to="/landing" className="pd-logo">Collect<span>Rx</span></Link>
          <span className="pd-badge">Live process demo</span>
        </div>
        {step !== 'intro' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="pd-step-bar" aria-hidden="true">
              {STEPS.map((s, i) => (
                <div
                  key={s}
                  className={`pd-step-dot ${i < stepIdx ? 'done' : i === stepIdx ? 'active' : 'pending'}`}
                />
              ))}
            </div>
            <button type="button" className="pd-restart" onClick={restart}>↺ Restart</button>
          </div>
        )}
      </header>

      {step !== 'intro' && step !== 'hold' && (
        <div className="pd-label-bar">
          <span>{STEP_LABELS[step]}</span>
        </div>
      )}

      <main className="pd-main">
        {step === 'intro' && (
          <div className="pd-intro-card">
            <div className="pd-intro-tag">End-to-end demo · ~90 seconds</div>
            <h1 className="pd-intro-h1">Watch one claim go from hold to paid.</h1>
            <p className="pd-intro-body">
              See what your front desk lives through every week, then watch CollectRx&apos;s
              agent squad navigate the carrier, resolve the claim, and write it back. No staff on the phone.
            </p>
            <button type="button" className="pd-start-btn" onClick={start}>
              Start demo →
            </button>
          </div>
        )}

        {step === 'hold' && (
          <HoldExperience
            onComplete={advance}
            autoAdvance={false}
            endButtonLabel="Let CollectRx take this call"
            knifeLine="Your front desk sees this 4–5 hours a week."
          />
        )}

        {step === 'agents' && <AgentsStep onComplete={advance} />}
        {step === 'dashboard' && <DashboardStep onComplete={advance} />}
        {step === 'outcome' && <OutcomeStep onComplete={advance} />}
        {step === 'close' && <CloseStep />}
      </main>
    </div>
  )
}
