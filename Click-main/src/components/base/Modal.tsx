import {
  ReactNode,
  useEffect,
  useRef,
  useId,
} from 'react'
import { createPortal } from 'react-dom'

export type ModalSize = 'sm' | 'md' | 'lg' | 'full'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  size?: ModalSize
  /** Prevent closing on backdrop click */
  persistent?: boolean
  children: ReactNode
  footer?: ReactNode
}

const sizeClasses: Record<ModalSize, string> = {
  sm:   'max-w-sm',
  md:   'max-w-lg',
  lg:   'max-w-2xl',
  full: 'max-w-full mx-4',
}

export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  persistent = false,
  children,
  footer,
}: ModalProps) {
  const titleId = useId()
  const descId  = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Lock body scroll + restore focus on close
  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement
    document.body.style.overflow = 'hidden'

    // Auto-focus the panel so keyboard users are inside the dialog
    const frame = requestAnimationFrame(() => panelRef.current?.focus())

    return () => {
      cancelAnimationFrame(frame)
      document.body.style.overflow = ''
      previousFocusRef.current?.focus()
    }
  }, [open])

  // Trap focus inside the modal
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !persistent) { onClose(); return }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      )
      const first = focusable[0]
      const last  = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus() }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose, persistent])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descId : undefined}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-gray-900/50 animate-fade-in"
        aria-hidden="true"
        onClick={persistent ? undefined : onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className={[
          'relative w-full bg-white rounded-xl shadow-lg',
          'flex flex-col max-h-[90vh]',
          'animate-fade-in',
          sizeClasses[size],
          'focus-visible:outline-none',
        ].join(' ')}
      >
        {/* Header */}
        {(title || !persistent) && (
          <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-0 shrink-0">
            <div>
              {title && (
                <h2 id={titleId} className="text-base font-semibold text-emerald-900">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descId} className="mt-1 text-sm text-gray-500">
                  {description}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className={[
                'shrink-0 flex items-center justify-center h-8 w-8 rounded-full',
                'text-gray-400 hover:bg-gray-100 hover:text-gray-600',
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
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="shrink-0 flex items-center justify-end gap-3 px-5 pb-5 pt-2 border-t border-gray-200">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
