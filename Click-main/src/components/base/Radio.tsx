import { forwardRef, InputHTMLAttributes, useId } from 'react'

export interface RadioOption {
  value: string
  label: string
  hint?: string
  disabled?: boolean
}

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string
  hint?: string
  error?: string
}

/** Single radio input — compose with RadioGroup for sets */
export const Radio = forwardRef<HTMLInputElement, RadioProps>(
  ({ label, hint, error, disabled, id: idProp, className = '', ...props }, ref) => {
    const generatedId = useId()
    const id = idProp ?? generatedId
    const errorId = `${id}-error`
    const hintId = `${id}-hint`

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
            ref={ref}
            id={id}
            type="radio"
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={
              [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined
            }
            className={[
              'mt-0.5 h-4 w-4 shrink-0 border border-gray-300 text-emerald-500',
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

Radio.displayName = 'Radio'

export interface RadioGroupProps {
  legend: string
  name: string
  options: RadioOption[]
  value?: string
  onChange?: (value: string) => void
  error?: string
  disabled?: boolean
  className?: string
}

/** Accessible fieldset/legend wrapper for a set of radio buttons */
export function RadioGroup({
  legend,
  name,
  options,
  value,
  onChange,
  error,
  disabled,
  className = '',
}: RadioGroupProps) {
  const errorId = `${name}-error`

  return (
    <fieldset className={`border-0 p-0 m-0 ${className}`} aria-describedby={error ? errorId : undefined}>
      <legend className="text-sm font-semibold text-gray-800 mb-2">{legend}</legend>
      <div className="flex flex-col gap-2">
        {options.map(opt => (
          <Radio
            key={opt.value}
            name={name}
            value={opt.value}
            label={opt.label}
            hint={opt.hint}
            checked={value === opt.value}
            disabled={disabled || opt.disabled}
            onChange={() => onChange?.(opt.value)}
          />
        ))}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </fieldset>
  )
}
