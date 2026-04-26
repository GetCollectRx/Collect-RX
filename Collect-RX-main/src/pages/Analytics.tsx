import { useEffect, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { apiFetch } from '../lib/apiFetch'
import {
  StatTile, Card, CardHeader, StageBadge, Badge,
  BarChart, LineChart, DataState,
  TableContainer, Table, Thead, Tbody, Th, Tr, Td,
} from '../components/ui'

// PRD KPI: hrs saved = calls × avg 8 min, expressed as hours
function hrsFromCalls(n: number) { return ((n * 8) / 60).toFixed(1) }

export default function Analytics() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const [loading,       setLoading]       = useState(false)
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

  // Payment trend line data
  const lineData = paymentTrends.map((t: any) => ({
    label: new Date(t.week).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }),
    value: t.totalAmount ?? 0,
  }))

  return (
    <DataState loading={dataBusy} error={error} isEmpty={false}>
    <div className="page-enter p-6 space-y-6 max-w-[1400px]">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Analytics</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Collection performance, ROI, and carrier efficiency</p>
      </div>

      {/* PRD KPIs: Time saved + ROI */}
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

      {/* Resolution rate trend + Carrier performance */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Resolution rate trend */}
        <Card>
          <CardHeader title="Revenue Recovered (12 Weeks)" subtitle="Weekly total collected" />
          {lineData.length > 1 ? (
            <LineChart
              data={lineData}
              height={160}
              color="#0F6E56"
              ariaLabel="Weekly revenue recovered line chart"
            />
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Not enough data yet</p>
          )}
        </Card>

        {/* Collection funnel */}
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
              ariaLabel="Collection funnel bar chart"
            />
          </Card>
        )}
      </div>

      {/* Carrier performance table */}
      <Card>
        <CardHeader
          title="Carrier Performance"
          subtitle="Payment outcomes by insurance carrier (Patient AR balances with carrier on file)"
        />
        {carrierPerf.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-6 px-1">
            No carrier-tagged AR balances yet. When patient balances from Abeldent include a carrier code, rates appear here.
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
                    <div className="flex items-center gap-2 min-w-[120px]">
                      <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${c.rate}%`, backgroundColor: c.rate >= 80 ? '#0F6E56' : c.rate >= 70 ? '#f59e0b' : '#ef4444' }}
                        />
                      </div>
                    </div>
                  </Td>
                  <Td align="right">
                    <Badge color={c.rate >= 80 ? 'green' : c.rate >= 70 ? 'amber' : 'red'}>
                      {c.rate}%
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </TableContainer>
        )}
      </Card>

      {/* Priority balances + Message effectiveness */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Top 10 priority balances */}
        {priorityBal.length > 0 && (
          <Card>
            <CardHeader title="Top Priority Balances" subtitle="Ranked by age × amount — tackle these first" />
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

        {/* Message effectiveness */}
        {msgEffect.length > 0 && (
          <Card>
            <CardHeader title="Message Effectiveness" subtitle="Response and payment rates by message type" />
            <div className="space-y-3">
              {msgEffect.map((m: any) => (
                <div key={m.messageType} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300 w-28 truncate">
                    {m.messageType}
                  </span>
                  <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-crx-500"
                      style={{ width: `${m.paymentRate}%` }}
                    />
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
