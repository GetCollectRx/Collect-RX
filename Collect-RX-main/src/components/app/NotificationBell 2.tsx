import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../../context/PracticeContext'
import { useRoleAccess } from '../../lib/useRoleAccess'
import { apiFetchJson } from '../../lib/apiFetch'

interface RecoveryNotificationItem {
  id: string
  kind: 'blocking_gate' | 'payment_trace_due'
  severity: 'info' | 'warning'
  title: string
  detail: string
  claimId: string
  claimNumber: string
  href: string
}

export function NotificationBell() {
  const { practiceId } = usePractice()
  const { canViewInsurance } = useRoleAccess()
  const [items, setItems] = useState<RecoveryNotificationItem[]>([])
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!practiceId || !canViewInsurance) return
    try {
      const res = await apiFetchJson<{ success: boolean; data: RecoveryNotificationItem[] }>(
        '/api/insurance/recovery/notifications',
      )
      setItems(res.data ?? [])
    } catch {
      // bell is optional
    }
  }, [practiceId, canViewInsurance])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 60_000)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!canViewInsurance) return null

  const urgentCount = items.filter((n) => n.severity === 'warning').length

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        className="crx-topbar-link relative inline-flex items-center gap-1.5 px-2 py-1"
        aria-label={`Notifications${urgentCount ? `, ${urgentCount} urgent` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-5 h-5" aria-hidden>
          <path
            d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {urgentCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
            {urgentCount > 9 ? '9+' : urgentCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg z-50 overflow-hidden"
          role="dialog"
          aria-label="Recovery notifications"
        >
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Recovery attention</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Gates and payment traces that need your team
            </p>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400 text-center">
              Nothing needs attention right now.
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
              {items.slice(0, 12).map((n) => (
                <li key={n.id}>
                  <Link
                    to={n.href}
                    className="block px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
                    onClick={() => setOpen(false)}
                  >
                    <p className="text-xs font-mono text-gray-500 dark:text-gray-400">{n.claimNumber}</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-0.5">{n.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{n.detail}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {items.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-900/40">
              <Link
                to="/insurance?tab=blocked"
                className="text-xs font-medium text-crx-600 dark:text-crx-400 hover:underline"
                onClick={() => setOpen(false)}
              >
                View all blocked gates →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
