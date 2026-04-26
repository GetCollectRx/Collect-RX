import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../utils/api'
import type { Balance } from '../types'

function PaymentPage() {
  const { balanceId } = useParams()
  const [balance, setBalance] = useState<Balance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!balanceId) return
    let cancelled = false

    async function fetchBalance() {
      try {
        setLoading(true)
        setError(null)
        const data = await api.get<Balance>(`/api/balances/${balanceId}`)
        if (!cancelled) setBalance(data)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchBalance()
    return () => { cancelled = true }
  }, [balanceId])

  const handlePayment = async () => {
    try {
      setPaying(true)
      setError(null)
      await api.post(`/api/pay/${balanceId}`, {})
      setSuccess(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPaying(false)
    }
  }

  if (loading) {
    return <div className="loading" role="status" aria-label="Loading payment information">Loading payment information...</div>
  }

  if (error && !balance) {
    return (
      <div className="error" role="alert">
        {error}
        <Link to="/" className="btn btn-secondary" style={{ marginLeft: '1rem' }}>Return to Dashboard</Link>
      </div>
    )
  }

  if (!balance) {
    return <div className="error" role="alert">Balance not found</div>
  }

  if (success) {
    return (
      <div className="card" style={{ maxWidth: '600px', margin: '2rem auto', textAlign: 'center' }}>
        <h2 style={{ color: 'var(--green-700)' }}>Payment Successful!</h2>
        <p style={{ marginTop: '1rem', color: 'var(--gray-500)' }}>
          Thank you for your payment of ${balance.amount.toFixed(2)}
        </p>
        <p style={{ marginTop: '0.5rem', color: 'var(--gray-500)' }}>
          Your balance has been paid in full.
        </p>
        <div style={{ marginTop: '2rem' }}>
          <Link to="/" className="btn btn-primary">Return to Dashboard</Link>
        </div>
      </div>
    )
  }

  if (balance.status === 'PAID') {
    return (
      <div className="card" style={{ maxWidth: '600px', margin: '2rem auto', textAlign: 'center' }}>
        <h2>Balance Already Paid</h2>
        <p style={{ marginTop: '1rem', color: 'var(--gray-500)' }}>
          This balance has already been paid.
        </p>
      </div>
    )
  }

  return (
    <main role="main" aria-label="Payment portal">
      <div className="card" style={{ maxWidth: '600px', margin: '2rem auto' }}>
        <h2>Payment Portal</h2>

        {error && (
          <div className="error" role="alert" style={{ marginTop: '1rem' }}>
            Payment failed: {error}
          </div>
        )}

        <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'var(--green-50)', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <strong>Patient:</strong>
            <span>{balance.patient.displayName}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <strong>Balance Created:</strong>
            <span>{new Date(balance.createdAt).toLocaleDateString()}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <strong>Days Outstanding:</strong>
            <span>{balance.daysOutstanding} days</span>
          </div>

          <hr />

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.25rem' }}>
            <strong>Amount Due:</strong>
            <strong style={{ color: 'var(--green-900)' }}>${balance.amount.toFixed(2)}</strong>
          </div>
        </div>

        <div style={{ marginTop: '2rem', textAlign: 'center' }}>
          <button
            className="btn btn-success"
            onClick={handlePayment}
            disabled={paying}
            aria-busy={paying}
            style={{ fontSize: '1.125rem', padding: '0.75rem 2rem' }}
          >
            {paying ? 'Processing...' : `Pay $${balance.amount.toFixed(2)}`}
          </button>
        </div>

        <p style={{ marginTop: '1.5rem', fontSize: '0.875rem', color: 'var(--gray-500)', textAlign: 'center' }}>
          This is a simulated payment portal for demonstration purposes.
        </p>
      </div>
    </main>
  )
}

export default PaymentPage
