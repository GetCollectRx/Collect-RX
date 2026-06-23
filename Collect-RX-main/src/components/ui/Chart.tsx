/**
 * CollectRx, Native SVG chart components
 * No external dependency, pure React + SVG.
 * Install recharts (npm install recharts) and swap these out when ready.
 */

import { useState } from 'react'

// ── Shared helpers ────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function fmt(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}k`
  return `$${v.toFixed(0)}`
}

// ── Bar chart ─────────────────────────────────────────────────────────────
export interface BarDatum {
  label: string
  value: number
  color?: string
}

interface BarChartProps {
  data: BarDatum[]
  height?: number
  valueFormatter?: (v: number) => string
  ariaLabel?: string
}

export function BarChart({
  data,
  height = 160,
  valueFormatter = fmt,
  ariaLabel = 'Bar chart',
}: BarChartProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  const max = Math.max(...data.map(d => d.value), 1)

  return (
    <figure aria-label={ariaLabel} role="img" className="w-full select-none">
      <div
        className="flex items-end gap-2 w-full"
        style={{ height }}
      >
        {data.map((d, i) => {
          const pct = (d.value / max) * 100
          const isHovered = hovered === i
          const color = d.color ?? '#0F6E56'
          return (
            <div
              key={i}
              className="flex flex-col items-center flex-1 h-full justify-end gap-1.5 group"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              role="img"
              aria-label={`${d.label}: ${valueFormatter(d.value)}`}
            >
              {/* Tooltip */}
              {isHovered && (
                <div className="chart-tooltip text-xs py-1 px-2 rounded-md bg-gray-900 dark:bg-white text-white dark:text-gray-900 mb-1 whitespace-nowrap z-10">
                  <span className="font-semibold">{d.label}</span>
                  <br />
                  {valueFormatter(d.value)}
                </div>
              )}
              {/* Bar */}
              <div
                className="chart-bar w-full rounded-t-md transition-all duration-200"
                style={{
                  height: `${pct}%`,
                  backgroundColor: color,
                  opacity: hovered !== null && !isHovered ? 0.45 : 1,
                  minHeight: d.value > 0 ? 4 : 0,
                }}
              />
            </div>
          )
        })}
      </div>
      {/* X-axis labels */}
      <div className="flex gap-2 mt-2">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center text-2xs text-gray-400 dark:text-gray-500 truncate px-0.5">
            {d.label}
          </div>
        ))}
      </div>
      <figcaption className="sr-only">{ariaLabel}</figcaption>
    </figure>
  )
}

// ── Mini sparkline ────────────────────────────────────────────────────────
interface SparklineProps {
  data: number[]
  color?: string
  height?: number
  width?: number
}

