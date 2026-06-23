import { useMemo, useState } from 'react'

const STAGE_META: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Pending', color: '#94a3b8' },
  IN_QUEUE: { label: 'In queue', color: '#5C9AFF' },
  IN_PROGRESS: { label: 'In progress', color: '#5C9AFF' },
  CALLING: { label: 'Calling', color: '#12C96D' },
  APPROVED_PENDING_PAYMENT: { label: 'Approved', color: '#12C96D' },
  ESCALATED: { label: 'Escalated', color: '#FF5C5C' },
  ON_HOLD: { label: 'On hold', color: '#F0B429' },
  BLOCKED: { label: 'Blocked', color: '#a78bfa' },
}

type Props = {
  stageCounts: Record<string, number>
  revenueWeekCents: number
}

export function LivingPipelineFlow({ stageCounts, revenueWeekCents }: Props) {
  const [hovered, setHovered] = useState<string | null>(null)
  const entries = useMemo(
    () =>
      Object.entries(stageCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([stage, count]) => ({
          stage,
          count,
          ...(STAGE_META[stage] ?? { label: stage, color: '#94a3b8' }),
        })),
    [stageCounts],
  )
  const total = entries.reduce((s, e) => s + e.count, 0)
  const max = Math.max(1, ...entries.map((e) => e.count))
  const focus = entries.find((e) => e.stage === hovered) ?? entries[0]

  return (
    <div className="living-chart-panel p-5 md:p-6 h-full flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="living-chart-title">Claim flow</h2>
          <p className="crx-sub">Stages light up as volume shifts</p>
        </div>
        <div className="text-right">
          <p className="text-2xs uppercase tracking-wider" style={{ color: 'var(--crx-t3)' }}>
            Recovered 7d
          </p>
          <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--crx-green)' }}>
            {new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(
              revenueWeekCents / 100,
            )}
          </p>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="crx-sub text-center py-12">No claims in pipeline yet.</p>
      ) : (
        <>
          <div className="living-flow-track mb-4">
            {entries.map((e, i) => {
              const h = 24 + (e.count / max) * 120
              const active = !hovered || hovered === e.stage
              return (
                <button
                  key={e.stage}
                  type="button"
                  className="living-flow-col"
                  style={{ animationDelay: `${i * 80}ms` }}
                  onMouseEnter={() => setHovered(e.stage)}
                  onFocus={() => setHovered(e.stage)}
                  onMouseLeave={() => setHovered(null)}
                  onBlur={() => setHovered(null)}
                  aria-label={`${e.label} ${e.count} claims`}
                >
                  <div
                    className="living-flow-bar"
                    style={{
                      height: h,
                      background: `linear-gradient(180deg, ${e.color} 0%, color-mix(in srgb, ${e.color} 40%, transparent) 100%)`,
                      opacity: active ? 1 : 0.25,
                      boxShadow: hovered === e.stage ? `0 0 28px ${e.color}66` : undefined,
                    }}
                  />
                  <span className="living-flow-count">{e.count}</span>
                  <span className="living-flow-label">{e.label}</span>
                </button>
              )
            })}
          </div>

          <div className="living-flow-detail mt-auto">
            {focus && (
              <>
                <p className="text-xs font-semibold" style={{ color: 'var(--crx-t0)' }}>
                  {focus.label}
                </p>
                <p className="text-2xs mt-0.5" style={{ color: 'var(--crx-t2)' }}>
                  {focus.count} claims · {total > 0 ? ((focus.count / total) * 100).toFixed(0) : 0}% of pipeline
                </p>
                <div className="living-flow-meter mt-2">
                  <div
                    className="living-flow-meter-fill"
                    style={{
                      width: `${total > 0 ? (focus.count / total) * 100 : 0}%`,
                      background: focus.color,
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
