import { forwardRef, SelectHTMLAttributes, useId } from 'react'
import { Label } from './Label'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectGroup {
  label: string
  options: SelectOption[]
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  hint?: string
  options?: SelectOption[]
  groups?: SelectGroup[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    { label, error, hint, options, groups, placeholder, disabled, id: idProp, className = '', required, ...props },
    ref,
  ) => {
    const generatedId = useId()
    const id = idProp ?? generatedId
    const hintId = `${id}-hint`
    const errorId = `${id}-error`

    const selectClasses = [
      'w-full appearance-none rounded border bg-white text-sm text-gray-800',
      'px-3 pr-9 py-2 h-10',
      'transition-colors duration-150',
      'focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-0 focus:border-emerald-500',
      error
        ? 'border-red-400 bg-red-50 focus:ring-red-400 focus:border-red-400'
        : 'border-gray-300 hover:border-gray-400',
      disabled ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'cursor-pointer',
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
          <select
            ref={ref}
            id={id}
            disabled={disabled}
            required={required}
            aria-invalid={!!error}
            aria-describedby={
              [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined
            }
            className={selectClasses}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options?.map(o => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
            {groups?.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map(o => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          {/* Custom chevron */}
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400">
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </div>
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

Select.displayName = 'Select'
