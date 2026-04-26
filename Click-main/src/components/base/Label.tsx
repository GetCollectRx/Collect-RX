import { LabelHTMLAttributes } from 'react'

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean
  disabled?: boolean
}

export function Label({ required, disabled, children, className = '', ...props }: LabelProps) {
  return (
    <label
      className={[
        'block text-sm font-semibold',
        disabled ? 'text-gray-400' : 'text-gray-800',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
      {required && (
        <span className="ml-1 text-red-500" aria-hidden="true">
          *
        </span>
      )}
    </label>
  )
}
