import { forwardRef, ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  fullWidth?: boolean
  leftIcon?: ReactNode
  rightIcon?: ReactNode
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-emerald-500 text-white border border-emerald-500 hover:bg-emerald-600 hover:border-emerald-600 active:bg-emerald-700 active:scale-[0.98] focus-visible:ring-emerald-500',
  secondary:
    'bg-white text-emerald-700 border border-emerald-500 hover:bg-emerald-50 active:bg-emerald-100 active:scale-[0.98] focus-visible:ring-emerald-500',
  danger:
    'bg-red-600 text-white border border-red-600 hover:bg-red-700 hover:border-red-700 active:bg-red-800 active:scale-[0.98] focus-visible:ring-red-500',
  success:
    'bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 active:scale-[0.98] focus-visible:ring-emerald-500',
  ghost:
    'bg-transparent text-gray-600 border border-transparent hover:bg-gray-100 active:bg-gray-200 active:scale-[0.98] focus-visible:ring-gray-400',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      fullWidth = false,
      leftIcon,
      rightIcon,
      disabled,
      children,
      className = '',
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || loading

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading}
        className={[
          // Base
          'inline-flex items-center justify-center rounded font-medium',
          'transition-all duration-150 cursor-pointer select-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
          // Disabled
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
          // Variant + size
          variantClasses[variant],
          sizeClasses[size],
          fullWidth ? 'w-full' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...props}
      >
        {loading ? (
          <Spinner size={size} />
        ) : leftIcon ? (
          <span className="shrink-0">{leftIcon}</span>
        ) : null}
        {children && <span>{children}</span>}
        {!loading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
      </button>
    )
  },
)

Button.displayName = 'Button'

function Spinner({ size }: { size: ButtonSize }) {
  const sz = size === 'sm' ? 'w-3 h-3' : size === 'lg' ? 'w-5 h-5' : 'w-4 h-4'
  return (
    <svg
      className={`${sz} animate-spin`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}
