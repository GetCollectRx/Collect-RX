import { ReactNode } from 'react'

export interface EmptyStateProps {
  /** Icon element (svg or emoji) */
  icon?: ReactNode
  title: string
  description?: string
  /** Primary CTA button */
  action?: ReactNode
  /** Secondary link or action */
  secondaryAction?: ReactNode
  /** Compact variant for inline use (no vertical padding) */
  compact?: boolean
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  compact = false,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-8 px-4' : 'py-16 px-6',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      role="status"
      aria-live="polite"
    >
      {icon && (
        <div className="mb-4 flex items-center justify-center h-14 w-14 rounded-full bg-gray-100 text-gray-400">
          {icon}
        </div>
      )}

      <h3 className="text-base font-semibold text-gray-800">{title}</h3>

      {description && (
        <p className="mt-1.5 text-sm text-gray-500 max-w-xs">{description}</p>
      )}

      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-col sm:flex-row items-center gap-3">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}

// ── Pre-built empty states for common CollectRx contexts ───────────────────────

export function NoClaims({ onImport }: { onImport?: () => void }) {
  return (
    <EmptyState
      icon={
        <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      }
      title="No claims yet"
      description="Import claims from AbelDent or create one manually to get started."
      action={
        onImport ? (
          <button
            onClick={onImport}
            className="inline-flex items-center gap-2 h-10 px-4 rounded bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors"
          >
            Import claims
          </button>
        ) : undefined
      }
    />
  )
}

export function NoResults({ onReset }: { onReset?: () => void }) {
  return (
    <EmptyState
      icon={
        <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0016.803 15.803z" />
        </svg>
      }
      title="No results"
      description="Try adjusting your search or filter criteria."
      action={
        onReset ? (
          <button
            onClick={onReset}
            className="inline-flex items-center gap-2 h-10 px-4 rounded border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Clear filters
          </button>
        ) : undefined
      }
    />
  )
}
