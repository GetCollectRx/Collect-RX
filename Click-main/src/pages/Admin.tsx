import { useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { api } from '../utils/api'
import Toast, { useToast } from '../components/Toast'

function Admin() {
  const { practiceId } = usePractice()
  const [loading, setLoading] = useState(false)
  const [balanceCount, setBalanceCount] = useState('50')
  const { toast, showToast, dismissToast } = useToast()

  const generateBalances = async () => {
    try {
      setLoading(true)
      const data = await api.post<{ message: string }>('/api/admin/generate-balances', {
        practiceId,
        count: parseInt(balanceCount),
      })
      showToast('success', data.message)
    } catch (err) {
      showToast('error', (err as Error).message || 'Failed to generate balances')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main role="main" aria-label="Admin tools">
      <div className="card">
        <h2>Admin Tools</h2>
        <p style={{ color: 'var(--gray-500)', marginTop: '0.5rem' }}>
          Simulate Dentrix sync and manage system configuration
        </p>
      </div>

      <Toast toast={toast} onDismiss={dismissToast} />

      <div className="card">
        <h3>Dentrix Sync Simulator</h3>
        <p style={{ marginBottom: '1rem', color: 'var(--gray-500)' }}>
          Generate synthetic patient balances as if imported from Dentrix
        </p>

        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="balance-count">
            <strong>Number of Balances: </strong>
          </label>
          <input
            id="balance-count"
            type="number"
            value={balanceCount}
            onChange={(e) => setBalanceCount(e.target.value)}
            style={{ marginLeft: '0.5rem', padding: '0.5rem', width: '100px' }}
            min="1"
            max="200"
            aria-label="Number of balances to generate"
          />
        </div>

        <button
          className="btn btn-primary"
          onClick={generateBalances}
          disabled={loading || !practiceId}
          aria-busy={loading}
        >
          {loading ? 'Generating...' : 'Generate Synthetic Balances'}
        </button>
      </div>

      <div className="card" role="region" aria-label="Rules engine status">
        <h3>Rules Engine Status</h3>
        <p style={{ color: 'var(--green-700)', marginBottom: '1rem' }}>
          Rules engine is running and evaluates balances every 60 seconds
        </p>

        <div style={{ background: 'var(--green-50)', padding: '1rem', borderRadius: '4px' }}>
          <h4>Active Rules:</h4>
          <ul style={{ marginTop: '0.5rem', marginLeft: '1.5rem' }}>
            <li>On BALANCE_CREATED &rarr; Send NOTIFIED message immediately</li>
            <li>After 5 days in NOTIFIED &rarr; Send REMINDER_1</li>
            <li>After 10 days in REMINDER_1 &rarr; Send REMINDER_2</li>
            <li>After 20 days in REMINDER_2 OR amount &ge; $500 &rarr; ESCALATED + STAFF_REVIEW</li>
          </ul>
        </div>

        <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: 'var(--gray-500)' }}>
          The rules engine automatically processes balances in the background.
          Generate balances with varied dates to see the engine in action immediately.
        </p>
      </div>

      <div className="card">
        <h3>Setup Instructions</h3>
        <div className="info-box" style={{ marginTop: 0, marginBottom: '1rem' }}>
          <p><strong>Database is ready</strong></p>
          <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
            If you ran <code>npm run db:seed</code>, the system already has 50 balances with varied dates.
          </p>
        </div>

        <div style={{ fontSize: '0.875rem', color: 'var(--gray-500)' }}>
          <p><strong>Quick Start:</strong></p>
          <ol style={{ marginLeft: '1.5rem', marginTop: '0.5rem' }}>
            <li>Generate additional balances using the form above</li>
            <li>Watch the rules engine process them automatically (check logs)</li>
            <li>View messages in the <strong>Message Outbox</strong></li>
            <li>Simulate patient responses (Pay, Question, Dispute)</li>
            <li>See updated stats on the <strong>Dashboard</strong></li>
          </ol>
        </div>
      </div>
    </main>
  )
}

export default Admin
