import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { CollectRxLogoPortal } from '../components/brand/CollectRxLogo'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'

interface OrgInvitePreview {
  organizationName: string
  inviteeEmail: string
}

export default function OrganizationAcceptInvitePage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()

  const [invite, setInvite] = useState<OrgInvitePreview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) { setLoadError('No invite token found in this link.'); return }
    apiFetchJson<OrgInvitePreview>(`/api/organizations/invite/${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch(() => setLoadError('This invite link is invalid or has expired.'))
  }, [token])

  async function handleAccept() {
    setError(null); setNeedsLogin(false); setBusy(true)
    try {
      const res = await apiFetch(`/api/organizations/invite/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.status === 401) { setNeedsLogin(true); return }
      const data = await res.json() as { error?: string; joined?: boolean }
      if (!res.ok) { setError(data.error ?? 'Failed to join group'); return }
      navigate('/group', { replace: true })
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
          </>
        )}

        {!loadError && !invite && <p className="crx-portal-note">Checking your invite…</p>}

        {invite && (
          <>
            <h1 className="crx-portal-title">Group invitation</h1>
            <div style={{
              padding: '12px 14px', borderRadius: '8px',
              background: 'var(--crx-surface-2, #f5f5f3)',
              marginBottom: '20px', fontSize: '14px',
            }}>
              <p style={{ margin: 0, color: 'var(--crx-text, #111)', fontWeight: 600 }}>{invite.organizationName}</p>
              <p style={{ margin: '2px 0 0', color: 'var(--crx-muted, #666)' }}>
                Invited: {invite.inviteeEmail}
              </p>
            </div>
            <p className="crx-portal-note" style={{ marginBottom: '16px' }}>
              Joining shares only PHI-free aggregate stats (claim counts, resolution rate) with this group —
              no patient data leaves your practice.
            </p>

            {needsLogin && (
              <div className="crx-portal-alert" role="status" style={{ marginBottom: '12px' }}>
                Log in as {invite.inviteeEmail} first, then come back to this link to accept.{' '}
                <Link to="/login">Log in</Link>
              </div>
            )}
            {error && <div className="crx-portal-alert error" role="alert">{error}</div>}

            <button type="button" disabled={busy} className="crx-portal-btn" onClick={() => void handleAccept()}>
              {busy ? 'Joining…' : 'Accept & join group'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
