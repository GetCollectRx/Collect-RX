import { HTMLAttributes } from 'react'

// ── Base skeleton pulse ────────────────────────────────────────────────────────

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'avatar' | 'rect' | 'circle'
  width?: string
  height?: string
  rounded?: boolean
}

export function Skeleton({
  variant = 'rect',
  width,
  height,
  rounded = false,
  className = '',
  style,
  ...props
}: SkeletonProps) {
  const baseClasses = 'animate-pulse bg-gray-200'

  const variantClasses: Record<string, string> = {
    text:   'h-4 rounded w-full',
    avatar: 'h-10 w-10 rounded-full',
    rect:   rounded ? 'rounded-lg' : 'rounded',
    circle: 'rounded-full',
  }

  return (
    <div
      aria-hidden="true"
      className={[baseClasses, variantClasses[variant], className].filter(Boolean).join(' ')}
      style={{ width, height, ...style }}
      {...props}
    />
  )
}

// ── Preset: card skeleton ─────────────────────────────────────────────────────

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-lg border border-gray-200 bg-white p-4 md:p-5 ${className}`}
    >
      <div className="flex items-center gap-3 mb-4">
        <Skeleton variant="avatar" />
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" width="60%" />
          <Skeleton variant="text" width="40%" height="12px" />
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton variant="text" />
        <Skeleton variant="text" width="80%" />
        <Skeleton variant="text" width="90%" />
      </div>
    </div>
  )
}

// ── Preset: list item skeleton ────────────────────────────────────────────────

export function SkeletonListItem({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`flex items-center gap-3 px-4 py-3 ${className}`}
    >
      <Skeleton variant="avatar" className="h-9 w-9" />
      <div className="flex-1 space-y-1.5">
        <Skeleton variant="text" width="55%" />
        <Skeleton variant="text" width="35%" height="12px" />
      </div>
      <Skeleton variant="rect" width="60px" height="22px" rounded />
    </div>
  )
}

// ── Preset: table row skeletons ───────────────────────────────────────────────

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div aria-hidden="true" className="w-full overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full min-w-full">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i} className="px-4 py-3">
                <Skeleton variant="text" width="70%" height="12px" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i}>
              {Array.from({ length: cols }).map((_, j) => (
                <td key={j} className="px-4 py-3">
                  <Skeleton variant="text" width={j === 0 ? '80%' : '60%'} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
