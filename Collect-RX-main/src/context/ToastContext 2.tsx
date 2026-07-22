import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { InlineToast, type ToastInputType } from '../components/ui/Toast'

type ToastState = { type: ToastInputType; msg: string } | null

type ToastContextValue = {
  toast: ToastState
  showToast: (type: ToastInputType, msg: string) => void
  clearToast: () => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null)

  const showToast = useCallback((type: ToastInputType, msg: string) => {
    setToast({ type, msg })
    window.setTimeout(() => setToast(null), 4500)
  }, [])

  const clearToast = useCallback(() => setToast(null), [])

  return (
    <ToastContext.Provider value={{ toast, showToast, clearToast }}>
      {children}
      <div className="crx-toast-host" aria-live="polite">
        <InlineToast toast={toast} />
      </div>
    </ToastContext.Provider>
  )
}

export function useAppToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useAppToast must be used within ToastProvider')
  }
  return ctx
}
