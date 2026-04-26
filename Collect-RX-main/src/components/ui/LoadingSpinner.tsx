interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  label?: string
  fullPage?: boolean
}

const sizeClasses = {
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-[3px]',
}

export function LoadingSpinner({ size = 'md', label = 'Loading…', fullPage = false }: SpinnerProps) {
  const spinner = (
    <div role="status" className="flex flex-col items-center gap-3">
      <div
        className={`rounded-full border-gray-200 dark:border-gray-700 border-t-crx-500 dark:border-t-crx-400 animate-spin ${sizeClasses[size]}`}
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
      {fullPage && (
        <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      )}
    </div>
  )

  if (fullPage) {
    return (
      <div className="flex-1 flex items-center justify-center py-24">
        {spinner}
      </div>
    )
  }

  return spinner
}

// ── Skeleton row (for tables) ─────────────────────────────────────────────
export function SkeletonRow({ cols = 5 }: { cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="skeleton h-4 rounded" style={{ width: `${60 + Math.random() * 40}%` }} />
        </td>
      ))}
    </tr>
  )
}

// ── Skeleton card ─────────────────────────────────────────────────────────
export function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 shadow-card space-y-3">
      <div className="skeleton h-4 w-1/3" />
      <div className="skeleton h-8 w-1/2" />
      <div className="skeleton h-3 w-2/3" />
    </div>
  )
}
