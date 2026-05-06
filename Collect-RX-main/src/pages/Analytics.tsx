import { useEffect, useState, useCallback } from 'react'
import { usePractice } from '../context/PracticeContext'
import { apiFetch } from '../lib/apiFetch'
import {
  StatTile, Card, CardHeader, StageBadge, Badge,
  BarChart, LineChart, DataState,
  TableContainer, Table, Thead, Tbody, Th, Tr, Td,
} from '../components/ui'

// ─────────────────────────────────────────────────────────────────────────────
// Types — Insurance AI analytics
// ─────────────────────────────────────────────────────────────────────────────

interface InsuranceAnalytics {
  timeSaved: {
    completedCalls: number
    timeSavedMinutes: number
    timeSavedHours: number
    avgManualCallMinutes: number
  }
  dollarsRecovered: {
    resolvedClaimsCount: number
    dollarsRecovered: number
    currency: 'CAD'
  }
  carrierRates: Array<{
    carrierId: string
    displayName: string
    totalCalls: number
    resolvedCalls: number
    resolutionRate: number
    deniedCalls: number
    escalatedCalls: number
  }>
  callVolume: Array<{
    date: string
    calls: number
    resolved: number
    failed: number
  }>
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** PRD KPI: hrs saved = calls × avg 8 min (patient AR) */
function hrsFromCalls(n: number) { return ((n * 8) / 60).toFixed(1) }

function dateRange(days: number): { from: string; to: string } {
  const to   = new Date()
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return {
    from: from.toISOString().slice(0, 10),
    to:   to.toISOString().slice(0, 10),
  }
}

const RANGE_OPTIONS = [
  { label: '30 days',   days: 30  },
  { label: '90 days',   days: 90  },
  { label: 'This year', days: 365 },
] as const

// ─────────────────────────────────────────────────────────────────────────────
// Insurance AI section
// ─────────────────────────────────────────────────────────────────────────────

function InsuranceSection({ practiceId }: { practiceId: string }) {
  const [rangeDays, setRangeDays] = useState<30 | 90 | 365>(30)
  const [data,    setData]    = useState<InsuranceAnalytics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    const { from, to } = dateRange(rangeDays)
    apiFetch(`/api/analytics/insurance?practiceId=${practiceId}&from=${from}&to=${to}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error ?? 'Failed to load insurance analytics')
        }
        return r.json() as Promise<InsuranceAnalytics>
      })
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [practiceId, rangeDays])

  useEffect(() => { load() }, [load])

  const noData = !data || data.timeSaved.completedCalls === 0

  const volumeLineData = (data?.callVolume ?? []).map((p) => ({
    label: new Date(p.date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }),
    value: p.calls,
  }))

  const carrierBarData = (data?.carrierRates ?? [])
    .filter((c) => c.totalCalls > 0)
    .map((c) => ({
      label: c.displayName.replace(' Financial', '').replace(' Insurance', '').replace(' AdjudiCare', ''),
      value: c.resolutionRate,
      color: c.resolutionRate >= 75 ? '#0F6E56' : c.resolutionRate >= 50 ? '#f59e0b' : '#ef4444',
    }))

  const avgRate = (() => {
    const active = data?.carrierRates.filter((c) => c.totalCalls > 0) ?? []
    if (!active.length) return null
    return Math.round(active.reduce((s, c) => s + c.resolutionRate, 0) / active.length)
  })()

  return (
    <section>
      {/* Header + date range toggle */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Insurance AI — Claims Recovery
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Time saved and dollars recovered by the AI voice agent
          </p>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {RANGE_OPTIONS.map(({ label, days }) => (
            <button
              key={days}
              onClick={() => setRangeDays(days as 30 | 90 | 365)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                rangeDays === days
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {!loading && data && (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatTile
              label="Hours Saved"
              value={`${data.timeSaved.timeSavedHours} hrs`}
              sub={`${data.timeSaved.completedCalls} AI calls · ${data.timeSaved.avgManualCallMinutes} min avg`}
              icon="⏱"
              accent="green"
              trend={{ value: 'vs. manual calling', dir: 'up' }}
            />
            <StatTile
              label="Dollars Recovered"
              value={`$${data.dollarsRecovered.dollarsRecovered.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`}
              sub={`${data.dollarsRecovered.resolvedClaimsCount} claims resolved · CAD`}
              icon="💰"
              accent="green"
              trend={{ value: 'outstanding claims paid', dir: 'up' }}
            />
            <StatTile
              label="AI Calls Made"
              value={data.timeSaved.completedCalls}
              sub={`last ${rangeDays} days`}
              icon="📞"
              accent="blue"
            />
            <StatTile
              label="Avg Resolution Rate"
              value={avgRate !== null ? `${avgRate}%` : '—'}
              sub="across all 6 carriers"
              icon="✓"
              accent={avgRate === null ? 'default' : avgRate >= 70 ? 'green' : avgRate >= 50 ? 'amber' : 'red'}
            />
          </div>

          {/* Charts */}
          {!noData && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
              <Card>
                <CardHeader
                  title="Call Volume Over Time"
                  subtitle={`Daily AI calls · last ${rangeDays} days`}
                />
                {volumeLineData.length > 1 ? (
                  <LineChart
                    data={volumeLineData}
                    height={160}
                    color="#0F6E56"
                    ariaLabel="Insurance AI call volume"
                  />
                ) : (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Not enough data yet</p>
                )}
              </Card>

              <Card>
                <CardHeader
                  title="Resolution Rate by Carrier"
                  subtitle="% of AI calls that resolved the claim"
                />
                {carrierBarData.length > 0 ? (
                  <BarChart
                    data={carrierBarData}
                    height={160}
                    valueFormatter={(v) => `${v}%`}
                    ariaLabel="Carrier resolution rate"
                  />
                ) : (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">No calls completed yet</p>
                )}
              </Card>
            </div>
          )}

          {/* Carrier health table */}
          <Card>
            <CardHeader
              title="Carrier Health"
              subtitle="All 6 Canadian carriers — Sun Life, Canada Life, Manulife, Green Shield, RBC, TELUS"
            />
            {data.carrierRates.every((c) => c.totalCalls === 0) ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 py-6 px-1">
                No carrier calls recorded yet. Results appear here once the AI begins calling.
              </p>
            ) : (
              <TableContainer>
                <Table>
                  <Thead>
                    <tr>
                      <Th>Carrier</Th>
                      <Th align="right">Total Calls</Th>
                      <Th align="right">Resolved</Th>
                      <Th align="right">Denied</Th>
                      <Th align="right">Escalated</Th>
                      <Th>Resolution Rate</Th>
                    </tr>
                  </Thead>
                  <Tbody>
                    {data.carrierRates.map((c) => (
                      <Tr key={c.carrierId}>
                        <Td bold>{c.displayName}</Td>
                        <Td align="right" muted>{c.totalCalls === 0 ? '—' : c.totalCalls}</Td>
                        <Td align="right">{c.resolvedCalls === 0 ? '—' : c.resolvedCalls}</Td>
                        <Td align="right" muted>{c.deniedCalls === 0 ? '—' : c.deniedCalls}</Td>
                        <Td align="right" muted>{c.escalatedCalls === 0 ? '—' : c.escalatedCalls}</Td>
                        <Td>
                          {c.totalCalls === 0 ? (
                            <span className="text-xs text-gray-400 dark:text-gray-600">No calls yet</span>
                          ) : (
                            <div className="flex items-center gap-2 min-w-[140px]">
                              <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{
                                    width: `${c.resolutionRate}%`,
                                    backgroundColor:
                                      c.resolutionRate >= 75 ? '#0F6E56'
                                      : c.resolutionRate >= 50 ? '#f59e0b'
                                      : '#ef4444',
                                  }}
                                />
                              </div>
                              <Badge color={c.resolutionRate >= 75 ? 'green' : c.resolutionRate >= 50 ? 'amber' : 'red'}>
                                {c.resolutionRate}%
                              </Badge>
                            </div>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </TableContainer>
            )}
          </Card>
        </>
      )}

      <div className="my-8 border-t border-gray-100 dark:border-gray-800" />
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Analytics page
// ─────────────────────────────────────────────────────────────────────────────

export default function Analytics() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const [loading,        setLoading]       = useState(false)
  const [collectionRate, setCollectionRate] = useState<any>(null)
  const [funnel,         setFunnel]        = useState<any[]>([])
  const [priorityBal,    setPriorityBal]   = useState<any[]>([])
  const [msgEffect,      setMsgEffect]     = useState<any[]>([])
  const [paymentTrends,  setPaymentTrends] = useState<any[]>([])
  const [carrierPerf,    setCarrierPerf]   = useState<Array<{ carrier: string; rate: number; resolved: number; total: number }>>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    Promise.all([
      apiFetch(`/api/analytics/collection-rate?practiceId=${practiceId}`),
      apiFetch(`/api/analytics/stage-funnel?practiceId=${practiceId}`),
      apiFetch(`/api/analytics/priority-balances?practiceId=${practiceId}`),
      apiFetch(`/api/analytics/message-effectiveness?practiceId=${practiceId}`),
      apiFetch(`/api/analytics/payment-trends?practiceId=${practiceId}`),
      apiFetch(`/api/analytics/carrier-performance?practiceId=${practiceId}`),
    ])
      .then(async (rs) => {
        for (const r of rs) {
          if (!r.ok) {
            const errBody = await r.json().catch(() => ({}))
            throw new Error((errBody as { error?: string }).error || 'Analytics request failed')
          }
        }
        return Promise.all(rs.map((r) => r.json()))
      })
      .then(([col, fun, pri, eff, trends, car]) => {
        setCollectionRate(col)
        setFunnel(fun.funnel ?? [])
        setPriorityBal(pri.priorityBalances ?? [])
        setMsgEffect(eff.effectiveness ?? [])
        setPaymentTrends(trends.trends ?? [])
        setCarrierPerf(car.performance ?? [])
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [practiceId])

  const dataBusy = practiceLoading || loading
  const callsPlaced = collectionRate?.totalCount ?? 0
  const hrsSaved    = hrsFromCalls(callsPlaced)
  const roi         = collectionRate
    ? `${(((collectionRate.totalCollected - 500) / 500) * 100).toFixed(0)}%`
    : '—'

  const lineData = paymentTrends.map((t: any) => ({
    label: new Date(t.week).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }),
    value: t.totalAmount ?? 0,
  }))

  return (
    <DataState loading={dataBusy} error={error} isEmpty={false}>
      <div className="page-enter p-6 space-y-6 max-w-[1400px]">

        {/* Page header */}
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Analytics</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Insurance claims recovery, time saved, and collection performance
          </p>
        </div>

        {/* ── Insurance AI section ──────────────────────────────────────── */}
        {practiceId && <InsuranceSection practiceId={practiceId} />}

        {/* ── Patient AR analytics ──────────────────────────────────────── */}
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Patient AR — Collection Performance
          </h2>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile
            label="Time Saved"
            value={`${hrsSaved} hrs`}
            sub={`${callsPlaced} AI calls placed`}
            icon="⏱"
            accent="green"
            trend={{ value: 'vs. manual calling', dir: 'up' }}
          />
          <StatTile
            label="ROI vs. Subscription"
            value={roi}
            sub="$500/mo plan"
            icon="💹"
            accent="green"
          />
          {collectionRate && <>
            <StatTile
              label="Collection Rate"
              value={`${collectionRate.collectionRate}%`}
              sub={`${collectionRate.paidCount} of ${collectionRate.totalCount} collected`}
              icon="✓"
              accent={collectionRate.collectionRate >= 75 ? 'green' : 'red'}
            />
            <StatTile
              label="Avg Days to Payment"
              value={`${collectionRate.avgDaysToPayment}d`}
              sub="from claim creation"
              icon="📅"
              accent={collectionRate.avgDaysToPayment <= 14 ? 'green' : 'amber'}
            />
          </>}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card>
            <CardHeader title="Revenue Recovered (12 Weeks)" subtitle="Weekly total collected" />
            {lineData.length > 1 ? (
              <LineChart data={lineData} height={160} color="#0F6E56" ariaLabel="Weekly revenue recovered" />
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Not enough data yet</p>
            )}
          </Card>

          {funnel.length > 0 && (
            <Card>
              <CardHeader title="Collection Funnel" subtitle="Balances by stage — where drop-offs occur" />
              <BarChart
                data={funnel.map((s: any) => ({
                  label: s.stage.replace(/_/g, ' ').slice(0, 8),
                  value: s.count,
                  color: s.dropOff > 0 ? '#f59e0b' : '#0F6E56',
                }))}
                height={160}
                valueFormatter={v => `${v} claims`}
                ariaLabel="Collection funnel"
              />
            </Card>
          )}
        </div>

        <Card>
          <CardHeader
            title="Carrier Performance"
            subtitle="Payment outcomes by carrier (Patient AR balances)"
          />
          {carrierPerf.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-6 px-1">
              No carrier-tagged AR balances yet.
            </p>
          ) : (
            <TableContainer>
              <Table>
                <Thead>
                  <tr>
                    <Th>Carrier</Th>
                    <Th align="right">Claims Sent</Th>
                    <Th align="right">Resolved</Th>
                    <Th>Resolution Rate</Th>
                    <Th align="right">Rate</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {carrierPerf.map(c => (
                    <Tr key={c.carrier}>
                      <Td bold>{c.carrier}</Td>
                      <Td align="right" muted>{c.total}</Td>
                      <Td align="right">{c.resolved}</Td>
                      <Td>
                        <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${c.rate}%`, backgroundColor: c.rate >= 80 ? '#0F6E56' : c.rate >= 70 ? '#f59e0b' : '#ef4444' }}
                          />
                        </div>
                      </Td>
                      <Td align="right">
                        <Badge color={c.rate >= 80 ? 'green' : c.rate >= 70 ? 'amber' : 'red'}>{c.rate}%</Badge>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </TableContainer>
          )}
        </Card>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {priorityBal.length > 0 && (
            <Card>
              <CardHeader title="Top Priority Balances" subtitle="Ranked by age × amount" />
              <div className="space-y-2">
                {priorityBal.slice(0, 8).map((b: any, i: number) => (
                  <div key={b.id} className="flex items-center gap-3 py-2 border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                    <span className={`text-xs font-bold w-6 text-center ${i < 3 ? 'text-red-500' : 'text-amber-500'}`}>
                      #{i + 1}
                    </span>
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200 flex-1 truncate">
                      {b.patient.displayName}
                    </span>
                    <Badge color={b.daysOutstanding > 60 ? 'red' : 'amber'}>{b.daysOutstanding}d</Badge>
                    <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                      ${b.amount.toFixed(0)}
                    </span>
                    <StageBadge stage={b.currentStage} />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {msgEffect.length > 0 && (
            <Card>
              <CardHeader title="Message Effectiveness" subtitle="Payment rates by message type" />
              <div className="space-y-3">
                {msgEffect.map((m: any) => (
                  <div key={m.messageType} className="flex items-center gap-3">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-300 w-28 truncate">
                      {m.messageType}
                    </span>
                    <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-crx-500" style={{ width: `${m.paymentRate}%` }} />
                    </div>
                    <Badge color={m.paymentRate >= 20 ? 'green' : m.paymentRate >= 10 ? 'amber' : 'red'}>
                      {m.paymentRate}% paid
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

      </div>
    </DataState>
  )
}
