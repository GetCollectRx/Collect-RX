import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../utils/api'
import type { Balance } from '../types'

function BalanceDetail() {
  const { id } = useParams()
  const [balance, setBalance] = useState<Balance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false

    async function fetchBalance() {
      try {
        setLoading(true)
        setError(null)
        const data = await api.get<Balance>(`/api/balances/${id}`)
        if (!cancelled) setBalance(data)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchBalance()
    return () => { cancelled = true }
  }, [id])

  if (loading) {
    return <div className="loading" role="status" aria-label="Loading balance details">Loading balance details...</div>
  }

  if (error) {
    return (
      <div className="error" role="alert">
        Failed to load balance: {error}
        <Link to="/balances" className="btn btn-secondary" style={{ marginLeft: '1rem' }}>
          Back to Balances
        </Link>
      </div>
    )
  }

  if (!balance) {
    return (
      <div className="error" role="alert">
        Balance not found
        <Link to="/balances" className="btn btn-secondary" style={{ marginLeft: '1rem' }}>
          Back to Balances
        </Link>
      </div>
    )
  }

  return (
    <main role="main" aria-label="Balance details">
      <div className="card">
        <Link to="/balances" aria-label="Back to balances list">&larr; Back to Balances</Link>
        <h2 style={{ marginTop: '1rem' }}>Balance Details</h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginTop: '1.5rem' }}>
          <section aria-label="Patient information">
            <h3>Patient Information</h3>
            <p><strong>Name:</strong> {balance.patient.displayName}</p>
            <p><strong>Email:</strong> {balance.patient.emailFake}</p>
            <p><strong>Phone:</strong> {balance.patient.phoneFake}</p>
            <p><strong>Preferred Channel:</strong> {balance.patient.preferredChannel}</p>
          </section>

          <section aria-label="Balance information">
            <h3>Balance Information</h3>
            <p><strong>Amount:</strong> ${balance.amount.toFixed(2)}</p>
            <p><strong>Status:</strong> {balance.status}</p>
            <p>
              <strong>Days Outstanding:</strong>{' '}
              <span style={{
                color: balance.daysOutstanding > 60 ? '#B91C1C' : balance.daysOutstanding > 30 ? '#92400E' : 'var(--green-700)',
                fontWeight: 600,
              }}>
                {balance.daysOutstanding} days
                {balance.daysOutstanding > 60 && ' (overdue)'}
                {balance.daysOutstanding > 30 && balance.daysOutstanding <= 60 && ' (aging)'}
              </span>
            </p>
            <p><strong>Created:</strong> {new Date(balance.createdAt).toLocaleDateString()}</p>
            <p><strong>Due Date:</strong> {new Date(balance.dueDate).toLocaleDateString()}</p>
          </section>
        </div>
      </div>

      <div className="card" role="region" aria-label="Balance timeline">
        <h3>Timeline</h3>
        <div className="timeline">
          {balance.states.map((state) => (
            <div key={state.id} className="timeline-item">
              <h4>Stage: {state.stage}</h4>
              <div className="timestamp">
                {new Date(state.stageAt).toLocaleString()}
              </div>
            </div>
          ))}

          {balance.outreachEvents.map((event) => (
            <div key={event.id} className="timeline-item">
              <h4>Message Sent: {event.templateKey}</h4>
              <div className="timestamp">
                {new Date(event.sentAt).toLocaleString()} via {event.channel}
              </div>
              <div className="message-box">{event.messageBody}</div>
              <p style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
                <strong>Delivery:</strong> {event.deliveryStatus} |
                <strong> Response:</strong> {event.responseStatus}
              </p>
            </div>
          ))}

          {balance.paymentEvents.map((payment) => (
            <div key={payment.id} className="timeline-item">
              <h4>Payment Received</h4>
              <div className="timestamp">
                {new Date(payment.paidAt).toLocaleString()}
              </div>
              <p>
                <strong>Amount:</strong> ${(payment.amountCents / 100).toFixed(2)}<br />
                <strong>Method:</strong> {payment.method}<br />
                <strong>Result:</strong> {payment.result}
              </p>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}

export default BalanceDetail
