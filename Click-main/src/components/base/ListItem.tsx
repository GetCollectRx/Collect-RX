import { HTMLAttributes, ReactNode } from 'react'

export interface ListItemProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode
  subtitle?: ReactNode
  /** Left slot — avatar, icon, or badge */
  leading?: ReactNode
  /** Right slot — value, badge, or action */
  trailing?: ReactNode
  /** Show a right chevron (implies item is navigable) */
  chevron?: boolean
  /** Visual urgency left-border: 'urgent' = red, 'warning' = amber */
  urgency?: 'urgent' | 'warning' | null
  disabled?: boolean
}

const urgencyBorder: Record<string, string> = {
  urgent:  'border-l-4 border-l-red-500',
  warning: 'border-l-4 border-l-amber-400',
}

export function ListItem({
  title,
  subtitle,
  leading,
  trailing,
  chevron = false,
  urgency = null,
  disabled = false,
  onClick,
  className = '',
  ...props
}: ListItemProps) {
  const isInteractive = !!onClick

  return (
    <div
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive && !disabled ? 0 : undefined}
      aria-disabled={disabled || undefined}
      onClick={!disabled ? onClick : undefined}
      onKeyDown={
        isInteractive && !disabled
          ? e => { if (e.key === 'Enter' || e.key === ' ') onClick?.(e as any) }
          : undefined
      }
      className={[
        'flex items-center gap-3 px-4 py-3 bg-white',
        urgency ? urgencyBorder[urgency] : '',
        isInteractive && !disabled
          ? 'cursor-pointer hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500'
          : '',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
        'transition-colors duration-100',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {leading && (
        <div className="shrink-0 flex items-center justify-center">{leading}</div>
      )}

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">{title}</div>
        {subtitle && (
          <div className="text-xs text-gray-500 truncate mt-0.5">{subtitle}</div>
        )}
      </div>

      {trailing && <div className="shrink-0 flex items-center">{trailing}</div>}

      {chevron && (
        <svg
          className="h-4 w-4 shrink-0 text-gray-400"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M8.22 5.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 010-1.06z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </div>
  )
}
