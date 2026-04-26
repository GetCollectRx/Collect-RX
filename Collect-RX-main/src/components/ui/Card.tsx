import { HTMLAttributes, forwardRef } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg'
  hover?: boolean
}

const paddingClasses = {
  none: '',
  sm:   'p-4',
  md:   'p-5',
  lg:   'p-6',
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ padding = 'md', hover = false, className = '', children, ...props }, ref) => (
    <div
      ref={ref}
      className={[
        'bg-white rounded-xl border border-gray-100 shadow-card',
        'dark:bg-gray-800 dark:border-gray-700',
        hover && 'transition-shadow duration-150 hover:shadow-card-hover cursor-pointer',
        paddingClasses[padding],
        className,
      ].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </div>
  )
)
Card.displayName = 'Card'

// ── Card sub-components ───────────────────────────────────────────────────
export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between mb-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        {subtitle && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
        )}
      </div>
      {action && <div className="ml-4 flex-shrink-0">{action}</div>}
    </div>
  )
}

export function Divider({ className = '' }: { className?: string }) {
  return <hr className={`border-gray-100 dark:border-gray-700 ${className}`} />
}
