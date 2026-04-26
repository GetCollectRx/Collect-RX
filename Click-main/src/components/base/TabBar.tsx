import { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'

export interface TabItem {
  to: string
  label: string
  icon: ReactNode
  /** Badge count — shown as a small red dot if > 0 */
  badge?: number
}

export interface TabBarProps {
  tabs: TabItem[]
  /** 'bottom' = fixed mobile nav, 'top' = horizontal strip (desktop sub-nav) */
  variant?: 'bottom' | 'top'
  className?: string
}

export function TabBar({ tabs, variant = 'bottom', className = '' }: TabBarProps) {
  const location = useLocation()

  if (variant === 'top') {
    return (
      <nav
        role="tablist"
        aria-label="Page sections"
        className={[
          'flex border-b border-gray-200 bg-white',
          className,
        ].join(' ')}
      >
        {tabs.map(tab => {
          const isActive = location.pathname === tab.to || location.pathname.startsWith(tab.to + '/')
          return (
            <Link
              key={tab.to}
              to={tab.to}
              role="tab"
              aria-selected={isActive}
              className={[
                'relative flex items-center gap-2 px-4 py-3 text-sm font-medium',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500',
                'transition-colors duration-150',
                isActive
                  ? 'text-emerald-700 border-b-2 border-emerald-500'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50 border-b-2 border-transparent',
              ].join(' ')}
            >
              <span className="shrink-0 h-4 w-4">{tab.icon}</span>
              {tab.label}
              {!!tab.badge && (
                <span className="ml-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>
    )
  }

  // bottom variant — mobile fixed nav
  return (
    <nav
      role="navigation"
      aria-label="Main navigation"
      className={[
        'fixed bottom-0 inset-x-0 z-40 md:hidden',
        'flex bg-white border-t border-gray-200',
        'safe-pb', // custom class for iOS safe area
        className,
      ].join(' ')}
    >
      {tabs.map(tab => {
        const isActive = location.pathname === tab.to || (tab.to !== '/' && location.pathname.startsWith(tab.to))
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={isActive ? 'page' : undefined}
            aria-label={tab.label}
            className={[
              'relative flex flex-col items-center justify-center gap-0.5',
              'flex-1 h-14 min-w-[44px] text-[10px] font-medium',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500',
              'transition-colors duration-150',
              isActive ? 'text-emerald-600' : 'text-gray-500',
            ].join(' ')}
          >
            <div className="relative h-6 w-6">
              {tab.icon}
              {!!tab.badge && (
                <span
                  aria-label={`${tab.badge} items`}
                  className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold"
                >
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
            </div>
            <span>{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
