type TrendDir = 'up' | 'down' | 'neutral'

interface StatTileProps {
  label: string
  value: string | number
  sub?: string
  trend?: { value: string; dir: TrendDir }
  icon?: React.ReactNode
  accent?: 'default' | 'green' | 'amber' | 'red' | 'blue'
}

const accentBar: Record<string, string> = {
  default: 'bg-gray-200 dark:bg-gray-700',
  green:   'bg-crx-500',
  amber:   'bg-amber-400',
  red:     'bg-red-500',
  blue:    'bg-blue-500',
}

const accentValue: Record<string, string> = {
  default: 'text-gray-900 dark:text-gray-100',
  green:   'text-crx-600 dark:text-crx-400',
  amber:   'text-amber-600 dark:text-amber-400',
  red:     'text-red-600 dark:text-red-400',
  blue:    'text-blue-600 dark:text-blue-400',
}

const accentIcon: Record<string, string> = {
  default: 'bg-gray-50 text-gray-400 dark:bg-gray-700/60 dark:text-gray-400',
  green:   'bg-crx-50 text-crx-500 dark:bg-crx-900/30 dark:text-crx-400',
  amber:   'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  red:     'bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-400',
  blue:    'bg-blue-50 text-blue-500 dark:bg-blue-900/30 dark:text-blue-400',
}

const trendClasses: Record<TrendDir, string> = {
  up:      'text-crx-600 dark:text-crx-400',
  down:    'text-red-500 dark:text-red-400',
  neutral: 'text-gray-400 dark:text-gray-500',
}

const trendArrow: Record<TrendDir, string> = {
  up: '↑', down: '↓', neutral: '→',
}

export function StatTile({ label, value, sub, trend, icon, accent = 'default' }: StatTileProps) {
  return (
    <div
      className="relative bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5 shadow-card overflow-hidden flex items-start gap-4"
      role="group"
      aria-label={label}
    >
      {/* Top accent stripe */}
      <div className={`absolute top-0 left-0 right-0 h-[2.5px] ${accentBar[accent]}`} />

      {icon && (
        <div
          className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-base ${accentIcon[accent]}`}
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-2xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider truncate">
          {label}
        </p>
        <p className={`text-2xl font-bold mt-1.5 leading-none tabular-nums ${accentValue[accent]}`}>
          {value}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          {sub && (
            <span className="text-xs text-gray-400 dark:text-gray-600">{sub}</span>
          )}
          {trend && (
            <span className={`text-xs font-semibold ${trendClasses[trend.dir]}`}>
              {trendArrow[trend.dir]} {trend.value}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
