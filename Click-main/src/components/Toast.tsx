import { useState, useCallback, useEffect } from 'react'

export interface ToastMessage {
  type: 'success' | 'error'
  msg: string
  id: number
}

let toastId = 0

export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null)

  const showToast = useCallback((type: 'success' | 'error', msg: string) => {
    const id = ++toastId
    setToast({ type, msg, id })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const dismissToast = useCallback(() => setToast(null), [])

  return { toast, showToast, dismissToast }
}

export default function Toast({ toast, onDismiss }: { toast: ToastMessage | null; onDismiss: () => void }) {
  if (!toast) return null

  return (
    <div
      className={toast.type === 'success' ? 'success' : 'error'}
      role="alert"
      aria-live="polite"
      style={{ marginBottom: '1rem', cursor: 'pointer' }}
      onClick={onDismiss}
    >
      {toast.msg}
    </div>
  )
}
