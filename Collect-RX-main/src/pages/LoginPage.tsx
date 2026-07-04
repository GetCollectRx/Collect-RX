import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { CollectRxLogoPortal } from '../components/brand/CollectRxLogo'

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
            <label htmlFor="crx-pw" className="crx-portal-label">Password</label>
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

        <p className="crx-portal-note" style={{ marginTop: '16px' }}>
          New practice?{' '}
          <Link to="/signup" className="crx-portal-link">Create an account</Link>
        </p>

        <details className="crx-portal-divider crx-portal-details">
          <summary>Auditor / billing ops / platform admin</summary>
          <p className="crx-portal-note">
            Cross-practice roles provisioned in Admin → Users. Practice staff use the form above.
          </p>
          <form onSubmit={onPlatformUserSubmit}>
            <div className="crx-portal-field">
              <label htmlFor="crx-platform-email" className="crx-portal-label">Email</label>
              <input
                id="crx-platform-email"
                type="email"
                className="crx-portal-input"
                placeholder="ops@collectrx.ca"
                value={platformEmail}
                onChange={(e) => setPlatformEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="crx-portal-field">
              <label htmlFor="crx-platform-pw" className="crx-portal-label">Password</label>
              <input
                id="crx-platform-pw"
                type="password"
                className="crx-portal-input"
                placeholder="Password"
                value={platformPassword}
                onChange={(e) => setPlatformPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <button type="submit" disabled={platformBusy} className="crx-portal-btn-secondary">
              {platformBusy ? 'Signing in…' : 'Sign in (platform role)'}
            </button>
          </form>
        </details>

        <div className="crx-portal-divider">
          <p className="crx-portal-label" style={{ fontSize: '0.6875rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--brand-graphite)' }}>
            Platform developer
          </p>
          <p className="crx-portal-note">
            Full ops and config access without patient-identifiable data. Set{' '}
            <code>PLATFORM_DEV_PASSWORD</code> in the API environment.
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
        </div>

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
