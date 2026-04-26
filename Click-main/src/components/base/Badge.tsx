import { HTMLAttributes, ReactNode } from 'react'

export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral'
export type BadgeSize = 'sm' | 'md'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  size?: BadgeSize
  dot?: boolean
  children: ReactNode
}

const variantClasses: Record<BadgeVariant, string> = {
  success: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  warning: 'bg-amber-100 text-amber-800 ring-amber-200',
  error:   'bg-red-100   text-red-800   ring-red-200',
  info:    'bg-blue-100  text-blue-800  ring-blue-200',
  neutral: 'bg-gray-100  text-gray-700  ring-gray-200',
}

const dotClasses: Record<BadgeVariant, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error:   'bg-red-500',
  info:    'bg-blue-500',
  neutral: 'bg-gray-400',
}

const sizeClasses: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-0.5 text-xs gap-1',
  md: 'px-2   py-1   text-xs gap-1.5',
}

export function Badge({
  variant = 'neutral',
  size = 'md',
  dot = false,
  children,
  className = '',
  ...props
}: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center font-medium rounded-full ring-1 ring-inset',
        variantClasses[variant],
        sizeClasses[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {dot && (
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClasses[variant]}`}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  )
}
