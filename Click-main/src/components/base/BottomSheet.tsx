import { ReactNode, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title?: string
  /** Height of the sheet. 'auto' fits content, 'half' = 50vh, 'full' = 90vh */
  height?: 'auto' | 'half' | 'full'
  children: ReactNode
  footer?: ReactNode
}

const heightClasses: Record<string, string> = {
  auto: 'max-h-[90vh]',
  half: 'h-[50vh]',
  full: 'h-[90vh]',
}

export function BottomSheet({
  open,
  onClose,
  title,
  height = 'auto',
  children,
  footer,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement
    document.body.style.overflow = 'hidden'
    const frame = requestAnimationFrame(() => sheetRef.current?.focus())

    return () => {
      cancelAnimationFrame(frame)
      document.body.style.overflow = ''
      previousFocusRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col justify-end" aria-modal="true" role="dialog">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-gray-900/50 animate-fade-in"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        tabIndex={-1}
        className={[
          'relative w-full bg-white rounded-t-2xl shadow-lg flex flex-col',
          'focus-visible:outline-none',
          heightClasses[height],
          // Slide up animation via translate
          'translate-y-0 transition-transform duration-300',
        ].join(' ')}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-gray-300" aria-hidden="true" />
        </div>

        {/* Header */}
        {title && (
          <div className="flex items-center justify-between gap-4 px-5 pb-3 shrink-0">
            <h2 className="text-base font-semibold text-emerald-900">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className={[
                'flex items-center justify-center h-8 w-8 rounded-full',
                'text-gray-400 hover:bg-gray-100',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
                'transition-colors duration-150',
              ].join(' ')}
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="shrink-0 px-5 pb-6 pt-3 border-t border-gray-200">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  )
}
