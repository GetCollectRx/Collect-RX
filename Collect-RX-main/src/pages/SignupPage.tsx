import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { CollectRxLogoPortal } from '../components/brand/CollectRxLogo'
import { apiFetch } from '../lib/apiFetch'
import { HOME_ROUTE, type UserRole } from '../types/userRole'

type Persona = {
  role: UserRole
  title: string
  description: string
  icon: string
}

const PERSONAS: Persona[] = [
  {
    role: 'practice_owner',
    title: 'Practice Owner',
    description: 'Full access to all claims, reports, settings, and staff management.',
    icon: '🏥',
  },
  {
    role: 'office_manager',
    title: 'Office Manager',
    description: 'Manage claims, work queue, and billing. No practice settings.',
    icon: '📋',
  },
  {
    role: 'billing_coordinator',
    title: 'Billing Coordinator',
    description: 'Insurance AR, billing, aging reports, and escalations.',
    icon: '💳',
  },
  {
    role: 'front_desk',
    title: 'Front Desk',
    description: 'Monitor live calls, view call history, and handle escalations.',
    icon: '📞',
  },
]

export default function SignupPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<'pick' | 'form'>('pick')
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null)
  const [form, setForm] = useState({ practiceName: '', displayName: '', email: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function selectPersona(role: UserRole) {
    setSelectedRole(role)
    setStep('form')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedRole) return
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
      const data = await res.json() as { error?: string; role?: string }
      if (!res.ok) {
        setError(data.error ?? 'Registration failed')
        return
      }
      navigate(HOME_ROUTE[selectedRole], { replace: true })
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const persona = PERSONAS.find(p => p.role === selectedRole)

  return (
    <div className="crx-portal-root">
      <div className="crx-portal-card">
        <div className="crx-portal-brand">
          <CollectRxLogoPortal />
        </div>

        {step === 'pick' && (
          <>
            <h1 className="crx-portal-title">Create your account</h1>
            <p className="crx-portal-subtitle">Select your role at the practice.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
              {PERSONAS.map(p => (
                <button
                  key={p.role}
                  type="button"
                  onClick={() => selectPersona(p.role)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '14px 16px',
                    border: '1.5px solid var(--crx-border, #e0e0de)',
                    borderRadius: '10px',
                    background: 'var(--crx-surface, #fff)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#0f6e56')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--crx-border, #e0e0de)')}
                >
                  <span style={{ fontSize: '24px', lineHeight: 1 }}>{p.icon}</span>
                  <span>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: '15px', color: 'var(--crx-text, #111)' }}>
                      {p.title}
                    </span>
                    <span style={{ display: 'block', fontSize: '13px', color: 'var(--crx-muted, #666)', marginTop: '2px' }}>
                      {p.description}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <p className="crx-portal-note" style={{ marginTop: '20px' }}>
              Already have an account?{' '}
              <Link to="/login" className="crx-portal-link">Sign in</Link>
            </p>
          </>
        )}

        {step === 'form' && persona && (
          <>
            <button
              type="button"
              onClick={() => setStep('pick')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--crx-muted, #666)', fontSize: '13px',
                padding: '0 0 12px', display: 'flex', alignItems: 'center', gap: '4px',
              }}
            >
              ← Back
            </button>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 14px', borderRadius: '8px',
              background: 'var(--crx-surface-2, #f5f5f3)',
              marginBottom: '20px',
            }}>
              <span style={{ fontSize: '20px' }}>{persona.icon}</span>
              <span style={{ fontWeight: 600, fontSize: '14px' }}>{persona.title}</span>
            </div>

            <h1 className="crx-portal-title" style={{ marginBottom: '4px' }}>Your details</h1>
            {selectedRole === 'practice_owner' && (
              <p className="crx-portal-subtitle">You'll be the account owner for your practice.</p>
            )}

            <form onSubmit={handleSubmit} style={{ marginTop: '16px' }}>
              {selectedRole === 'practice_owner' && (
                <div className="crx-portal-field">
                  <label htmlFor="crx-practice" className="crx-portal-label">Practice name</label>
                  <input
                    id="crx-practice"
                    type="text"
                    className="crx-portal-input"
                    placeholder="Tenthline Family Dentistry"
                    value={form.practiceName}
                    onChange={e => setForm(f => ({ ...f, practiceName: e.target.value }))}
                    required={selectedRole === 'practice_owner'}
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
          </>
        )}
      </div>
    </div>
  )
}
