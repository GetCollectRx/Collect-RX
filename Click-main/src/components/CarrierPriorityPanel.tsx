import { useState, useEffect } from 'react'

const CARRIERS = [
  { value: null,               label: 'All carriers (no priority)' },
  { value: 'sun_life',         label: 'Sun Life' },
  { value: 'canada_life',      label: 'Canada Life' },
  { value: 'manulife',         label: 'Manulife' },
  { value: 'green_shield',     label: 'Green Shield Canada' },
  { value: 'rbc_insurance',    label: 'RBC Insurance' },
  { value: 'telus_adjudicare', label: 'TELUS AdjudiCare' },
]

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

interface Props {
  practiceId: string
}

export default function CarrierPriorityPanel({ practiceId }: Props) {
  const [carrier, setCarrier]   = useState<string>('__null__')
  const [date, setDate]         = useState(todayISO)
  const [status, setStatus]     = useState<'idle'|'saving'|'saved'|'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [current, setCurrent]   = useState<string | null>(null)

  // Load today's current priority on mount / when date changes
  useEffect(() => {
    if (!practiceId) return
    fetch(`/api/queue/priority?practiceId=${practiceId}&date=${date}`)
      .then(r => r.json())
      .then(data => {
        setCurrent(data.carrier ?? null)
        setCarrier(data.carrier ?? '__null__')
      })
      .catch(() => null)
  }, [practiceId, date])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving')
    setErrorMsg('')

    try {
      const res = await fetch('/api/queue/priority', {
        method  : 'POST',
        headers : { 'Content-Type': 'application/json' },
        body    : JSON.stringify({
          practiceId,
          carrier : carrier === '__null__' ? null : carrier,
          date,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const saved = await res.json()
      setCurrent(saved.carrier ?? null)
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 3000)
    } catch (err: any) {
      setErrorMsg(err.message)
      setStatus('error')
    }
  }

  const currentLabel = current
    ? CARRIERS.find(c => c.value === current)?.label ?? current
    : 'All carriers'

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '1.25rem' }}>📞</span>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--green-900)' }}>Today's Call Priority</h3>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--gray-500)' }}>
            Set which carrier the queue calls first today
          </p>
        </div>
      </div>

      {current !== undefined && (
        <div style={{
          background: 'var(--green-50)', border: '1px solid var(--green-100)', borderRadius: '4px',
          padding: '6px 10px', marginBottom: '1rem', fontSize: '0.85rem',
          display: 'flex', gap: '6px',
        }}>
          <span style={{ color: 'var(--gray-500)' }}>Current:</span>
          <strong style={{ color: 'var(--green-700)' }}>{currentLabel}</strong>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600,
            color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>
            Priority Carrier
          </label>
          <select
            value={carrier}
            onChange={e => setCarrier(e.target.value)}
            disabled={status === 'saving'}
            style={{ width: '100%', padding: '7px 10px', border: '1px solid #ddd',
              borderRadius: '4px', fontSize: '0.9rem', color: 'var(--green-900)' }}
          >
            {CARRIERS.map(c => (
              <option key={c.value ?? '__null__'} value={c.value ?? '__null__'}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600,
            color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>
            Date
          </label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            disabled={status === 'saving'}
            style={{ width: '100%', padding: '7px 10px', border: '1px solid #ddd',
              borderRadius: '4px', fontSize: '0.9rem', color: 'var(--green-900)',
              boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="submit"
            disabled={status === 'saving'}
            style={{
              background: status === 'saving' ? 'var(--gray-400)' : 'var(--green-700)',
              color: '#fff', border: 'none', borderRadius: '4px',
              padding: '8px 18px', fontWeight: 600, cursor: status === 'saving' ? 'not-allowed' : 'pointer',
              fontSize: '0.9rem',
            }}
          >
            {status === 'saving' ? 'Saving…' : 'Set Priority'}
          </button>

          {status === 'saved' && (
            <span style={{ color: 'var(--green-700)', fontSize: '0.875rem', fontWeight: 600 }}>
              ✓ Priority saved
            </span>
          )}
          {status === 'error' && (
            <span style={{ color: '#B91C1C', fontSize: '0.875rem' }}>
              Error: {errorMsg}
            </span>
          )}
        </div>
      </form>
    </div>
  )
}
