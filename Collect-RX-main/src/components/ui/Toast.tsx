import { useState } from 'react'

type ToastType = 'success' | 'error' | 'info' | 'warning'
type ToastInputType = ToastType | 'ok' | 'err'

function toDisplayType(t: ToastInputType): ToastType {
  if (t === 'ok' || t === 'success') return 'success'
  if (t === 'err' || t === 'error') return 'error'
  return t
}

interface ToastProps {
  toast: { type: ToastInputType; msg: string } | null
}

const icons: Record<ToastType, string> = {
  success: '✓',
  error:   '✕',
  info:    'ℹ',
  warning: '⚠',
}

const styles: Record<ToastType, string> = {
  success: 'bg-white dark:bg-gray-800 border-l-4 border-emerald-500 text-gray-900 dark:text-gray-100',
  error:   'bg-white dark:bg-gray-800 border-l-4 border-red-500 text-gray-900 dark:text-gray-100',
  info:    'bg-white dark:bg-gray-800 border-l-4 border-blue-500 text-gray-900 dark:text-gray-100',
  warning: 'bg-white dark:bg-gray-800 border-l-4 border-amber-500 text-gray-900 dark:text-gray-100',
}

const iconStyles: Record<ToastType, string> = {
  success: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30',
  error:   'text-red-600 bg-red-50 dark:bg-red-900/30',
  info:    'text-blue-600 bg-blue-50 dark:bg-blue-900/30',
  warning: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30',
}

// ── Simple inline toast (used with the { toast } state pattern) ───────────
export function InlineToast({ toast }: ToastProps) {
  if (!toast) return null

  const type = toDisplayType(toast.type)

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`toast flex items-center gap-3 px-4 py-3 rounded-xl shadow-card border border-gray-100 dark:border-gray-700 text-sm ${styles[type]}`}
    >
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${iconStyles[type]}`} aria-hidden="true">
        {icons[type]}
      </span>
      <span className="flex-1">{toast.msg}</span>
    </div>
  )
}

// ── Hook: useToast ─────────────────────────────────────────────────────────
export function useToast(durationMs = 4000) {
  const [toast, setToast] = useState<{ type: ToastInputType; msg: string } | null>(null)

  function showToast(type: ToastInputType, msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), durationMs)
  }

  return { toast, showToast }
}
