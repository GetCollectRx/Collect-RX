import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'

type CommandItem = {
  id: string
  label: string
  hint?: string
  path: string
  /** Omit to allow every authenticated role. Matched against raw session
   * role first (distinguishes office_manager/billing_coordinator, which
   * collapse to the practice_owner persona) then the persona (userRole),
   * mirroring the allowedRoles on each route in App.tsx. */
  roles?: string[]
}

const COMMANDS: CommandItem[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard', roles: ['practice_owner', 'office_manager', 'billing_ops_manager'] },
  { id: 'import', label: 'Import claims CSV', hint: 'Onboarding', path: '/import', roles: ['practice_owner', 'office_manager', 'billing_coordinator', 'billing_ops_manager', 'platform_admin'] },
  { id: 'claims', label: 'Claims', path: '/insurance', roles: ['practice_owner', 'office_manager', 'billing_coordinator', 'billing_ops_manager', 'platform_admin'] },
  { id: 'queue', label: 'Priority queue', path: '/insurance?tab=queue', roles: ['practice_owner', 'office_manager', 'billing_coordinator', 'billing_ops_manager', 'platform_admin'] },
  { id: 'blocked', label: 'Blocked gates', path: '/insurance?tab=blocked', roles: ['practice_owner', 'office_manager', 'billing_coordinator', 'billing_ops_manager', 'platform_admin'] },
  { id: 'ar', label: 'AR command center', path: '/ar-command-center', roles: ['practice_owner', 'office_manager', 'billing_coordinator', 'billing_ops_manager', 'platform_admin'] },
  { id: 'console', label: 'Live console', path: '/console', roles: ['front_desk'] },
  { id: 'aging', label: 'Aging report', path: '/reports/aging', roles: ['practice_owner', 'office_manager', 'billing_coordinator', 'auditor', 'billing_ops_manager', 'platform_admin'] },
  { id: 'carriers', label: 'Carrier stats', path: '/reports/carriers', roles: ['practice_owner', 'office_manager', 'auditor', 'billing_ops_manager', 'platform_admin'] },
  { id: 'settings', label: 'Practice settings', path: '/settings', roles: ['practice_owner', 'office_manager', 'platform_admin'] },
  { id: 'guide', label: 'How it works', path: '/guide' },
]

export function CommandPalette() {
  const navigate = useNavigate()
  const { userRole, role } = usePractice()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return COMMANDS.filter((c) => {
      if (c.roles && !c.roles.includes(role ?? '') && !c.roles.includes(userRole ?? '')) {
        return false
      }
      if (!needle) return true
      return c.label.toLowerCase().includes(needle) || c.hint?.toLowerCase().includes(needle)
    })
  }, [q, role, userRole])

  const close = useCallback(() => {
    setOpen(false)
    setQ('')
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div className="crx-cmd-overlay" role="dialog" aria-modal="true" aria-label="Command palette">
      <button type="button" className="crx-cmd-backdrop" aria-label="Close" onClick={close} />
      <div className="crx-cmd-panel">
        <input
          ref={inputRef}
          className="crx-cmd-input"
          placeholder="Search pages and actions…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="crx-cmd-list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="crx-cmd-item"
                onClick={() => {
                  navigate(item.path)
                  close()
                }}
              >
                <span>{item.label}</span>
                {item.hint && <span className="crx-cmd-hint">{item.hint}</span>}
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className="crx-cmd-empty">No matches</li>
          )}
        </ul>
        <p className="crx-cmd-footer">⌘K to open · Esc to close</p>
      </div>
    </div>
  )
}
