/**
 * CoverageBreakdown — Visual breakdown of coverage percentages by category
 */

interface CoverageItem {
  category: string;
  label?: string;
  coveragePct?: number;
  waitingPeriodMonths?: number | null;
  waitingPeriodStart?: string | null;
  frequencyLimitMonths?: number | null;
  lastServiceDate?: string | null;
}

interface Deductible {
  amount: number;
  met: number;
}

interface CoverageBreakdownProps {
  coverage?: CoverageItem[];
  deductible?: Deductible | null;
  onCategoryClick?: (category: string) => void;
}

const CATEGORY_ICONS: Record<string, { icon: string; color: string }> = {
  preventive:        { icon: '🦷', color: 'emerald' },
  basic_restorative: { icon: '🔧', color: 'blue' },
  major_restorative: { icon: '👑', color: 'purple' },
  endodontics:       { icon: '🔬', color: 'rose' },
  periodontics:      { icon: '🧹', color: 'teal' },
  prosthodontics:    { icon: '🦿', color: 'indigo' },
  oral_surgery:      { icon: '⚕️', color: 'red' },
  orthodontics:      { icon: '📐', color: 'orange' },
  other:             { icon: '📋', color: 'gray' },
};

const COLOR_CLASSES: Record<string, { bg: string; text: string; bar: string }> = {
  emerald: { bg: 'bg-emerald-100', text: 'text-emerald-700', bar: 'bg-emerald-500' },
  blue:    { bg: 'bg-blue-100',    text: 'text-blue-700',    bar: 'bg-blue-500' },
  purple:  { bg: 'bg-purple-100',  text: 'text-purple-700',  bar: 'bg-purple-500' },
  rose:    { bg: 'bg-rose-100',    text: 'text-rose-700',    bar: 'bg-rose-500' },
  teal:    { bg: 'bg-teal-100',    text: 'text-teal-700',    bar: 'bg-teal-500' },
  indigo:  { bg: 'bg-indigo-100',  text: 'text-indigo-700',  bar: 'bg-indigo-500' },
  red:     { bg: 'bg-red-100',     text: 'text-red-700',     bar: 'bg-red-500' },
  orange:  { bg: 'bg-orange-100',  text: 'text-orange-700',  bar: 'bg-orange-500' },
  gray:    { bg: 'bg-gray-100',    text: 'text-gray-700',    bar: 'bg-gray-500' },
};

function fmtCurrency(v: number | null | undefined): string {
  return v != null
    ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v)
    : '$0.00';
}

function WaitingPeriodBadge({ months, startDate }: { months?: number | null; startDate?: string | null }) {
  if (!months || months === 0) return null;

  const endDate = startDate ? new Date(new Date(startDate).setMonth(new Date(startDate).getMonth() + months)) : null;
  const isPast = endDate && endDate < new Date();

  if (isPast) return null;

  return (
    <span className="inline-block px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded ml-2">
      {months}mo waiting
    </span>
  );
}

function FrequencyInfo({ limitMonths, lastServiceDate }: { limitMonths?: number | null; lastServiceDate?: string | null }) {
  if (!limitMonths) return null;

  const nextEligible = lastServiceDate
    ? new Date(new Date(lastServiceDate).setMonth(new Date(lastServiceDate).getMonth() + limitMonths))
    : null;
  const isEligible = !nextEligible || nextEligible <= new Date();

  return (
    <div className="text-xs text-gray-500 mt-1">
      {isEligible ? (
        <span className="text-emerald-600">Eligible now</span>
      ) : (
        <span>Next eligible: {nextEligible.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      )}
      <span className="text-gray-400 ml-1">(every {limitMonths}mo)</span>
    </div>
  );
}

export default function CoverageBreakdown({ coverage = [], deductible = null, onCategoryClick }: CoverageBreakdownProps) {
  const sorted = [...coverage].sort((a, b) => (b.coveragePct || 0) - (a.coveragePct || 0));

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      {/* Header */}
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Coverage by Category</h3>

      {/* Deductible section */}
      {deductible && (
        <div className="mb-5 pb-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Deductible</span>
            <span className="text-sm text-gray-600">
              {fmtCurrency(deductible.met)} of {fmtCurrency(deductible.amount)} met
            </span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-500 transition-all duration-500"
              style={{ width: `${Math.min(100, ((deductible.met || 0) / (deductible.amount || 1)) * 100)}%` }}
            />
          </div>
          {deductible.met >= deductible.amount && (
            <p className="text-xs text-emerald-600 mt-1 font-medium">Deductible fully met</p>
          )}
        </div>
      )}

      {/* Coverage categories */}
      {sorted.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">
          No coverage information available
        </div>
      ) : (
        <div className="space-y-4">
          {sorted.map(item => {
            const catInfo = CATEGORY_ICONS[item.category] || CATEGORY_ICONS.other;
            const colors = COLOR_CLASSES[catInfo.color];
            const pct = item.coveragePct || 0;

            return (
              <div
                key={item.category}
                role={onCategoryClick ? 'button' : undefined}
                tabIndex={onCategoryClick ? 0 : undefined}
                className={`${onCategoryClick ? 'cursor-pointer hover:bg-gray-50' : ''} rounded-lg p-3 -mx-3 transition-colors`}
                onClick={() => onCategoryClick?.(item.category)}
                onKeyDown={
                  onCategoryClick
                    ? (ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          onCategoryClick(item.category);
                        }
                      }
                    : undefined
                }
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-8 h-8 rounded-lg ${colors.bg} flex items-center justify-center text-base`}>
                      {catInfo.icon}
                    </span>
                    <div>
                      <span className="text-sm font-medium text-gray-800">{item.label || item.category}</span>
                      <WaitingPeriodBadge months={item.waitingPeriodMonths} startDate={item.waitingPeriodStart} />
                    </div>
                  </div>
                  <span className={`text-lg font-bold ${colors.text}`}>{pct}%</span>
                </div>

                {/* Coverage bar */}
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${colors.bar} transition-all duration-500`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                {/* Frequency info */}
                <FrequencyInfo limitMonths={item.frequencyLimitMonths} lastServiceDate={item.lastServiceDate} />
              </div>
            );
          })}
        </div>
      )}

      {/* Coverage tier explanation */}
      <div className="mt-5 pt-4 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          Coverage percentages shown are after deductible. Actual reimbursement depends on UCR fees and plan limitations.
        </p>
      </div>
    </div>
  );
}
