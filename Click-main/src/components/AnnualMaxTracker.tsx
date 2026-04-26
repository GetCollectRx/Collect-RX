import { useMemo } from 'react'

interface AnnualMaxTrackerProps {
  annualMax?: number | null
  annualMaxUsed?: number | null
  pendingClaims?: number
  planYearEnd?: string | null
  staleFlag?: boolean
}

function fmtCurrency(v: number | null | undefined): string {
  return v != null
    ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v)
    : '$0.00'
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const end = new Date(dateStr + 'T00:00:00')
  const now = new Date()
  const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  return diff > 0 ? diff : 0
}

export default function AnnualMaxTracker({
  annualMax = 0,
  annualMaxUsed = 0,
  pendingClaims = 0,
  planYearEnd = null,
  staleFlag = false,
}: AnnualMaxTrackerProps) {
  const max = annualMax || 0
  const used = annualMaxUsed || 0
  const pending = pendingClaims || 0

  const remaining = Math.max(0, max - used - pending)
  const usedPct = max > 0 ? Math.min(100, (used / max) * 100) : 0
  const pendingPct = max > 0 ? Math.min(100 - usedPct, (pending / max) * 100) : 0

  const daysLeft = useMemo(() => daysUntil(planYearEnd), [planYearEnd])

  const usageLevel = usedPct + pendingPct
  const barColor = usageLevel >= 90 ? '#EF4444' : usageLevel >= 70 ? '#F59E0B' : '#10B981'

  return (
    <div className="benefits-card" role="region" aria-label="Annual maximum tracker">
      {/* Header */}
      <div className="benefits-header">
        <div>
          <h3 className="benefits-label">Annual Maximum</h3>
          {staleFlag && (
            <span className="benefits-stale-badge">Data may be outdated</span>
          )}
        </div>
        {daysLeft !== null && (
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: '0.6875rem', color: 'var(--gray-400)', textTransform: 'uppercase' }}>Plan year ends</p>
            <p style={{
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: daysLeft <= 30 ? '#D97706' : 'var(--gray-600)',
            }}>
              {daysLeft} day{daysLeft !== 1 ? 's' : ''} left
            </p>
          </div>
        )}
      </div>

      {/* Main amount display */}
      <div className="benefits-amount">
        <span className="benefits-amount-value">{fmtCurrency(remaining)}</span>
        <span className="benefits-amount-sub">remaining of {fmtCurrency(max)}</span>
      </div>

      {/* Progress bar */}
      <div className="benefits-progress" role="progressbar" aria-valuenow={usedPct + pendingPct} aria-valuemin={0} aria-valuemax={100} aria-label={`${fmtCurrency(remaining)} remaining of ${fmtCurrency(max)} annual maximum`}>
        <div className="benefits-progress-inner">
          {usedPct > 0 && (
            <div
              className="benefits-progress-used"
              style={{ width: `${usedPct}%`, background: barColor }}
              title={`Used: ${fmtCurrency(used)}`}
            />
          )}
          {pendingPct > 0 && (
            <div
              className="benefits-progress-pending"
              style={{ width: `${pendingPct}%` }}
              title={`Pending: ${fmtCurrency(pending)}`}
            />
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="benefits-legend">
        <div className="benefits-legend-item">
          <span className="benefits-legend-dot" style={{ background: barColor }} />
          <span style={{ color: 'var(--gray-600)' }}>Used: {fmtCurrency(used)}</span>
        </div>
        {pending > 0 && (
          <div className="benefits-legend-item">
            <span className="benefits-legend-dot" style={{ background: '#FBBF24' }} />
            <span style={{ color: 'var(--gray-600)' }}>Pending: {fmtCurrency(pending)}</span>
          </div>
        )}
        <div className="benefits-legend-item">
          <span className="benefits-legend-dot" style={{ background: 'var(--gray-100)', border: '1px solid var(--gray-200)' }} />
          <span style={{ color: 'var(--gray-600)' }}>Remaining: {fmtCurrency(remaining)}</span>
        </div>
      </div>

      {/* Warnings */}
      {usageLevel >= 90 && (
        <div className="benefits-warning benefits-warning-red" role="alert">
          {usageLevel >= 100
            ? 'Annual maximum has been reached. Additional treatment will be patient responsibility.'
            : 'Annual maximum is nearly exhausted. Consider treatment timing.'}
        </div>
      )}
    </div>
  )
}
