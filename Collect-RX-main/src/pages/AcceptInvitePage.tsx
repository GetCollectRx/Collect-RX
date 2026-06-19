import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CollectRxLogoPortal } from '../components/brand/CollectRxLogo'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import { HOME_ROUTE, USER_ROLE_LABELS, type UserRole } from '../types/userRole'

interface InviteInfo {
  email: string
  role: UserRole
  practiceName: string
}

export default function AcceptInvitePage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()

  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState({ displayName: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) { setLoadError('No invite token found in this link.'); return }
    apiFetchJson<InviteInfo>(`/api/auth/invite/${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch(() => setLoadError('This invite link is invalid or has expired.'))
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await apiFetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, displayName: form.displayName, password: form.password }),
      })
      const data = await res.json() as { error?: string; role?: string }
      if (!res.ok) { setError(data.error ?? 'Failed to create account'); return }
      const role = (data.role ?? invite?.role ?? 'front_desk') as UserRole
      navigate(HOME_ROUTE[role] ?? '/dashboard', { replace: true })
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

        {loadError && (
          <>
            <h1 className="crx-portal-title">Invite not found</h1>
            <div className="crx-portal-alert error" role="alert">{loadError}</div>
            <p className="crx-portal-note" style={{ marginTop: '16px' }}>
              Contact the practice owner to get a new invite link.
            </p>
          </>
        )}

        {!loadError && !invite && (
          <p className="crx-portal-note">Checking your invite…</p>
        )}

        {invite && (
          <>
            <h1 className="crx-portal-title">Welcome to CollectRx</h1>
            <div style={{
              padding: '12px 14px', borderRadius: '8px',
              background: 'var(--crx-surface-2, #f5f5f3)',
              marginBottom: '20px', fontSize: '14px',
            }}>
              <p style={{ margin: 0, color: 'var(--crx-text, #111)', fontWeight: 600 }}>{invite.practiceName}</p>
              <p style={{ margin: '2px 0 0', color: 'var(--crx-muted, #666)' }}>
                {USER_ROLE_LABELS[invite.role]} · {invite.email}
              </p>
            </div>

            <form onSubmit={handleSubmit}>
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
                  autoFocus
                />
              </div>
              <div className="crx-portal-field">
                <label htmlFor="crx-pw" className="crx-portal-label">Create a password</label>
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
                {busy ? 'Setting up account…' : 'Set up my account'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
