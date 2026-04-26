export interface LoadingStateProps {
  message?: string
  /** 'page' = full viewport center, 'section' = fills parent container */
  variant?: 'page' | 'section'
  className?: string
}

export function LoadingState({
  message = 'Loading…',
  variant = 'section',
  className = '',
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={message}
      className={[
        'flex flex-col items-center justify-center gap-3 text-gray-500',
        variant === 'page' ? 'fixed inset-0 z-50 bg-white/80 backdrop-blur-sm' : 'py-16',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <svg
        className="h-8 w-8 animate-spin text-emerald-500"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <span className="text-sm font-medium">{message}</span>
    </div>
  )
}
