interface CoverageItem {
  category: string
  label?: string
  coveragePct?: number
  waitingPeriodMonths?: number | null
  waitingPeriodStart?: string | null
  frequencyLimitMonths?: number | null
  lastServiceDate?: string | null
}

interface Deductible {
  amount: number
  met: number
}

interface CoverageBreakdownProps {
  coverage?: CoverageItem[]
  deductible?: Deductible | null
  onCategoryClick?: (category: string) => void
}

const CATEGORY_ICONS: Record<string, { icon: string; color: string }> = {
  preventive:        { icon: '\u{1F9B7}', color: 'emerald' },
  basic_restorative: { icon: '\u{1F527}', color: 'blue' },
  major_restorative: { icon: '\u{1F451}', color: 'purple' },
  endodontics:       { icon: '\u{1F52C}', color: 'rose' },
  periodontics:      { icon: '\u{1F9F9}', color: 'teal' },
  prosthodontics:    { icon: '\u{1F9BF}', color: 'indigo' },
  oral_surgery:      { icon: '\u2695\uFE0F', color: 'red' },
  orthodontics:      { icon: '\u{1F4D0}', color: 'orange' },
  other:             { icon: '\u{1F4CB}', color: 'gray' },
}

function fmtCurrency(v: number | null | undefined): string {
  return v != null
    ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v)
    : '$0.00'
}

function WaitingPeriodBadge({ months, startDate }: { months?: number | null; startDate?: string | null }) {
  if (!months || months === 0) return null

  const endDate = startDate ? new Date(new Date(startDate).setMonth(new Date(startDate).getMonth() + months)) : null
  const isPast = endDate && endDate < new Date()
  if (isPast) return null

  return <span className="waiting-badge">{months}mo waiting</span>
}

function FrequencyInfo({ limitMonths, lastServiceDate }: { limitMonths?: number | null; lastServiceDate?: string | null }) {
  if (!limitMonths) return null

  const nextEligible = lastServiceDate
    ? new Date(new Date(lastServiceDate).setMonth(new Date(lastServiceDate).getMonth() + limitMonths))
    : null
  const isEligible = !nextEligible || nextEligible <= new Date()

  return (
    <div className="frequency-info">
      {isEligible ? (
        <span className="frequency-eligible">Eligible now</span>
      ) : (
        <span>Next eligible: {nextEligible!.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      )}
      <span style={{ color: 'var(--gray-400)', marginLeft: '0.25rem' }}>(every {limitMonths}mo)</span>
    </div>
  )
}

export default function CoverageBreakdown({ coverage = [], deductible = null, onCategoryClick }: CoverageBreakdownProps) {
  const sorted = [...coverage].sort((a, b) => (b.coveragePct || 0) - (a.coveragePct || 0))

  return (
    <div className="benefits-card" role="region" aria-label="Coverage breakdown by category">
      <h3 className="coverage-section-title">Coverage by Category</h3>

      {/* Deductible section */}
      {deductible && (
        <div className="coverage-deductible">
          <div className="coverage-deductible-header">
            <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--gray-800)' }}>Deductible</span>
            <span style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>
              {fmtCurrency(deductible.met)} of {fmtCurrency(deductible.amount)} met
            </span>
          </div>
          <div className="coverage-deductible-bar" role="progressbar" aria-valuenow={deductible.met} aria-valuemax={deductible.amount} aria-label="Deductible progress">
            <div
              className="coverage-deductible-fill"
              style={{ width: `${Math.min(100, ((deductible.met || 0) / (deductible.amount || 1)) * 100)}%` }}
            />
          </div>
          {deductible.met >= deductible.amount && (
            <p className="coverage-deductible-met">Deductible fully met</p>
          )}
        </div>
      )}

      {/* Coverage categories */}
      {sorted.length === 0 ? (
        <div className="empty-state" style={{ padding: '2rem 0' }}>
          <p className="empty-state-text">No coverage information available</p>
        </div>
      ) : (
        <div className="coverage-list">
          {sorted.map(item => {
            const catInfo = CATEGORY_ICONS[item.category] || CATEGORY_ICONS.other
            const pct = item.coveragePct || 0

            return (
              <div
                key={item.category}
                className={`coverage-item coverage-${catInfo.color} ${onCategoryClick ? 'coverage-item-clickable' : ''}`}
                onClick={() => onCategoryClick?.(item.category)}
              >
                <div className="coverage-item-header">
                  <div className="coverage-item-label">
                    <span className="coverage-icon" aria-hidden="true">
                      {catInfo.icon}
                    </span>
                    <div>
                      <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--gray-800)' }}>
                        {item.label || item.category}
                      </span>
                      <WaitingPeriodBadge months={item.waitingPeriodMonths} startDate={item.waitingPeriodStart} />
                    </div>
                  </div>
                  <span className="coverage-pct">{pct}%</span>
                </div>

                <div className="coverage-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${item.label || item.category}: ${pct}% coverage`}>
                  <div className="coverage-bar-fill" style={{ width: `${pct}%` }} />
                </div>

                <FrequencyInfo limitMonths={item.frequencyLimitMonths} lastServiceDate={item.lastServiceDate} />
              </div>
            )
          })}
        </div>
      )}

      <div className="coverage-footer">
        Coverage percentages shown are after deductible. Actual reimbursement depends on UCR fees and plan limitations.
      </div>
    </div>
  )
}
