import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'

export function LoginPage() {
  const { login } = usePractice()
  const [practiceId, setPracticeId] = useState(
    () => (typeof localStorage !== 'undefined' && localStorage.getItem('crx_last_practice_id')) || ''
  )
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sessionInfo, setSessionInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    try {
      if (sessionStorage.getItem('crx_session_lapse') === '1') {
        setSessionInfo('Your session expired. Please sign in again.')
        sessionStorage.removeItem('crx_session_lapse')
      }
    } catch {
      /* ignore */
    }
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(practiceId.trim(), password)
    } catch {
      setError('Invalid practice ID or password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <main
        id="crx-login"
        className="w-full max-w-sm space-y-6 p-8 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm"
        aria-label="Sign in"
      >
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Sign in to CollectRx</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Use the practice ID from <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">db seed</code> output
            and your practice password.
          </p>
          {sessionInfo && (
            <p className="text-sm text-amber-700 dark:text-amber-400 mt-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 border border-amber-200 dark:border-amber-800">
              {sessionInfo}
            </p>
          )}
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="crx-pid" className="block text-2xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Practice ID
            </label>
            <input
              id="crx-pid"
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800"
              value={practiceId}
              onChange={e => setPracticeId(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label htmlFor="crx-pw" className="block text-2xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Password
            </label>
            <input
              id="crx-pw"
              type="password"
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 text-sm font-medium rounded-lg bg-crx-500 hover:bg-crx-600 text-white disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="text-2xs text-gray-500 dark:text-gray-400 text-center leading-relaxed">
          <Link to="/legal/terms" className="underline hover:text-gray-700 dark:hover:text-gray-200">Terms</Link>
          {' · '}
          <Link to="/legal/privacy" className="underline hover:text-gray-700 dark:hover:text-gray-200">Privacy</Link>
          {' · '}
          <Link to="/product" className="underline hover:text-gray-700 dark:hover:text-gray-200">Product</Link>
          {' · '}
          <Link to="/changelog" className="underline hover:text-gray-700 dark:hover:text-gray-200">Changelog</Link>
        </p>
        <p className="text-2xs text-center text-gray-400 dark:text-gray-500">We use cookies for session and preferences; see Privacy.</p>
      </main>
    </div>
  )
}
