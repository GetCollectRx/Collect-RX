import { forwardRef, InputHTMLAttributes, ReactNode, useId } from 'react'
import { Label } from './Label'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  leftAddon?: ReactNode
  rightAddon?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, leftAddon, rightAddon, disabled, id: idProp, className = '', required, ...props }, ref) => {
    const generatedId = useId()
    const id = idProp ?? generatedId
    const hintId = `${id}-hint`
    const errorId = `${id}-error`

    const inputClasses = [
      'w-full rounded border bg-white text-sm text-gray-800 placeholder-gray-400',
      'transition-colors duration-150',
      'focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-0 focus:border-emerald-500',
      error
        ? 'border-red-400 bg-red-50 focus:ring-red-400 focus:border-red-400'
        : 'border-gray-300 hover:border-gray-400',
      disabled ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : '',
      leftAddon ? 'pl-10' : 'px-3',
      rightAddon ? 'pr-10' : 'pr-3',
      'py-2 h-10',
      className,
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <Label htmlFor={id} required={required} disabled={disabled}>
            {label}
          </Label>
        )}

        <div className="relative">
          {leftAddon && (
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
              {leftAddon}
            </div>
          )}
          <input
            ref={ref}
            id={id}
            disabled={disabled}
            required={required}
            aria-invalid={!!error}
            aria-describedby={
              [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined
            }
            className={inputClasses}
            {...props}
          />
          {rightAddon && (
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400">
              {rightAddon}
            </div>
          )}
        </div>

        {error && (
          <p id={errorId} role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={hintId} className="text-xs text-gray-500">
            {hint}
          </p>
        )}
      </div>
    )
  },
)

Input.displayName = 'Input'
