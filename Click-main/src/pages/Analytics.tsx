import { useEffect, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { api } from '../utils/api'
import type {
  CollectionRate,
  FunnelStage,
  PriorityBalance,
  MessageEffectivenessItem,
  PaymentTrend,
} from '../types'

interface SectionState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

function initSection<T>(): SectionState<T> {
  return { data: null, loading: true, error: null }
}

function SectionError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="error" role="alert">
      {error}
      <button className="btn btn-secondary" onClick={onRetry} style={{ marginLeft: '0.75rem' }}>
        Retry
      </button>
    </div>
  )
}

function SectionLoading({ label }: { label: string }) {
  return <div className="loading" role="status" aria-label={`Loading ${label}`}>Loading {label}...</div>
}

function Analytics() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const [collectionRate, setCollectionRate] = useState<SectionState<CollectionRate>>(initSection)
  const [funnel, setFunnel] = useState<SectionState<FunnelStage[]>>(initSection)
  const [priorityBalances, setPriorityBalances] = useState<SectionState<PriorityBalance[]>>(initSection)
  const [messageEffectiveness, setMessageEffectiveness] = useState<SectionState<MessageEffectivenessItem[]>>(initSection)
  const [paymentTrends, setPaymentTrends] = useState<SectionState<PaymentTrend[]>>(initSection)

  function fetchSection<T>(
    path: string,
    setter: React.Dispatch<React.SetStateAction<SectionState<T>>>,
    extract?: (data: Record<string, unknown>) => T,
  ) {
    setter({ data: null, loading: true, error: null })
    api.get<Record<string, unknown>>(`${path}?practiceId=${practiceId}`)
      .then(raw => {
        const data = extract ? extract(raw) : (raw as unknown as T)
        setter({ data, loading: false, error: null })
      })
      .catch(err => {
        setter({ data: null, loading: false, error: (err as Error).message })
      })
  }

  useEffect(() => {
    if (!practiceId) return
    fetchAllAnalytics()
  }, [practiceId])

  function fetchAllAnalytics() {
    fetchSection<CollectionRate>('/api/analytics/collection-rate', setCollectionRate)
    fetchSection<FunnelStage[]>('/api/analytics/stage-funnel', setFunnel, d => (d.funnel as FunnelStage[]) || [])
    fetchSection<PriorityBalance[]>('/api/analytics/priority-balances', setPriorityBalances, d => (d.priorityBalances as PriorityBalance[]) || [])
    fetchSection<MessageEffectivenessItem[]>('/api/analytics/message-effectiveness', setMessageEffectiveness, d => (d.effectiveness as MessageEffectivenessItem[]) || [])
    fetchSection<PaymentTrend[]>('/api/analytics/payment-trends', setPaymentTrends, d => (d.trends as PaymentTrend[]) || [])
  }

  if (practiceLoading) {
    return <div className="loading" role="status">Loading...</div>
  }

  return (
    <main role="main" aria-label="Analytics dashboard">
      <div className="card">
        <h2>Analytics Dashboard</h2>
      </div>

      {/* Collection Rate Dashboard */}
      <section aria-label="Collection performance">
        {collectionRate.loading ? <SectionLoading label="collection data" /> :
         collectionRate.error ? <SectionError error={collectionRate.error} onRetry={() => fetchSection<CollectionRate>('/api/analytics/collection-rate', setCollectionRate)} /> :
         collectionRate.data && (
          <div className="card">
            <h3>Collection Performance</h3>
            <div className="stats-grid">
              <div className="stat-card">
                <h3>Collection Rate</h3>
                <div className="value" style={{ color: collectionRate.data.collectionRate >= 75 ? 'var(--green-700)' : '#B91C1C' }}>
                  {collectionRate.data.collectionRate}%
                  <span className="sr-only">
                    {collectionRate.data.collectionRate >= 75 ? ' - On track' : ' - Below target'}
                  </span>
                </div>
                <div className="sub-value">{collectionRate.data.paidCount} of {collectionRate.data.totalCount} collected</div>
              </div>

              <div className="stat-card">
                <h3>Avg Days to Payment</h3>
                <div className="value" style={{ color: collectionRate.data.avgDaysToPayment <= 14 ? 'var(--green-700)' : '#92400E' }}>
                  {collectionRate.data.avgDaysToPayment}
                  <span className="sr-only">
                    {collectionRate.data.avgDaysToPayment <= 14 ? ' - Fast' : ' - Slow'}
                  </span>
                </div>
                <div className="sub-value">days average</div>
              </div>

              <div className="stat-card">
                <h3>Total Collected</h3>
                <div className="value" style={{ color: 'var(--green-700)' }}>
                  ${collectionRate.data.totalCollected.toLocaleString()}
                </div>
                <div className="sub-value">{collectionRate.data.paidCount} payments</div>
              </div>

              <div className="stat-card">
                <h3>Outstanding</h3>
                <div className="value" style={{ color: '#B91C1C' }}>
                  ${collectionRate.data.totalOutstanding.toLocaleString()}
                </div>
                <div className="sub-value">{collectionRate.data.openCount} open balances</div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Stage Funnel */}
      <section aria-label="Collection funnel">
        {funnel.loading ? <SectionLoading label="funnel data" /> :
         funnel.error ? <SectionError error={funnel.error} onRetry={() => fetchSection<FunnelStage[]>('/api/analytics/stage-funnel', setFunnel, d => (d.funnel as FunnelStage[]) || [])} /> :
         funnel.data && funnel.data.length > 0 && (
          <div className="card">
            <h3>Collection Funnel</h3>
            <p style={{ color: 'var(--gray-500)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
              Shows how balances progress through stages and where drop-offs occur
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {funnel.data.map((stage, index) => {
                const maxCount = funnel.data![0].count
                const widthPercent = maxCount > 0 ? (stage.count / maxCount) * 100 : 0

                return (
                  <div key={stage.stage}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: 600, color: 'var(--green-900)' }}>{stage.stage}</span>
                      <span style={{ color: 'var(--gray-500)' }}>
                        {stage.count} balances
                        {stage.dropOff > 0 && (
                          <span style={{ color: '#B91C1C', marginLeft: '1rem' }}>
                            &darr; {stage.dropOff} (-{stage.dropOffRate}%)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="progress-bar" style={{ height: '40px' }} role="progressbar" aria-valuenow={widthPercent} aria-valuemin={0} aria-valuemax={100} aria-label={`${stage.stage}: ${stage.count} balances`}>
                      <div className="progress-bar-fill" style={{
                        width: `${widthPercent}%`,
                        background: index < 2
                          ? 'linear-gradient(135deg, var(--green-700), var(--green-500))'
                          : index < 4
                            ? 'linear-gradient(135deg, #92400E, #B45309)'
                            : 'linear-gradient(135deg, #991B1B, #B91C1C)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        paddingRight: '1rem',
                        color: 'white',
                        fontWeight: 700,
                      }}>
                        {widthPercent > 0 && `${widthPercent.toFixed(0)}%`}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* Priority Balances */}
      <section aria-label="Priority balances">
        {priorityBalances.loading ? <SectionLoading label="priority balances" /> :
         priorityBalances.error ? <SectionError error={priorityBalances.error} onRetry={() => fetchSection<PriorityBalance[]>('/api/analytics/priority-balances', setPriorityBalances, d => (d.priorityBalances as PriorityBalance[]) || [])} /> :
         priorityBalances.data && priorityBalances.data.length > 0 && (
          <div className="card">
            <h3>Top 10 Priority Balances</h3>
            <p style={{ color: 'var(--gray-500)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
              Ranked by age and amount &mdash; tackle these first
            </p>
            <table role="table" aria-label="Top priority balances">
              <caption className="sr-only">Top 10 balances ranked by priority score</caption>
              <thead>
                <tr>
                  <th scope="col">Priority</th>
                  <th scope="col">Patient</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Days Old</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Score</th>
                </tr>
              </thead>
              <tbody>
                {priorityBalances.data.map((balance, index) => (
                  <tr key={balance.id}>
                    <td>
                      <span style={{
                        fontSize: '1.5rem',
                        fontWeight: 'bold',
                        color: index < 3 ? '#B91C1C' : '#92400E',
                      }}>
                        #{index + 1}
                      </span>
                    </td>
                    <td>{balance.patient.displayName}</td>
                    <td><strong>${balance.amount.toFixed(2)}</strong></td>
                    <td>
                      <span style={{
                        color: balance.daysOutstanding > 60 ? '#B91C1C' : '#92400E',
                        fontWeight: 600,
                      }}>
                        {balance.daysOutstanding} days
                        {balance.daysOutstanding > 60 && ' (overdue)'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${balance.currentStage.toLowerCase()}`}>
                        {balance.currentStage}
                      </span>
                    </td>
                    <td>
                      <span style={{ color: 'var(--gray-500)', fontWeight: 600 }}>
                        {balance.priorityScore.toFixed(0)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Message Effectiveness */}
      <section aria-label="Message effectiveness">
        {messageEffectiveness.loading ? <SectionLoading label="message data" /> :
         messageEffectiveness.error ? <SectionError error={messageEffectiveness.error} onRetry={() => fetchSection<MessageEffectivenessItem[]>('/api/analytics/message-effectiveness', setMessageEffectiveness, d => (d.effectiveness as MessageEffectivenessItem[]) || [])} /> :
         messageEffectiveness.data && messageEffectiveness.data.length > 0 && (
          <div className="card">
            <h3>Message Effectiveness</h3>
            <p style={{ color: 'var(--gray-500)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
              Which messages get the best response and payment rates
            </p>
            <table role="table" aria-label="Message effectiveness by type">
              <caption className="sr-only">Response and payment rates for each message type</caption>
              <thead>
                <tr>
                  <th scope="col">Message Type</th>
                  <th scope="col">Total Sent</th>
                  <th scope="col">Responses</th>
                  <th scope="col">Payments</th>
                  <th scope="col">Response Rate</th>
                  <th scope="col">Payment Rate</th>
                </tr>
              </thead>
              <tbody>
                {messageEffectiveness.data.map(msg => (
                  <tr key={msg.messageType}>
                    <td>
                      <span className={`badge ${msg.messageType.toLowerCase()}`}>
                        {msg.messageType}
                      </span>
                    </td>
                    <td>{msg.totalSent}</td>
                    <td>{msg.responded}</td>
                    <td><strong>{msg.paid}</strong></td>
                    <td>
                      <span style={{
                        color: msg.responseRate >= 30 ? 'var(--green-700)' : 'var(--gray-500)',
                        fontWeight: 600,
                      }}>
                        {msg.responseRate}%
                        {msg.responseRate >= 30 && <span className="sr-only"> (good)</span>}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        color: msg.paymentRate >= 20 ? 'var(--green-700)' : msg.paymentRate >= 10 ? '#92400E' : '#B91C1C',
                        fontWeight: 700,
                        fontSize: '1.1rem',
                      }}>
                        {msg.paymentRate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="info-box" style={{ marginTop: '1rem' }}>
              <strong>Insight:</strong> Focus on improving the lowest-performing messages to boost overall collection rates.
            </div>
          </div>
        )}
      </section>

      {/* Payment Trends */}
      <section aria-label="Payment trends">
        {paymentTrends.loading ? <SectionLoading label="payment trends" /> :
         paymentTrends.error ? <SectionError error={paymentTrends.error} onRetry={() => fetchSection<PaymentTrend[]>('/api/analytics/payment-trends', setPaymentTrends, d => (d.trends as PaymentTrend[]) || [])} /> :
         paymentTrends.data && paymentTrends.data.length > 0 && (
          <div className="card">
            <h3>Payment Trends (Last 12 Weeks)</h3>
            <p style={{ color: 'var(--gray-500)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
              Track collection speed and volume over time
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
              {paymentTrends.data.map(trend => (
                <div key={trend.week} style={{
                  background: 'var(--green-50)',
                  padding: '1rem',
                  borderRadius: '8px',
                  border: '1px solid var(--green-100)',
                }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.5rem' }}>
                    {new Date(trend.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--green-900)' }}>
                    {trend.paymentsCount}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--gray-500)' }}>payments</div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--green-700)', fontWeight: 600, marginTop: '0.5rem' }}>
                    {trend.avgDaysToPayment} days avg
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--green-500)', fontWeight: 600 }}>
                    ${trend.totalAmount.toFixed(0)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  )
}

export default Analytics
