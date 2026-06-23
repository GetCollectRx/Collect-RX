import { useState } from 'react'
import { resolveApiUrl } from '../lib/resolveApiUrl'
import { usePractice } from '../context/PracticeContext'

interface Props {
  onClose: () => void
}

export function ChangePasswordModal({ onClose }: Props) {
  const { sessionUser } = usePractice()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (next.length < 8) { setError('New password must be at least 8 characters'); return }
    if (next !== confirm) { setError('Passwords do not match'); return }
    if (!sessionUser) { setError('No active session'); return }
    setBusy(true)
    try {
      const res = await fetch(
        resolveApiUrl(`/api/auth/users/${sessionUser.id}/change-password`),
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword: current, newPassword: next }),
        },
      )
      const body = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) { setError(body.error ?? 'Failed to change password'); return }
      setDone(true)
    } catch {
      setError('Network error, please try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Change password</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {done ? (
          <div className="text-center py-4 space-y-3">
            <p className="text-sm text-green-700 dark:text-green-400 font-medium">Password updated successfully.</p>
            <button
              onClick={onClose}
              className="text-sm text-crx-500 hover:text-crx-600 transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            {[
              { id: 'cp-current', label: 'Current password', value: current, set: setCurrent, auto: 'current-password' },
              { id: 'cp-new',     label: 'New password',     value: next,    set: setNext,    auto: 'new-password' },
              { id: 'cp-confirm', label: 'Confirm new password', value: confirm, set: setConfirm, auto: 'new-password' },
            ].map(f => (
              <div key={f.id}>
                <label htmlFor={f.id} className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                  {f.label}
                </label>
                <input
                  id={f.id}
                  type="password"
                  value={f.value}
                  onChange={e => f.set(e.target.value)}
                  autoComplete={f.auto}
                  required
                  className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-crx-500/30 focus:border-crx-500 transition-colors"
                />
              </div>
            ))}

            {error && (
              <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 text-sm font-semibold rounded-lg bg-crx-500 hover:bg-crx-600 text-white disabled:opacity-50 transition-colors"
            >
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
