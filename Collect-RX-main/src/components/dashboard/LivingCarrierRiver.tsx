import { useMemo, useState } from 'react'
import type { CarrierAgingRow } from '../../types/practiceSettings'

const SEGMENTS = [
  { key: 'current' as const, label: 'Current', color: '#12C96D' },
  { key: 'days31to60' as const, label: '31–60', color: '#F0B429' },
  { key: 'days61to90' as const, label: '61–90', color: '#5C9AFF' },
  { key: 'days90plus' as const, label: '90+', color: '#FF5C5C' },
]

function fmt(cents: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(
    cents / 100,
  )
}

type Props = {
  rows: CarrierAgingRow[]
  maxRows?: number
}

export function LivingCarrierRiver({ rows, maxRows = 8 }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const top = useMemo(() => [...rows].sort((a, b) => b.total - a.total).slice(0, maxRows), [rows, maxRows])
  const maxTotal = Math.max(1, ...top.map((r) => r.total))
  const focus = top.find((r) => r.carrierId === activeId) ?? top[0]

  return (
    <div className="living-chart-panel p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="living-chart-title">Carrier river</h3>
          <p className="crx-sub">Hover or tap a row to expand the breakdown</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {SEGMENTS.map((s) => (
            <span key={s.key} className="flex items-center gap-1 text-2xs" style={{ color: 'var(--crx-t3)' }}>
              <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {focus && (
        <div className="living-river-focus mb-4">
          <p className="text-sm font-semibold" style={{ color: 'var(--crx-t0)' }}>
            {focus.carrierName}
          </p>
          <p className="text-lg font-bold tabular-nums" style={{ fontFamily: 'var(--crx-fd)', color: 'var(--crx-green)' }}>
            {fmt(focus.total)}
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {top.map((row, i) => {
          const isActive = activeId === row.carrierId
          const widthPct = (row.total / maxTotal) * 100
          return (
            <li key={row.carrierId}>
              <button
                type="button"
                className={`living-river-row w-full text-left ${isActive ? 'is-active' : ''}`}
                style={{ animationDelay: `${i * 60}ms` }}
                onMouseEnter={() => setActiveId(row.carrierId)}
                onFocus={() => setActiveId(row.carrierId)}
                onClick={() => setActiveId((id) => (id === row.carrierId ? null : row.carrierId))}
              >
                <div className="flex justify-between items-baseline mb-1.5 gap-2">
                  <span className="text-xs font-medium truncate" style={{ color: 'var(--crx-t1)' }}>
                    {row.carrierName}
                  </span>
                  <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: 'var(--crx-t0)' }}>
                    {fmt(row.total)}
                  </span>
                </div>
                <div className="living-river-track">
                  <div
                    className="living-river-fill"
                    style={{ width: `${Math.max(4, widthPct)}%` }}
                  >
                    {SEGMENTS.map((seg) => {
                      const val = row[seg.key]
                      const segPct = row.total > 0 ? (val / row.total) * 100 : 0
                      if (segPct < 0.5) return null
                      return (
                        <span
                          key={seg.key}
                          className="living-river-seg"
                          style={{
                            width: `${segPct}%`,
                            background: seg.color,
                            opacity: isActive ? 1 : 0.85,
                          }}
                          title={`${seg.label}: ${fmt(val)}`}
                        />
                      )
                    })}
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
