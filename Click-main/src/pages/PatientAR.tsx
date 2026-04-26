import { useState, useEffect, useCallback } from 'react'
import { api } from '../utils/api'
import Toast, { useToast } from '../components/Toast'
import ConfirmModal from '../components/ConfirmModal'
import type { PatientBalance } from '../types'

const PAYMENT_STATUS_LABELS: Record<string, { label: string; badgeClass: string }> = {
  outstanding: { label: 'Outstanding', badgeClass: 'escalated' },
  partial:     { label: 'Partial',     badgeClass: 'reminder_2' },
  paid:        { label: 'Paid',        badgeClass: 'created' },
  written_off: { label: 'Written off', badgeClass: 'closed' },
}

const REMINDER_STATUS_LABELS: Record<string, { label: string; badgeClass: string }> = {
  none:       { label: 'Not sent',   badgeClass: 'closed' },
  reminder_1: { label: 'Reminder 1', badgeClass: 'notified' },
  reminder_2: { label: 'Reminder 2', badgeClass: 'reminder_1' },
  reminder_3: { label: 'Reminder 3', badgeClass: 'reminder_2' },
}

const PAYMENT_FILTER_OPTIONS = [
  { value: '',            label: 'All statuses' },
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'partial',     label: 'Partial' },
  { value: 'paid',        label: 'Paid' },
  { value: 'written_off', label: 'Written off' },
]

function fmtCurrency(v: number | null | undefined): string {
  return v != null
    ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v)
    : '\u2014'
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '\u2014'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

function StatusBadge({ status, map }: { status: string; map: Record<string, { label: string; badgeClass: string }> }) {
  const info = map[status] || { label: status, badgeClass: 'closed' }
  return <span className={`badge ${info.badgeClass}`}>{info.label}</span>
}

