import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { CollectRxLogoPortal } from '../components/brand/CollectRxLogo'
import { apiFetch } from '../lib/apiFetch'
import { HOME_ROUTE } from '../types/userRole'
import { usePractice } from '../context/PracticeContext'

// Mirrors the CarrierId enum in prisma/schema.prisma (see CLAUDE.md's carrier list).
const CARRIERS = [
  { id: 'sun_life', label: 'Sun Life' },
  { id: 'canada_life', label: 'Canada Life' },
  { id: 'manulife', label: 'Manulife' },
  { id: 'green_shield', label: 'Green Shield' },
  { id: 'rbc', label: 'RBC Insurance' },
  { id: 'telus_adjudicare', label: 'TELUS AdjudiCare' },
] as const

type CarrierSelection = { selected: boolean; providerNumber: string }

export default function SignupPage() {
  const navigate = useNavigate()
  const { refreshSession } = usePractice()
  const [form, setForm] = useState({ practiceName: '', displayName: '', email: '', password: '', organizationName: '' })
  const [additionalLocations, setAdditionalLocations] = useState<string[]>([])
  const [carrierSelections, setCarrierSelections] = useState<Record<string, CarrierSelection>>(
    () => Object.fromEntries(CARRIERS.map((c) => [c.id, { selected: false, providerNumber: '' }])),
  )
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function toggleCarrier(carrierId: string, selected: boolean) {
    setCarrierSelections((s) => ({ ...s, [carrierId]: { ...s[carrierId], selected } }))
  }

  function updateCarrierProviderNumber(carrierId: string, providerNumber: string) {
    setCarrierSelections((s) => ({ ...s, [carrierId]: { ...s[carrierId], providerNumber } }))
  }

  const selectedCarriers = CARRIERS.filter((c) => carrierSelections[c.id]?.selected)
  const carriersReady = selectedCarriers.every((c) => carrierSelections[c.id]?.providerNumber.trim())
  const canSubmit = selectedCarriers.length > 0 && carriersReady && privacyAccepted

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

    if (selectedCarriers.length === 0) {
      setError('Select at least one insurance carrier your practice works with.')
      return
    }
    if (!carriersReady) {
      setError('Enter a provider number for each carrier you selected.')
      return
    }
    if (!privacyAccepted) {
      setError('You must accept the Privacy Policy to create an account.')
      return
    }

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
          carriers: selectedCarriers.map(c => ({
            carrierId: c.id,
            providerNumber: carrierSelections[c.id].providerNumber.trim(),
          })),
          privacyPolicyAccepted: privacyAccepted,
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

          <div className="crx-portal-field">
            <span className="crx-portal-label" role="heading" aria-level={2}>Which insurance carriers do you work with?</span>
            <p className="crx-portal-note" style={{ marginTop: 0, marginBottom: '8px' }}>
              We need your practice's provider number for each one — carriers won't authorize automated
              claim-status calls without it, so calls to any carrier you skip here will stay off until you add it later.
            </p>
            {CARRIERS.map((carrier) => {
              const selection = carrierSelections[carrier.id]
              return (
                <div key={carrier.id} style={{ marginBottom: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={selection.selected}
                      onChange={e => toggleCarrier(carrier.id, e.target.checked)}
                    />
                    {carrier.label}
                  </label>
                  {selection.selected && (
                    <input
                      type="text"
                      className="crx-portal-input"
                      placeholder={`${carrier.label} provider number`}
                      value={selection.providerNumber}
                      onChange={e => updateCarrierProviderNumber(carrier.id, e.target.value)}
                      maxLength={50}
                      required
                      style={{ marginTop: '6px' }}
                    />
                  )}
                </div>
              )
            })}
          </div>

          <div className="crx-portal-field">
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <input
                type="checkbox"
                checked={privacyAccepted}
                onChange={e => setPrivacyAccepted(e.target.checked)}
                style={{ marginTop: '3px' }}
              />
              <span>
                I have read and accept the{' '}
                <Link to="/legal/privacy" target="_blank" rel="noopener noreferrer" className="crx-portal-link">
                  Privacy Policy
                </Link>
              </span>
            </label>
          </div>

          {error && (
            <div className="crx-portal-alert error" role="alert">{error}</div>
          )}

          <button type="submit" disabled={busy || !canSubmit} className="crx-portal-btn">
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
