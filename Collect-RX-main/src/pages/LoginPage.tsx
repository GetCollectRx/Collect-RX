import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'

export function LoginPage() {
  const { login, loginPlatformUser, loginPlatformDev } = usePractice()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [devPassword, setDevPassword] = useState('')
  const [platformEmail, setPlatformEmail] = useState('')
  const [platformPassword, setPlatformPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sessionInfo, setSessionInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [platformBusy, setPlatformBusy] = useState(false)
  const [devBusy, setDevBusy] = useState(false)

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
      await login(email.trim().toLowerCase(), password)
    } catch (err) {
      setError((err as Error).message || 'Invalid email or password')
    } finally {
      setBusy(false)
    }
  }

  async function onPlatformUserSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPlatformBusy(true)
    try {
      await loginPlatformUser(platformEmail.trim().toLowerCase(), platformPassword)
    } catch (err) {
      setError((err as Error).message || 'Invalid email or password')
    } finally {
      setPlatformBusy(false)
    }
  }

  async function onDevSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setDevBusy(true)
    try {
      await loginPlatformDev(devPassword)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDevBusy(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{
        background: 'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(15,110,86,0.06) 0%, transparent 60%), #f8faf8',
      }}
    >
      <style>{`
        .dark #crx-login-bg {
          background: radial-gradient(ellipse 80% 60% at 50% 40%, rgba(18,201,109,0.04) 0%, transparent 60%), #030805;
        }
      `}</style>

      <main
        id="crx-login"
        className="w-full max-w-[360px]"
        aria-label="Sign in"
      >
        {/* ── Logo ── */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-10 h-10 rounded-xl bg-crx-500 flex items-center justify-center mb-4" style={{ boxShadow: '0 0 32px rgba(15,110,86,0.25)' }}>
            <svg className="w-5 h-5 text-white" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14.924a7.003 7.003 0 01-2 0V11a1 1 0 112 0v3.924zm1-5.924a1 1 0 11-2 0 1 1 0 012 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">
            Collect<span className="text-crx-500">Rx</span>
          </h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Practice portal</p>
        </div>

        {/* ── Card ── */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-card p-7 space-y-5">

          {sessionInfo && (
            <div className="text-xs text-amber-700 dark:text-amber-400 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 border border-amber-200 dark:border-amber-800">
              {sessionInfo}
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="crx-email" className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                Email
              </label>
              <input
                id="crx-email"
                type="email"
                className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-crx-500/30 focus:border-crx-500 transition-colors"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div>
              <label htmlFor="crx-pw" className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                Password
              </label>
              <input
                id="crx-pw"
                type="password"
                className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-crx-500/30 focus:border-crx-500 transition-colors"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {error && (
              <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 text-sm font-semibold rounded-lg bg-crx-500 hover:bg-crx-600 active:bg-crx-700 text-white disabled:opacity-50 transition-colors"
              style={{ marginTop: '8px' }}
            >
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Signing in…
                </span>
              ) : 'Sign in'}
            </button>
          </form>

          <details className="border-t border-gray-100 dark:border-gray-800 pt-4 group">
            <summary className="text-2xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide cursor-pointer list-none flex items-center justify-between">
              Auditor / billing ops / platform admin
              <span className="text-gray-300 dark:text-gray-600 group-open:rotate-180 transition-transform">▾</span>
            </summary>
            <p className="text-2xs text-gray-400 dark:text-gray-600 mt-2 mb-3 leading-relaxed">
              Cross-practice roles provisioned in Admin → Users. Practice staff use the form above.
            </p>
            <form onSubmit={onPlatformUserSubmit} className="space-y-3">
              <input
                type="email"
                className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                placeholder="ops@collectrx.ca"
                value={platformEmail}
                onChange={(e) => setPlatformEmail(e.target.value)}
                autoComplete="email"
                required
              />
              <input
                type="password"
                className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                placeholder="Password"
                value={platformPassword}
                onChange={(e) => setPlatformPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="submit"
                disabled={platformBusy}
                className="w-full py-2.5 text-sm font-semibold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {platformBusy ? 'Signing in…' : 'Sign in (platform role)'}
              </button>
            </form>
          </details>

          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            <p className="text-2xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
              Platform developer
            </p>
            <p className="text-2xs text-gray-400 dark:text-gray-600 mb-3 leading-relaxed">
              Full ops and config access without patient-identifiable data. Set{' '}
              <code className="text-xs">PLATFORM_DEV_PASSWORD</code> in the API environment.
            </p>
            <form onSubmit={onDevSubmit} className="space-y-3">
              <div>
                <label htmlFor="crx-dev-pw" className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                  Developer password
                </label>
                <input
                  id="crx-dev-pw"
                  type="password"
                  className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-crx-500/30 focus:border-crx-500 transition-colors"
                  placeholder="••••••••"
                  value={devPassword}
                  onChange={(e) => setDevPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={devBusy}
                className="w-full py-2.5 text-sm font-semibold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {devBusy ? 'Signing in…' : 'Sign in as developer'}
              </button>
            </form>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="mt-5 text-center space-y-1.5">
          <p className="text-2xs text-gray-400 dark:text-gray-600">
            <Link to="/legal/terms" className="hover:text-gray-600 dark:hover:text-gray-400 transition-colors">Terms</Link>
            <span className="mx-1.5 text-gray-200 dark:text-gray-800">·</span>
            <Link to="/legal/privacy" className="hover:text-gray-600 dark:hover:text-gray-400 transition-colors">Privacy</Link>
            <span className="mx-1.5 text-gray-200 dark:text-gray-800">·</span>
            <Link to="/product" className="hover:text-gray-600 dark:hover:text-gray-400 transition-colors">Product</Link>
            <span className="mx-1.5 text-gray-200 dark:text-gray-800">·</span>
            <Link to="/changelog" className="hover:text-gray-600 dark:hover:text-gray-400 transition-colors">Changelog</Link>
          </p>
          <p className="text-2xs text-gray-300 dark:text-gray-700">
            <Link to="/" className="hover:text-gray-500 dark:hover:text-gray-500 transition-colors">← Back to site</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