export function Sparkline({ data, color = '#0F6E56', height = 32, width = 80 }: SparklineProps) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * height
    return `${x},${y}`
  })
  return (
    <svg width={width} height={height} aria-hidden="true" className="overflow-visible">
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── Donut / ring ──────────────────────────────────────────────────────────
interface DonutProps {
  value: number     // 0–100
  size?: number
  color?: string
  trackColor?: string
  label?: string
}

export function Donut({ value, size = 56, color = '#0F6E56', trackColor = '#e5e7eb', label }: DonutProps) {
  const r = (size - 6) / 2
  const circ = 2 * Math.PI * r
  const dash = clamp(value, 0, 100) / 100 * circ

  return (
    <figure className="inline-flex flex-col items-center gap-1" aria-label={label ?? `${value}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={trackColor} strokeWidth={6} />
        <circle
          cx={size/2} cy={size/2} r={r}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{ transition: 'stroke-dasharray 0.5s ease' }}
        />
        <text
          x="50%" y="50%"
          textAnchor="middle" dominantBaseline="central"
          fontSize={size * 0.22} fontWeight="700"
          fill="currentColor"
          className="text-gray-800 dark:text-gray-200"
        >
          {Math.round(value)}%
        </text>
      </svg>
      {label && <span className="text-2xs text-gray-500 dark:text-gray-400 text-center leading-tight">{label}</span>}
    </figure>
  )
}

// ── Horizontal progress bar ───────────────────────────────────────────────
interface ProgressBarProps {
  value: number       // 0–100
  label?: string
  amount?: string
  color?: string
  height?: number
}

export function ProgressBar({ value, label, amount, color = '#0F6E56', height = 8 }: ProgressBarProps) {
  const pct = clamp(value, 0, 100)
  return (
    <div>
      {(label || amount) && (
        <div className="flex justify-between items-baseline mb-1.5">
          {label && <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>}
          {amount && <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{amount}</span>}
        </div>
      )}
      <div
        className="w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden"
        style={{ height }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="progress-bar h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

// ── Line chart ────────────────────────────────────────────────────────────
export interface LineDatum {
  label: string
  value: number
}

interface LineChartProps {
  data: LineDatum[]
  height?: number
  color?: string
  ariaLabel?: string
  valueFormatter?: (v: number) => string
}

export function LineChart({
  data,
  height = 120,
  color = '#0F6E56',
  ariaLabel = 'Line chart',
  valueFormatter = fmt,
}: LineChartProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  if (data.length < 2) return null

  const W = 600
  const H = height
  const pad = { top: 8, right: 8, bottom: 24, left: 8 }
  const innerW = W - pad.left - pad.right
  const innerH = H - pad.top - pad.bottom

  const max = Math.max(...data.map(d => d.value), 1)
  const min = Math.min(...data.map(d => d.value), 0)
  const range = max - min || 1

  function x(i: number) { return pad.left + (i / (data.length - 1)) * innerW }
  function y(v: number) { return pad.top + (1 - (v - min) / range) * innerH }

  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ')
  const area = [
    `M${x(0)},${y(data[0].value)}`,
    ...data.slice(1).map((d, i) => `L${x(i+1)},${y(d.value)}`),
    `L${x(data.length-1)},${H - pad.bottom}`,
    `L${x(0)},${H - pad.bottom}Z`,
  ].join(' ')

  return (
    <figure aria-label={ariaLabel} role="img" className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full overflow-visible"
        style={{ height }}
        onMouseLeave={() => setHovered(null)}
      >
        {/* Area fill */}
        <path d={area} fill={color} fillOpacity="0.08" />
        {/* Line */}
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Points + hit areas */}
        {data.map((d, i) => (
          <g key={i}>
            <circle
              cx={x(i)} cy={y(d.value)} r="12"
              fill="transparent"
              onMouseEnter={() => setHovered(i)}
              style={{ cursor: 'crosshair' }}
            />
            {hovered === i && (
              <>
                <line
                  x1={x(i)} y1={pad.top}
                  x2={x(i)} y2={H - pad.bottom}
                  stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.4"
                />
                <circle cx={x(i)} cy={y(d.value)} r="5" fill={color} stroke="white" strokeWidth="2" />
                <rect
                  x={clamp(x(i) - 46, 0, W - 92)} y={y(d.value) - 36}
                  width={92} height={28} rx={6}
                  fill="#111827" opacity="0.9"
                />
                <text
                  x={clamp(x(i), 46, W - 46)} y={y(d.value) - 26}
                  textAnchor="middle" fill="white" fontSize={10} fontWeight={600}
                >
                  {d.label}
                </text>
                <text
                  x={clamp(x(i), 46, W - 46)} y={y(d.value) - 14}
                  textAnchor="middle" fill="white" fontSize={10}
                >
                  {valueFormatter(d.value)}
                </text>
              </>
            )}
          </g>
        ))}
        {/* X-axis labels */}
        {data.map((d, i) => (
          <text
            key={i}
            x={x(i)} y={H}
            textAnchor="middle"
            fontSize={9}
            fill="#9ca3af"
          >
            {d.label}
          </text>
        ))}
      </svg>
      <figcaption className="sr-only">{ariaLabel}</figcaption>
    </figure>
  )
}
