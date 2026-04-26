import { ReactNode } from 'react'

export interface HeaderProps {
  title: string
  subtitle?: string
  /** Slot rendered to the left of the title (back button, logo, etc.) */
  leading?: ReactNode
  /** Slot rendered to the right (actions, avatar, etc.) */
  trailing?: ReactNode
  /** Stick to the top of the viewport */
  sticky?: boolean
  /** Visual border below header */
  bordered?: boolean
  className?: string
}

export function Header({
  title,
  subtitle,
  leading,
  trailing,
  sticky = true,
  bordered = true,
  className = '',
}: HeaderProps) {
  return (
    <header
      className={[
        'flex items-center gap-3 px-4 bg-white',
        'h-14 md:h-16',
        sticky ? 'sticky top-0 z-40' : '',
        bordered ? 'border-b border-gray-200' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {leading && <div className="shrink-0">{leading}</div>}

      <div className="flex-1 min-w-0">
        <h1 className="text-base md:text-lg font-semibold text-emerald-900 leading-tight truncate">
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs text-gray-500 truncate">{subtitle}</p>
        )}
      </div>

      {trailing && (
        <div className="shrink-0 flex items-center gap-2">{trailing}</div>
      )}
    </header>
  )
}

/** Back-arrow button for use in Header's `leading` slot */
export function BackButton({ onClick, label = 'Go back' }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={[
        'flex items-center justify-center h-9 w-9 rounded-full',
        'text-gray-600 hover:bg-gray-100 active:bg-gray-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
        'transition-colors duration-150',
      ].join(' ')}
    >
      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  )
}
