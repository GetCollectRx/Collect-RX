import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { resolveApiUrl } from '../lib/resolveApiUrl'

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) setError('Invalid or missing reset token.')
  }, [token])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirm)  { setError('Passwords do not match'); return }
    setBusy(true)
    try {
      const res = await fetch(resolveApiUrl('/api/auth/reset-password/confirm'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      })
      const body = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) { setError(body.error ?? 'Reset failed — the link may have expired'); return }
      setDone(true)
    } catch {
      setError('Network error — please try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(15,110,86,0.06) 0%, transparent 60%), #f8faf8' }}
    >
      <main className="w-full max-w-[360px]">
        <div className="flex flex-col items-center mb-8">
          <div className="w-10 h-10 rounded-xl bg-crx-500 flex items-center justify-center mb-4" style={{ boxShadow: '0 0 32px rgba(15,110,86,0.25)' }}>
            <svg className="w-5 h-5 text-white" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">
            Collect<span className="text-crx-500">Rx</span>
          </h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Set a new password</p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-card p-7">
          {done ? (
            <div className="text-center space-y-4 py-2">
              <p className="text-sm font-medium text-green-700 dark:text-green-400">Password updated successfully.</p>
              <Link
                to="/login"
                className="inline-block text-sm font-semibold text-crx-500 hover:text-crx-600 transition-colors"
              >
                Sign in →
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              {[
                { id: 'rp-pw',  label: 'New password',     value: password, set: setPassword },
                { id: 'rp-cfm', label: 'Confirm password', value: confirm,  set: setConfirm  },
              ].map(f => (
                <div key={f.id}>
                  <label htmlFor={f.id} className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                    {f.label}
                  </label>
                  <input
                    id={f.id}
                    type="password"
                    required
                    value={f.value}
                    onChange={e => f.set(e.target.value)}
                    autoComplete="new-password"
                    className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-crx-500/30 focus:border-crx-500 transition-colors"
                  />
                </div>
              ))}

              {error && (
                <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2" role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy || !token}
                className="w-full py-2.5 text-sm font-semibold rounded-lg bg-crx-500 hover:bg-crx-600 text-white disabled:opacity-50 transition-colors"
              >
                {busy ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          )}
        </div>

        <p className="mt-5 text-center text-2xs text-gray-400 dark:text-gray-600">
          <Link to="/login" className="hover:text-gray-600 dark:hover:text-gray-400 transition-colors">← Back to sign in</Link>
        </p>
      </main>
    </div>
  )
}
