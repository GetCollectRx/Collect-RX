import { useEffect } from 'react'
import { useStartupHealth, type StartupStep } from '../hooks/useStartupHealth'
import { CollectRxLogoMark } from './brand/CollectRxLogo'

type StartupScreenProps = {
  authReady: boolean
  onComplete: () => void
}

function StepRow({ step }: { step: StartupStep }) {
  return (
    <div className={`crx-startup-step is-${step.status}`}>
      <span className="crx-startup-step-icon" aria-hidden>
        {step.status === 'done' && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {step.status === 'running' && <span className="crx-startup-spinner" />}
        {step.status === 'error' && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" />
          </svg>
        )}
        {step.status === 'pending' && <span className="crx-startup-dot" />}
      </span>
      <span className="crx-startup-step-label">{step.label}</span>
    </div>
  )
}

export function StartupScreen({ authReady, onComplete }: StartupScreenProps) {
  const { steps, phase, progress } = useStartupHealth(authReady)

  useEffect(() => {
    if (phase !== 'ready') return
    const id = setTimeout(onComplete, 250)
    return () => clearTimeout(id)
  }, [phase, onComplete])

  return (
    <div className="crx-startup" role="status" aria-live="polite" aria-busy={phase === 'checking'}>
      <div className="crx-startup-inner">
        <div className="crx-startup-logo" aria-hidden>
          <CollectRxLogoMark size={44} />
        </div>
        <p className="crx-startup-brand">
          Collect<span>Rx</span>
        </p>

        {phase === 'checking' ? (
          <>
            <div className="crx-startup-bar-track" aria-hidden>
              <div className="crx-startup-bar-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="crx-startup-steps">
              {steps.map(step => (
                <StepRow key={step.id} step={step} />
              ))}
            </div>
          </>
        ) : (
          <div className="crx-startup-ready">
            <div className="crx-startup-ready-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="crx-startup-ready-msg">You&apos;re ready to collect.</p>
          </div>
        )}
      </div>
    </div>
  )
}
