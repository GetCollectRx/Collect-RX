import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { CollectRxLogoPortal } from '../components/brand/CollectRxLogo'

const isLocalDev = import.meta.env.DEV

export function LoginPage() {
  const { login, loginDevDemo, loginPlatformDev } = usePractice()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [devPassword, setDevPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sessionInfo, setSessionInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [demoBusy, setDemoBusy] = useState(false)
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

  async function onDemoContinue() {
    setError(null)
    setDemoBusy(true)
    try {
      await loginDevDemo()
    } catch (err) {
      setError((err as Error).message || 'Could not open demo practice')
    } finally {
      setDemoBusy(false)
    }
  }

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
    <div className="crx-portal">
      <main className="crx-portal-card" aria-label="Sign in">
        <CollectRxLogoPortal size={48} />
        <h1 className="crx-portal-brand">
          Collect<span>Rx</span>
        </h1>
        <p className="crx-portal-tagline">Practice portal</p>

        {sessionInfo && (
          <div className="crx-portal-alert info" role="status">{sessionInfo}</div>
        )}

        {isLocalDev ? (
          <>
            <button
              type="button"
              disabled={demoBusy}
              className="crx-portal-btn"
              onClick={() => { void onDemoContinue() }}
            >
              {demoBusy ? 'Opening demo…' : 'Continue to demo practice'}
            </button>

            {error && (
              <div className="crx-portal-alert error" role="alert" style={{ marginTop: '12px' }}>{error}</div>
            )}

            <details className="crx-portal-divider crx-portal-details" style={{ marginTop: '16px' }}>
              <summary>Sign in with email instead</summary>
              <form onSubmit={onSubmit} style={{ marginTop: '12px' }}>
                <div className="crx-portal-field">
                  <label htmlFor="crx-email" className="crx-portal-label">Email</label>
                  <input
                    id="crx-email"
                    type="email"
                    className="crx-portal-input"
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
                <div className="crx-portal-field">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <label htmlFor="crx-pw" className="crx-portal-label">Password</label>
                    <Link to="/reset-password" className="crx-portal-link" style={{ fontSize: '0.8125rem' }}>
                      Forgot password?
                    </Link>
                  </div>
                  <input
                    id="crx-pw"
                    type="password"
                    className="crx-portal-input"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </div>
                <button type="submit" disabled={busy} className="crx-portal-btn-secondary">
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            </details>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="crx-portal-field">
              <label htmlFor="crx-email" className="crx-portal-label">Email</label>
              <input
                id="crx-email"
                type="email"
                className="crx-portal-input"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="crx-portal-field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <label htmlFor="crx-pw" className="crx-portal-label">Password</label>
                <Link to="/reset-password" className="crx-portal-link" style={{ fontSize: '0.8125rem' }}>
                  Forgot password?
                </Link>
              </div>
              <input
                id="crx-pw"
                type="password"
                className="crx-portal-input"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {error && (
              <div className="crx-portal-alert error" role="alert">{error}</div>
            )}

            <button type="submit" disabled={busy} className="crx-portal-btn">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        <p className="crx-portal-note" style={{ marginTop: '16px' }}>
          New practice?{' '}
          <Link to="/signup" className="crx-portal-link">Create an account</Link>
        </p>

        {!isLocalDev && (
          <details className="crx-portal-divider crx-portal-details">
            <summary>Platform developer access</summary>
            <p className="crx-portal-note">
              Full ops and config access without patient-identifiable data.
            </p>
            <form onSubmit={onDevSubmit}>
              <div className="crx-portal-field">
                <label htmlFor="crx-dev-pw" className="crx-portal-label">Developer password</label>
                <input
                  id="crx-dev-pw"
                  type="password"
                  className="crx-portal-input"
                  placeholder="••••••••"
                  value={devPassword}
                  onChange={(e) => setDevPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <button type="submit" disabled={devBusy} className="crx-portal-btn-secondary">
                {devBusy ? 'Signing in…' : 'Sign in as developer'}
              </button>
            </form>
          </details>
        )}

        <div className="crx-portal-foot">
          <p>
            <Link to="/legal/terms">Terms</Link>
            {' · '}
            <Link to="/legal/privacy">Privacy</Link>
            {' · '}
            <Link to="/product">Product</Link>
            {' · '}
            <Link to="/changelog">Changelog</Link>
          </p>
          <p style={{ marginTop: '0.5rem' }}>
            <Link to="/">← Back to site</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
