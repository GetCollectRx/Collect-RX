import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { CollectRxLogoPortal } from '../components/brand/CollectRxLogo'
import { apiFetch } from '../lib/apiFetch'
import { HOME_ROUTE } from '../types/userRole'
import { usePractice } from '../context/PracticeContext'

export default function SignupPage() {
  const navigate = useNavigate()
  const { refreshSession } = usePractice()
  const [form, setForm] = useState({ practiceName: '', displayName: '', email: '', password: '', organizationName: '' })
  const [additionalLocations, setAdditionalLocations] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function addLocation() {
    setAdditionalLocations(locs => [...locs, ''])
  }

  function updateLocation(index: number, value: string) {
    setAdditionalLocations(locs => locs.map((l, i) => i === index ? value : l))
  }

  function removeLocation(index: number) {
    setAdditionalLocations(locs => locs.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const additionalPractices = additionalLocations
        .map(name => name.trim())
        .filter(Boolean)
        .map(practiceName => ({ practiceName }))

      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          practiceName: form.practiceName,
          displayName: form.displayName,
          email: form.email,
          password: form.password,
          ...(additionalPractices.length > 0
            ? { organizationName: form.organizationName, additionalPractices }
            : {}),
        }),
      })
      const data = await res.json() as { error?: string; role?: string }
      if (!res.ok) {
        setError(data.error ?? 'Registration failed')
        return
      }
      await refreshSession()
      navigate(data.role === 'group_admin' ? '/group-dashboard' : HOME_ROUTE.practice_owner, { replace: true })
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

          {additionalLocations.map((location, index) => (
            <div className="crx-portal-field" key={index}>
              <label htmlFor={`crx-location-${index}`} className="crx-portal-label">Additional location</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  id={`crx-location-${index}`}
                  type="text"
                  className="crx-portal-input"
                  placeholder="Another practice location name"
                  value={location}
                  onChange={e => updateLocation(index, e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => removeLocation(index)}
                  aria-label="Remove location"
                  className="crx-portal-link"
                  style={{ flexShrink: 0 }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}

          <button type="button" onClick={addLocation} className="crx-portal-link" style={{ marginBottom: '12px' }}>
            + Add another location
          </button>

          {additionalLocations.length > 0 && (
            <div className="crx-portal-field">
              <label htmlFor="crx-org-name" className="crx-portal-label">Organization name</label>
              <input
                id="crx-org-name"
                type="text"
                className="crx-portal-input"
                placeholder="Your DSO or group name"
                value={form.organizationName}
                onChange={e => setForm(f => ({ ...f, organizationName: e.target.value }))}
                required
              />
            </div>
          )}

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
