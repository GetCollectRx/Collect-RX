import { InputHTMLAttributes, SelectHTMLAttributes, forwardRef } from 'react'

// ── Text / number input ───────────────────────────────────────────────────
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  leading?: React.ReactNode
}

const baseInput = [
  'w-full rounded-lg border border-gray-200 bg-white text-sm text-gray-900 px-3 py-2',
  'placeholder:text-gray-400',
  'focus:outline-none focus:ring-2 focus:ring-crx-500 focus:border-crx-500',
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50',
  'dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 dark:placeholder:text-gray-600',
  'dark:focus:ring-crx-400 dark:focus:border-crx-400',
  'transition-colors duration-150',
].join(' ')

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, leading, className = '', id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="space-y-1">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {leading && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" aria-hidden="true">
              {leading}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={[
              baseInput,
              leading && 'pl-8',
              error && 'border-red-400 focus:ring-red-400 dark:border-red-500',
              className,
            ].filter(Boolean).join(' ')}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            {...props}
          />
        </div>
        {error && (
          <p id={`${inputId}-error`} className="text-xs text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={`${inputId}-hint`} className="text-xs text-gray-400">
            {hint}
          </p>
        )}
      </div>
    )
  }
)
Input.displayName = 'Input'

// ── Select ────────────────────────────────────────────────────────────────
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, className = '', id, children, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="space-y-1">
        {label && (
          <label
            htmlFor={selectId}
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={[
            baseInput,
            'appearance-none pr-8 cursor-pointer',
            'bg-[url(\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="%236b7280"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>\')] bg-no-repeat bg-[right_0.5rem_center] bg-[length:1.25rem]',
            error && 'border-red-400 focus:ring-red-400',
            className,
          ].filter(Boolean).join(' ')}
          aria-invalid={!!error}
          {...props}
        >
          {children}
        </select>
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>
        )}
      </div>
    )
  }
)
Select.displayName = 'Select'
