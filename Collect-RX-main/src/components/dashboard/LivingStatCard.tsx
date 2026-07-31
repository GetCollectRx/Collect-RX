import { useCountUp } from '../../hooks/useCountUp'
import { RecoveryBadge, type RecoveryVerification } from '../RecoveryBadge'

type Tone = 'green' | 'amber' | 'red' | 'blue'

const toneVars: Record<Tone, { accent: string; glow: string }> = {
  green: { accent: 'var(--crx-green)', glow: 'rgba(15,157,88,0.18)' },
  amber: { accent: 'var(--crx-gold)', glow: 'rgba(201,143,18,0.2)' },
  red: { accent: 'var(--crx-red)', glow: 'rgba(214,69,69,0.18)' },
  blue: { accent: 'var(--crx-blue)', glow: 'rgba(59,127,212,0.18)' },
}

type Props = {
  label: string
  displayValue: string
  countUp?: number
  formatCount?: (n: number) => string
  sub?: string
  badge?: string
  recoveryVerification?: RecoveryVerification
  tone?: Tone
  live?: boolean
  delayMs?: number
}

export function LivingStatCard({
  label,
  displayValue,
  countUp,
  formatCount = (n) => String(n),
  sub,
  badge,
  recoveryVerification,
  tone = 'green',
  live = false,
  delayMs = 0,
}: Props) {
  const animated = useCountUp(countUp ?? 0, 1200 + delayMs, countUp != null)
  const valueText = countUp != null ? formatCount(animated) : displayValue
  const { accent, glow } = toneVars[tone]

  return (
    <article
      className="living-stat-card group relative overflow-hidden rounded-2xl p-5"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="living-stat-orb" style={{ background: glow }} aria-hidden />
      {live && <span className="living-pulse-dot" aria-label="Live" />}
      <p className="crx-stat-label mb-2 relative z-10">{label}</p>
      <p
        className="living-stat-value relative z-10 tabular-nums"
        key={valueText}
      >
        {valueText}
      </p>
      {sub && <p className="crx-sub mt-1 relative z-10">{sub}</p>}
      {(recoveryVerification || badge) && (
        <div className="relative z-10 mt-3 flex flex-wrap items-center gap-2">
          {recoveryVerification && <RecoveryBadge verification={recoveryVerification} />}
          {badge && (
            <span
              className="living-stat-badge inline-block"
              style={{ borderColor: accent, color: accent }}
            >
              {badge}
            </span>
          )}
        </div>
      )}
    </article>
  )
}