export default function PatientAR() {
  const [balances, setBalances] = useState<PatientBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paymentFilter, setPaymentFilter] = useState('')
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [writingOffId, setWritingOffId] = useState<string | null>(null)
  const { toast, showToast, dismissToast } = useToast()

  // Confirm modal state
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean
    id: string
    name: string
  }>({ open: false, id: '', name: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (paymentFilter) params.set('payment_status', paymentFilter)
      const data = await api.get<{ balances: PatientBalance[] }>(`/api/patients/balances?${params}`)
      setBalances(data.balances || [])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [paymentFilter])

  useEffect(() => { load() }, [load])

  async function handleSendReminder(id: string) {
    setSendingId(id)
    try {
      const data = await api.post<{ emailSent: boolean; smsSent: boolean }>(`/api/patients/balances/${id}/send-reminder`, {})
      showToast('success', `Reminder sent \u2014 email: ${data.emailSent ? 'yes' : 'no'}, SMS: ${data.smsSent ? 'yes' : 'no'}`)
      await load()
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setSendingId(null)
    }
  }

  async function executeWriteOff(id: string) {
    setWritingOffId(id)
    try {
      await api.post(`/api/patients/balances/${id}/write-off`, {})
      showToast('success', 'Balance written off')
      await load()
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setWritingOffId(null)
    }
  }

  function handleWriteOff(id: string, name: string) {
    setConfirmModal({ open: true, id, name })
  }

  // Summary stats
  const outstanding = balances.filter(b => b.paymentStatus === 'outstanding' || b.paymentStatus === 'partial')
  const totalOwed = outstanding.reduce((s, b) => s + (b.patientOwes || 0), 0)
  const neverContacted = balances.filter(b => b.reminderStatus === 'none' && b.paymentStatus === 'outstanding').length

  return (
    <main role="main" aria-label="Patient accounts receivable">
      <ConfirmModal
        open={confirmModal.open}
        title="Write Off Balance"
        message={`Write off the balance for ${confirmModal.name}? This action cannot be undone.`}
        confirmLabel="Write Off"
        variant="danger"
        onConfirm={() => {
          setConfirmModal({ open: false, id: '', name: '' })
          executeWriteOff(confirmModal.id)
        }}
        onCancel={() => setConfirmModal({ open: false, id: '', name: '' })}
      />

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2>Patient AR</h2>
            <p style={{ color: 'var(--gray-500)', marginTop: '0.25rem' }}>Post-insurance balances synced from AbelDent</p>
          </div>
          <button
            className="btn btn-secondary"
            onClick={load}
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="stats-grid" role="region" aria-label="Summary statistics">
        <div className="stat-card">
          <h3>Total Outstanding</h3>
          <div className="value">{fmtCurrency(totalOwed)}</div>
          <div className="sub-value">{outstanding.length} balance{outstanding.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="stat-card">
          <h3>Never Contacted</h3>
          <div className="value" style={{ color: '#92400E' }}>{neverContacted}</div>
          <div className="sub-value">no reminder sent yet</div>
        </div>
        <div className="stat-card">
          <h3>Total Balances</h3>
          <div className="value">{balances.length}</div>
          <div className="sub-value">all statuses</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="filters">
          <label htmlFor="payment-status-filter" style={{ fontWeight: 600, fontSize: '0.875rem' }}>Payment status:</label>
          <select
            id="payment-status-filter"
            value={paymentFilter}
            onChange={e => setPaymentFilter(e.target.value)}
            aria-label="Filter by payment status"
          >
            {PAYMENT_FILTER_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <Toast toast={toast} onDismiss={dismissToast} />

      {error && (
        <div className="error" role="alert">
          Failed to load patient balances: {error}
          <button className="btn btn-secondary" onClick={load} style={{ marginLeft: '1rem' }}>
            Retry
          </button>
        </div>
      )}

      {/* Table */}
      <div className="card">
        {loading ? (
          <div className="loading" role="status">Loading...</div>
        ) : balances.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-text">No patient balances found. Balances sync from AbelDent automatically.</p>
          </div>
        ) : (
          <table role="table" aria-label="Patient balances">
            <caption className="sr-only">Patient post-insurance balances with reminder and payment status</caption>
            <thead>
              <tr>
                <th scope="col">Patient</th>
                <th scope="col">Procedure</th>
                <th scope="col">Tx date</th>
                <th scope="col" style={{ textAlign: 'right' }}>Billed</th>
                <th scope="col" style={{ textAlign: 'right' }}>Ins. paid</th>
                <th scope="col" style={{ textAlign: 'right' }}>Patient owes</th>
                <th scope="col" style={{ textAlign: 'right' }}>Days</th>
                <th scope="col">Reminder</th>
                <th scope="col">Payment</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {balances.map(b => {
                const fullName = `${b.patientFirstName} ${b.patientLastName}`
                const canRemind = (b.paymentStatus === 'outstanding' || b.paymentStatus === 'partial')
                  && b.reminderStatus !== 'reminder_3'
                const canWriteOff = b.paymentStatus !== 'paid' && b.paymentStatus !== 'written_off'

                return (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 500 }}>{fullName}</td>
                    <td title={b.procedureDescription || ''}>{b.procedureCode || '\u2014'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(b.treatmentDate)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCurrency(b.amountBilled)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCurrency(b.insurancePaid)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(b.patientOwes)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{
                        color: (b.daysSinceAdjudication || 0) >= 45 ? '#B91C1C' :
                               (b.daysSinceAdjudication || 0) >= 21 ? '#92400E' : 'inherit',
                        fontWeight: (b.daysSinceAdjudication || 0) >= 45 ? 600 : 400,
                      }}>
                        {b.daysSinceAdjudication ?? '\u2014'}
                        {(b.daysSinceAdjudication || 0) >= 45 && <span className="sr-only"> (overdue)</span>}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={b.reminderStatus} map={REMINDER_STATUS_LABELS} />
                    </td>
                    <td>
                      <StatusBadge status={b.paymentStatus} map={PAYMENT_STATUS_LABELS} />
                    </td>
                    <td>
                      <div className="btn-group" style={{ marginTop: 0 }}>
                        {canRemind && (
                          <button
                            className="btn btn-primary"
                            onClick={() => handleSendReminder(b.id)}
                            disabled={sendingId === b.id}
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}
                          >
                            {sendingId === b.id ? 'Sending...' : 'Send reminder'}
                          </button>
                        )}
                        {b.stripePaymentLink && (
                          <a
                            href={b.stripePaymentLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-secondary"
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}
                          >
                            Payment link
                          </a>
                        )}
                        {canWriteOff && (
                          <button
                            onClick={() => handleWriteOff(b.id, fullName)}
                            disabled={writingOffId === b.id}
                            className="btn btn-danger"
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}
                          >
                            Write off
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  )
}
