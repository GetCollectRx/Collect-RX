import type { CarrierAgingRow } from '../types/practiceSettings'

const SEGMENTS: { key: keyof Pick<CarrierAgingRow, 'current' | 'days31to60' | 'days61to90' | 'days90plus'>; label: string; color: string }[] = [
  { key: 'current', label: 'Current', color: '#12C96D' },
  { key: 'days31to60', label: '31–60', color: '#F0B429' },
  { key: 'days61to90', label: '61–90', color: '#5C9AFF' },
  { key: 'days90plus', label: '90+', color: '#FF5C5C' },
]

function fmtShort(cents: number): string {
  if (cents >= 1_000_000) return `$${(cents / 100_000).toFixed(1)}k`
  if (cents >= 100_000) return `$${Math.round(cents / 100)}`
  return `$${(cents / 100).toFixed(0)}`
}

type Props = {
  rows: CarrierAgingRow[]
  maxBars?: number
}

export function AgingStackedBarChart({ rows, maxBars = 8 }: Props) {
  const top = [...rows].sort((a, b) => b.total - a.total).slice(0, maxBars)
  const maxTotal = Math.max(1, ...top.map((r) => r.total))
  const barW = 44
  const gap = 18
  const chartH = 160
  const padL = 8
  const padB = 52
  const width = padL + top.length * (barW + gap) + 8

  return (
    <div className="crx-panel crx-panel-accent p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--crx-t0)]" style={{ fontFamily: 'var(--crx-fd)' }}>
            A/R by carrier (stacked)
          </h3>
          <p className="crx-sub mt-0.5">Top carriers by open balance</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {SEGMENTS.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-2xs" style={{ color: 'var(--crx-t2)' }}>
              <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${chartH + padB}`}
        className="w-full max-h-[220px]"
        role="img"
        aria-label="Stacked bar chart of aging by carrier"
      >
        {top.map((row, i) => {
          const x = padL + i * (barW + gap)
          let yAcc = chartH
          const segments = SEGMENTS.map((seg) => {
            const val = row[seg.key]
            const h = (val / maxTotal) * chartH
            yAcc -= h
            return { ...seg, val, h, y: yAcc }
          }).filter((s) => s.h > 0.5)
          return (
            <g key={row.carrierId}>
              {segments.map((s) => (
                <rect
                  key={s.key}
                  x={x}
                  y={s.y}
                  width={barW}
                  height={s.h}
                  fill={s.color}
                  rx={2}
                  opacity={0.92}
                >
                  <title>{`${row.carrierName} — ${s.label}: ${fmtShort(s.val)}`}</title>
                </rect>
              ))}
              <text
                x={x + barW / 2}
                y={chartH + 16}
                textAnchor="middle"
                fill="var(--crx-t3)"
                fontSize="9"
                fontFamily="var(--crx-fn)"
              >
                {row.carrierName.length > 10 ? `${row.carrierName.slice(0, 9)}…` : row.carrierName}
              </text>
              <text
                x={x + barW / 2}
                y={chartH + 30}
                textAnchor="middle"
                fill="var(--crx-t2)"
                fontSize="8"
                fontFamily="var(--crx-fm)"
              >
                {fmtShort(row.total)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
