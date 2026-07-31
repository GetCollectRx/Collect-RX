import { useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { CollectRxLogoPortal } from '../components/brand/CollectRxLogo'
import { resolveApiUrl } from '../lib/resolveApiUrl'

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestSent, setRequestSent] = useState(false)
  const [done, setDone] = useState(false)

  async function onRequestSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(resolveApiUrl('/api/auth/reset-password/request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const body = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) {
        setError(body.error ?? 'Could not send reset email')
        return
      }
      setRequestSent(true)
    } catch {
      setError('Network error, please try again')
    } finally {
      setBusy(false)
    }
  }

  async function onConfirmSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setBusy(true)
    try {
      const res = await fetch(resolveApiUrl('/api/auth/reset-password/confirm'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      })
      const body = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) { setError(body.error ?? 'Reset failed, the link may have expired'); return }
      setDone(true)
    } catch {
      setError('Network error, please try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="crx-portal">
      <main className="crx-portal-card" aria-label={token ? 'Set new password' : 'Reset password'}>
        <CollectRxLogoPortal size={48} />
        <h1 className="crx-portal-brand">
          Collect<span>Rx</span>
        </h1>
        <p className="crx-portal-tagline">
          {token ? 'Set a new password' : 'Reset your password'}
        </p>

        {done ? (
          <div className="crx-portal-alert info" role="status">
            Password updated successfully.{' '}
            <Link to="/login" className="crx-portal-link">Sign in</Link>
          </div>
        ) : requestSent ? (
          <div className="crx-portal-alert info" role="status">
            If an account exists for that email, we sent a reset link. Check your inbox and spam folder.
          </div>
        ) : token ? (
          <form onSubmit={onConfirmSubmit}>
            <div className="crx-portal-field">
              <label htmlFor="rp-pw" className="crx-portal-label">New password</label>
              <input
                id="rp-pw"
                type="password"
                className="crx-portal-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
              />
            </div>
            <div className="crx-portal-field">
              <label htmlFor="rp-cfm" className="crx-portal-label">Confirm password</label>
              <input
                id="rp-cfm"
                type="password"
                className="crx-portal-input"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
              />
            </div>

            {error && (
              <div className="crx-portal-alert error" role="alert">{error}</div>
            )}

            <button type="submit" disabled={busy} className="crx-portal-btn">
              {busy ? 'Saving…' : 'Set new password'}
            </button>
          </form>
        ) : (
          <form onSubmit={onRequestSubmit}>
            <p className="crx-portal-note" style={{ marginBottom: '12px' }}>
              Enter your account email and we&apos;ll send a link to choose a new password.
            </p>
            <div className="crx-portal-field">
              <label htmlFor="rp-email" className="crx-portal-label">Email</label>
              <input
                id="rp-email"
                type="email"
                className="crx-portal-input"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            {error && (
              <div className="crx-portal-alert error" role="alert">{error}</div>
            )}

            <button type="submit" disabled={busy} className="crx-portal-btn">
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <p className="crx-portal-note" style={{ marginTop: '16px' }}>
          <Link to="/login" className="crx-portal-link">← Back to sign in</Link>
        </p>
      </main>
    </div>
  )
}
