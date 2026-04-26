type TrendDir = 'up' | 'down' | 'neutral'

interface StatTileProps {
  label: string
  value: string | number
  sub?: string
  trend?: { value: string; dir: TrendDir }
  icon?: React.ReactNode
  accent?: 'default' | 'green' | 'amber' | 'red' | 'blue'
}

const accentValue: Record<string, string> = {
  default: 'text-gray-900 dark:text-gray-100',
  green:   'text-crx-500 dark:text-crx-400',
  amber:   'text-amber-600 dark:text-amber-400',
  red:     'text-red-600 dark:text-red-400',
  blue:    'text-blue-600 dark:text-blue-400',
}

const accentIcon: Record<string, string> = {
  default: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  green:   'bg-crx-50 text-crx-500 dark:bg-crx-900/40 dark:text-crx-400',
  amber:   'bg-amber-50 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400',
  red:     'bg-red-50 text-red-600 dark:bg-red-900/40 dark:text-red-400',
  blue:    'bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400',
}

const trendClasses: Record<TrendDir, string> = {
  up:      'text-crx-600 dark:text-crx-400',
  down:    'text-red-600 dark:text-red-400',
  neutral: 'text-gray-500 dark:text-gray-400',
}

const trendArrow: Record<TrendDir, string> = {
  up: '↑', down: '↓', neutral: '→',
}

export function StatTile({ label, value, sub, trend, icon, accent = 'default' }: StatTileProps) {
  return (
    <div
      className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 shadow-card flex items-start gap-4"
      role="group"
      aria-label={label}
    >
      {icon && (
        <div
          className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-lg ${accentIcon[accent]}`}
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate">
          {label}
        </p>
        <p className={`text-2xl font-bold mt-1 leading-none tabular-nums ${accentValue[accent]}`}>
          {value}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          {sub && (
            <span className="text-xs text-gray-400 dark:text-gray-500">{sub}</span>
          )}
          {trend && (
            <span className={`text-xs font-medium ${trendClasses[trend.dir]}`}>
              {trendArrow[trend.dir]} {trend.value}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
