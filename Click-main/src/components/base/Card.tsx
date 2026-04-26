import { HTMLAttributes, ReactNode } from 'react'

export type CardPadding = 'none' | 'sm' | 'md' | 'lg'
export type CardVariant = 'default' | 'elevated' | 'flat' | 'outlined'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding
  variant?: CardVariant
  /** Renders a hover lift effect; also sets role=button and tabIndex */
  interactive?: boolean
  children: ReactNode
}

const paddingClasses: Record<CardPadding, string> = {
  none: '',
  sm:   'p-3',
  md:   'p-4 md:p-5',
  lg:   'p-5 md:p-6',
}

const variantClasses: Record<CardVariant, string> = {
  default:  'bg-white border border-gray-200 shadow-sm',
  elevated: 'bg-white border border-gray-200 shadow-md',
  flat:     'bg-gray-100 border border-transparent',
  outlined: 'bg-white border-2 border-emerald-200',
}

export function Card({
  padding = 'md',
  variant = 'default',
  interactive = false,
  children,
  className = '',
  onClick,
  ...props
}: CardProps) {
  const isClickable = interactive || !!onClick

  return (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={isClickable
        ? e => { if (e.key === 'Enter' || e.key === ' ') onClick?.(e as any) }
        : undefined}
      className={[
        'rounded-lg',
        variantClasses[variant],
        paddingClasses[padding],
        isClickable
          ? 'cursor-pointer transition-all duration-150 hover:shadow-md hover:-translate-y-px active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2'
          : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </div>
  )
}

/** Convenience sub-components for consistent card structure */
export function CardHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 mb-3 ${className}`}>
      {children}
    </div>
  )
}

export function CardTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={`text-sm font-semibold text-emerald-900 ${className}`}>{children}</h2>
  )
}

export function CardDivider({ className = '' }: { className?: string }) {
  return <hr className={`border-gray-200 my-3 ${className}`} />
}
