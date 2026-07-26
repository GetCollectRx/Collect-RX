import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'

type CommandItem = {
  id: string
  label: string
  hint?: string
  path: string
  roles?: string[]
}

const COMMANDS: CommandItem[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard' },
  { id: 'import', label: 'Import claims CSV', hint: 'Onboarding', path: '/import' },
  { id: 'claims', label: 'Claims', path: '/insurance' },
  { id: 'queue', label: 'Priority queue', path: '/insurance?tab=queue' },
  { id: 'blocked', label: 'Blocked gates', path: '/insurance?tab=blocked' },
  { id: 'ar', label: 'AR command center', path: '/ar-command-center' },
  { id: 'console', label: 'Live console', path: '/console', roles: ['front_desk'] },
  { id: 'aging', label: 'Aging report', path: '/reports/aging' },
  { id: 'carriers', label: 'Carrier stats', path: '/reports/carriers' },
  { id: 'settings', label: 'Practice settings', path: '/settings' },
  { id: 'guide', label: 'How it works', path: '/guide' },
]

export function CommandPalette() {
  const navigate = useNavigate()
  const { userRole, isFrontDesk } = usePractice()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return COMMANDS.filter((c) => {
      if (c.roles?.includes('front_desk') && !isFrontDesk && userRole !== 'front_desk') {
        return false
      }
      if (!needle) return true
      return c.label.toLowerCase().includes(needle) || c.hint?.toLowerCase().includes(needle)
    })
  }, [q, isFrontDesk, userRole])

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
