import { Link } from 'react-router-dom'

export interface BreadcrumbItem {
  label: string
  /** If omitted, renders as the current (non-clickable) page */
  href?: string
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[]
  className?: string
}

export function Breadcrumb({ items, className = '' }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={`flex items-center ${className}`}>
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {items.map((item, i) => {
          const isLast = i === items.length - 1
          return (
            <li key={i} className="flex items-center gap-1">
              {i > 0 && (
                <svg
                  className="h-3.5 w-3.5 text-gray-400 shrink-0"
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
              {isLast || !item.href ? (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={isLast ? 'font-medium text-emerald-900' : 'text-gray-500'}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  to={item.href}
                  className={[
                    'text-gray-500 hover:text-emerald-700',
                    'focus-visible:outline-none focus-visible:underline',
                    'transition-colors duration-150',
                  ].join(' ')}
                >
                  {item.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
