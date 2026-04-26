type BadgeColor = 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'gray' | 'indigo'

interface BadgeProps {
  children: React.ReactNode
  color?: BadgeColor
  dot?: boolean
  className?: string
}

const colorClasses: Record<BadgeColor, string> = {
  green:  'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  amber:  'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  red:    'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
  blue:   'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
  purple: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800',
  gray:   'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
}

const dotColors: Record<BadgeColor, string> = {
  green:  'bg-emerald-500',
  amber:  'bg-amber-500',
  red:    'bg-red-500',
  blue:   'bg-blue-500',
  purple: 'bg-purple-500',
  indigo: 'bg-indigo-500',
  gray:   'bg-gray-400',
}

export function Badge({ children, color = 'gray', dot = false, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border',
        colorClasses[color],
        className,
      ].join(' ')}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColors[color]}`}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  )
}

// ── Stage-to-badge mapping used across the app ────────────────────────────
const STAGE_COLOR: Record<string, BadgeColor> = {
  CREATED:      'blue',
  NOTIFIED:     'blue',
  REMINDER_1:   'amber',
  REMINDER_2:   'amber',
  ESCALATED:    'red',
  STAFF_REVIEW: 'purple',
  CLOSED:       'green',
  outstanding:  'red',
  partial:      'amber',
  paid:         'green',
  written_off:  'gray',
  none:         'gray',
  reminder_1:   'blue',
  reminder_2:   'indigo',
  reminder_3:   'purple',
}

export function StageBadge({ stage }: { stage: string }) {
  const color = STAGE_COLOR[stage] ?? 'gray'
  const label = stage
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
  return <Badge color={color} dot>{label}</Badge>
}
