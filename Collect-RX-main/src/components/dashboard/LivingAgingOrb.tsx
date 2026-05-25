import { useMemo, useState } from 'react'

type Segment = {
  id: string
  label: string
  amount: number
  color: string
  pct: number
}

function fmtCurrency(amount: number, unit: 'dollars' | 'cents') {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(unit === 'cents' ? amount / 100 : amount)
}

function polar(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(cx: number, cy: number, r: number, start: number, end: number) {
  const s = polar(cx, cy, r, end)
  const e = polar(cx, cy, r, start)
  const large = end - start > 180 ? 1 : 0
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`
}

type Props = {
  segments: Segment[]
  totalAmount: number
  /** Dashboard stats use dollars; report APIs use cents */
  amountUnit?: 'dollars' | 'cents'
}

export function LivingAgingOrb({ segments, totalAmount, amountUnit = 'dollars' }: Props) {
  const [active, setActive] = useState<string | null>(null)
  const cx = 120
  const cy = 120
  const r = 88
  const stroke = 26

  const arcs = useMemo(() => {
    let angle = 0
    return segments
      .filter((s) => s.pct > 0.5)
      .map((s) => {
        const sweep = (s.pct / 100) * 360
        const start = angle
        angle += sweep
        return { ...s, start, end: angle, path: arcPath(cx, cy, r, start, angle) }
      })
  }, [segments])

  const focus = segments.find((s) => s.id === active) ?? segments[0]

  return (
    <div className="living-chart-panel p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="living-chart-title">A/R aging pulse</h2>
          <p className="crx-sub">Hover a band — click to lock focus</p>
        </div>
        <span className="living-live-chip">Interactive</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_200px] gap-6 items-center">
        <div className="relative mx-auto w-full max-w-[280px] aspect-square">
          <div className="living-orb-glow" aria-hidden />
          <svg viewBox="0 0 240 240" className="w-full h-full living-orb-svg">
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--crx-bg4)" strokeWidth={stroke} opacity={0.5} />
            {arcs.map((a, i) => {
              const isOn = active === null || active === a.id
              return (
                <path
                  key={a.id}
                  d={a.path}
                  fill="none"
                  stroke={a.color}
                  strokeWidth={active === a.id ? stroke + 6 : stroke}
                  strokeLinecap="round"
                  className="living-arc"
                  style={{
                    opacity: isOn ? 1 : 0.22,
                    filter: active === a.id ? `drop-shadow(0 0 12px ${a.color})` : undefined,
                    animationDelay: `${i * 120}ms`,
                  }}
                  onMouseEnter={() => setActive(a.id)}
                  onFocus={() => setActive(a.id)}
                  onClick={() => setActive((prev) => (prev === a.id ? null : a.id))}
                  tabIndex={0}
                  role="button"
                  aria-label={`${a.label} ${a.pct.toFixed(0)} percent`}
                />
              )
            })}
          </svg>
          <div className="living-orb-center">
            <p className="text-2xs uppercase tracking-widest" style={{ color: 'var(--crx-t3)' }}>
              {focus?.label ?? 'Total'}
            </p>
            <p className="text-xl font-bold tabular-nums" style={{ fontFamily: 'var(--crx-fd)', color: 'var(--crx-t0)' }}>
              {fmtCurrency(focus?.amount ?? totalAmount, amountUnit)}
            </p>
            <p className="text-xs" style={{ color: 'var(--crx-t2)' }}>
              {(focus?.pct ?? 100).toFixed(0)}% of open A/R
            </p>
          </div>
        </div>

        <ul className="space-y-2">
          {segments.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={`living-legend-btn w-full ${active === s.id ? 'is-active' : ''}`}
                onMouseEnter={() => setActive(s.id)}
                onFocus={() => setActive(s.id)}
                onClick={() => setActive((prev) => (prev === s.id ? null : s.id))}
              >
                <span className="living-legend-swatch" style={{ background: s.color }} />
                <span className="flex-1 text-left">
                  <span className="block text-xs font-medium" style={{ color: 'var(--crx-t1)' }}>
                    {s.label}
                  </span>
                  <span className="block text-2xs" style={{ color: 'var(--crx-t3)' }}>
                    {fmtCurrency(s.amount, amountUnit)}
                  </span>
                </span>
                <span className="text-sm font-bold tabular-nums" style={{ color: s.color }}>
                  {s.pct.toFixed(0)}%
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
