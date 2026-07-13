import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { CollectRxLogoPortal } from '../components/brand/CollectRxLogo'
import { apiFetch } from '../lib/apiFetch'
import { HOME_ROUTE } from '../types/userRole'

export default function SignupPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ practiceName: '', displayName: '', email: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          practiceName: form.practiceName,
          displayName: form.displayName,
          email: form.email,
          password: form.password,
        }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Registration failed')
        return
      }
      navigate(HOME_ROUTE.practice_owner, { replace: true })
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="crx-portal-root">
      <div className="crx-portal-card">
        <div className="crx-portal-brand">
          <CollectRxLogoPortal />
        </div>

        <h1 className="crx-portal-title" style={{ marginBottom: '4px' }}>Create your account</h1>
        <p className="crx-portal-subtitle">You'll be the account owner for your practice. Staff can be invited afterward.</p>

        <form onSubmit={handleSubmit} style={{ marginTop: '16px' }}>
          <div className="crx-portal-field">
            <label htmlFor="crx-practice" className="crx-portal-label">Practice name</label>
            <input
              id="crx-practice"
              type="text"
              className="crx-portal-input"
              placeholder="Your dental practice name"
              value={form.practiceName}
              onChange={e => setForm(f => ({ ...f, practiceName: e.target.value }))}
              required
            />
          </div>
          <div className="crx-portal-field">
            <label htmlFor="crx-name" className="crx-portal-label">Your name</label>
            <input
              id="crx-name"
              type="text"
              className="crx-portal-input"
              placeholder="Jane Smith"
              value={form.displayName}
              onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
              required
            />
          </div>
          <div className="crx-portal-field">
            <label htmlFor="crx-email" className="crx-portal-label">Email</label>
            <input
              id="crx-email"
              type="email"
              className="crx-portal-input"
              placeholder="jane@yourpractice.ca"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
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
              placeholder="At least 8 characters"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>

          {error && (
            <div className="crx-portal-alert error" role="alert">{error}</div>
          )}

          <button type="submit" disabled={busy} className="crx-portal-btn">
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="crx-portal-note" style={{ marginTop: '16px' }}>
          Already have an account?{' '}
          <Link to="/login" className="crx-portal-link">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
