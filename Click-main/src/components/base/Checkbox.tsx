import { forwardRef, InputHTMLAttributes, useId } from 'react'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string
  hint?: string
  error?: string
  indeterminate?: boolean
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, hint, error, indeterminate, disabled, id: idProp, className = '', ...props }, ref) => {
    const generatedId = useId()
    const id = idProp ?? generatedId
    const errorId = `${id}-error`
    const hintId = `${id}-hint`

    // Set indeterminate imperatively (not a standard HTML attribute)
    const setRef = (el: HTMLInputElement | null) => {
      if (el) el.indeterminate = !!indeterminate
      if (typeof ref === 'function') ref(el)
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el
    }

    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        <label
          htmlFor={id}
          className={[
            'flex items-start gap-2 cursor-pointer',
            disabled ? 'cursor-not-allowed opacity-50' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <input
            ref={setRef}
            id={id}
            type="checkbox"
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={
              [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined
            }
            className={[
              'mt-0.5 h-4 w-4 shrink-0 rounded border border-gray-300 text-emerald-500',
              'cursor-pointer accent-emerald-500',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2',
              error ? 'border-red-400' : '',
              disabled ? 'cursor-not-allowed' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            {...props}
          />
          {label && (
            <span className="text-sm text-gray-800 leading-5 select-none">{label}</span>
          )}
        </label>

        {error && (
          <p id={errorId} role="alert" className="ml-6 text-xs text-red-600">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={hintId} className="ml-6 text-xs text-gray-500">
            {hint}
          </p>
        )}
      </div>
    )
  },
)

Checkbox.displayName = 'Checkbox'

// Need React for the MutableRefObject type
import React from 'react'
