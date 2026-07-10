import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { apiFetch } from '../lib/apiFetch'
import { resolveApiUrl } from '../lib/resolveApiUrl'
import { parseApiJson } from '../lib/parseApiJson'
import {
  StatTile, Card, CardHeader, StageBadge, Badge,
  BarChart, LineChart, DataState,
  TableContainer, Table, Thead, Tbody, Th, Tr, Td,
} from '../components/ui'

// ─────────────────────────────────────────────────────────────────────────────
// Types, Insurance AI analytics
// ─────────────────────────────────────────────────────────────────────────────

interface PriorityRankRow {
  claimId: string
  patientName: string
  carrier: string
  amountCents: number
  daysOutstanding: number
  deadlineDaysRemaining: number
  scores: {
    total: number
    age: number
    amount: number
    deadline: number
    attempts: number
    status: number
  }
}

type CarrierPerfRow = { carrier: string; rate: number; resolved: number; total: number }

interface CollectionRate {
  totalCollected: number
  totalCount: number
  collectionRate: number
  paidCount: number
  avgDaysToPayment: number
}
interface FunnelStage { stage: string; count: number; dropOff: number }
interface PriorityBalance {
  id: string | number
  patient: { displayName: string }
  daysOutstanding: number
  amount: number
  currentStage: string
}
interface MsgEffectRow { messageType: string; paymentRate: number }
interface PaymentTrendRow { week: string; totalAmount?: number }

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
  callOutcomeRecovery?: {
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
  syncVerifiedRecovery?: {
    dollarsRecoveredSyncVerified: number
    dollarsRecoveredSyncVerifiedLast30Days: number
    paymentsVerifiedBySync: number
    cohortRecoveryRatePct: number | null
    medianTimeToSyncVerifyHours: number | null
    medianGateClearanceHours: number | null
    blockingGatesOpen: number
    awaitingSyncVerification: number
  }
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

function CallQueuePriorityTable({ practiceId }: { practiceId: string }) {
  const [rows, setRows] = useState<PriorityRankRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiFetch(`/api/queue/priority-scores?practiceId=${encodeURIComponent(practiceId)}`)
      .then(async (r) => {
        const j = await parseApiJson<{ success?: boolean; data?: PriorityRankRow[]; error?: string }>(r)
        if (!r.ok) throw new Error(j.error ?? 'Priority scores failed')
        return j
      })
      .then((j) => {
        if (!cancelled) setRows(Array.isArray(j.data) ? j.data.slice(0, 15) : [])
      })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [practiceId])

  return (
    <Card>
      <CardHeader
        title="Call queue, priority engine"
        subtitle="Top open claims by composite score (age, amount, appeal window, attempts, status). Carrier deadline = days until appeal window from date of service."
      />
      {loading && <p className="text-sm text-gray-500 dark:text-gray-400 py-4 px-1">Loading priority scores…</p>}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 py-3 px-1">{error}</p>
      )}
      {!loading && !error && rows && rows.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-4 px-1">No open claims for this practice.</p>
      )}
      {!loading && !error && rows && rows.length > 0 && (
        <TableContainer>
          <Table>
            <Thead>
              <tr>
                <Th>Patient</Th>
                <Th>Carrier</Th>
                <Th align="right">Outstanding</Th>
                <Th align="right">Days AR</Th>
                <Th align="right">Appeal days</Th>
                <Th align="right">Score</Th>
                <Th align="right">Parts (age / $ / dl / att / st)</Th>
                <Th />
              </tr>
            </Thead>
            <Tbody>
              {rows.map((r) => (
                <Tr key={r.claimId}>
                  <Td bold className="max-w-[140px] truncate">{r.patientName}</Td>
                  <Td muted className="max-w-[120px] truncate">{r.carrier}</Td>
                  <Td align="right">${(r.amountCents / 100).toLocaleString('en-CA', { minimumFractionDigits: 2 })}</Td>
                  <Td align="right">{r.daysOutstanding}</Td>
                  <Td align="right">{r.deadlineDaysRemaining}</Td>
                  <Td align="right"><Badge color="blue">{Math.round(r.scores.total)}</Badge></Td>
                  <Td align="right" muted className="text-xs whitespace-nowrap">
                    {Math.round(r.scores.age)} / {Math.round(r.scores.amount)} / {Math.round(r.scores.deadline)} / {r.scores.attempts} / {r.scores.status}
                  </Td>
                  <Td>
                    <Link to={`/insurance/${r.claimId}`} className="text-xs text-crx-600 dark:text-crx-400 underline">
                      Open
                    </Link>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </TableContainer>
      )}
    </Card>
  )
}

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
        const body = await parseApiJson<{
          success?: boolean
          data?: InsuranceAnalytics
          error?: string
        }>(r)
        if (!r.ok) throw new Error(body.error ?? 'Failed to load insurance analytics')
        if (!body.data) throw new Error('Missing analytics payload')
        const d = body.data
        return {
          ...d,
          dollarsRecovered: d.callOutcomeRecovery ?? d.dollarsRecovered,
          carrierRates: d.carrierRates ?? (d as { resolutionByCarrier?: InsuranceAnalytics['carrierRates'] }).resolutionByCarrier ?? [],
        } satisfies InsuranceAnalytics
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
            Insurance AI, Claims Recovery
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
              label="Call outcome recovery"
              value={`$${data.dollarsRecovered.dollarsRecovered.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`}
              sub={`${data.dollarsRecovered.resolvedClaimsCount} claims marked resolved on call · CAD`}
              icon="📞"
              accent="blue"
              trend={{ value: 'carrier-reported', dir: 'neutral' }}
            />
            {data.syncVerifiedRecovery && (
              <StatTile
                label="PMS sync-verified recovery"
                value={`$${data.syncVerifiedRecovery.dollarsRecoveredSyncVerifiedLast30Days.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`}
                sub={`${data.syncVerifiedRecovery.paymentsVerifiedBySync} all-time · balance confirmed in PMS`}
                icon="💰"
                accent="green"
                trend={{ value: 'source of truth', dir: 'up' }}
              />
            )}
            <StatTile
              label="AI Calls Made"
              value={data.timeSaved.completedCalls}
              sub={`last ${rangeDays} days`}
              icon="📞"
              accent="blue"
            />
            <StatTile
              label="Avg call resolution rate"
              value={avgRate !== null ? `${avgRate}%` : 'N/A'}
              sub="call outcomes only, not sync verified"
              icon="✓"
              accent={avgRate === null ? 'default' : avgRate >= 70 ? 'green' : avgRate >= 50 ? 'amber' : 'red'}
            />
          </div>

          {data.syncVerifiedRecovery && (
            <Card className="mb-6">
              <CardHeader
                title="Recovery loop: sync truth"
                subtitle="North-star metrics from PAYMENT_VERIFIED_SYNC events (PMS balance drop), separate from call status."
              />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 px-4 pb-4">
                <StatTile
                  label="Cohort recovery rate (30d)"
                  value={
                    data.syncVerifiedRecovery.cohortRecoveryRatePct != null
                      ? `${data.syncVerifiedRecovery.cohortRecoveryRatePct}%`
                      : 'N/A'
                  }
                  sub="verified $ / (verified + still open)"
                  accent="green"
                />
                <StatTile
                  label="Median time to sync verify"
                  value={
                    data.syncVerifiedRecovery.medianTimeToSyncVerifyHours != null
                      ? `${data.syncVerifiedRecovery.medianTimeToSyncVerifyHours}h`
                      : 'N/A'
                  }
                  sub="WAIT_SYNC → PAYMENT_VERIFIED_SYNC"
                  accent="blue"
                />
                <StatTile
                  label="Gate clearance SLA"
                  value={
                    data.syncVerifiedRecovery.medianGateClearanceHours != null
                      ? `${data.syncVerifiedRecovery.medianGateClearanceHours}h`
                      : 'N/A'
                  }
                  sub="blocking gate → cleared"
                  accent="amber"
                />
                <StatTile
                  label="Awaiting PMS sync"
                  value={data.syncVerifiedRecovery.awaitingSyncVerification}
                  sub={`${data.syncVerifiedRecovery.blockingGatesOpen} practice gates open`}
                  accent={data.syncVerifiedRecovery.blockingGatesOpen > 0 ? 'amber' : 'default'}
                />
              </div>
            </Card>
          )}

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
                  title="Call resolution rate by carrier"
                  subtitle="% of AI calls marked resolved, not PMS-verified payment"
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
              subtitle="All 6 Canadian carriers, Sun Life, Canada Life, Manulife, Green Shield, RBC, TELUS"
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
                        <Td align="right" muted>{c.totalCalls === 0 ? 'N/A' : c.totalCalls}</Td>
                        <Td align="right">{c.resolvedCalls === 0 ? 'N/A' : c.resolvedCalls}</Td>
                        <Td align="right" muted>{c.deniedCalls === 0 ? 'N/A' : c.deniedCalls}</Td>
                        <Td align="right" muted>{c.escalatedCalls === 0 ? 'N/A' : c.escalatedCalls}</Td>
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

      <div className="h-6" />
      <CallQueuePriorityTable practiceId={practiceId} />

      <div className="my-8 border-t border-gray-100 dark:border-gray-800" />
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Analytics page
// ─────────────────────────────────────────────────────────────────────────────

export default function Analytics() {
  const { practiceId, loading: practiceLoading, isPlatformDev } = usePractice()

  if (isPlatformDev) {
    return (
      <div className="page-enter p-6 space-y-6 max-w-6xl">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">
            Insurance recovery metrics only, patient-level reports are hidden in developer sessions.
          </p>
        </div>
        {practiceId ? <InsuranceSection practiceId={practiceId} /> : (
          <p className="text-sm text-gray-500">Select a practice in the sidebar to load metrics.</p>
        )}
      </div>
    )
  }
  const [loading,        setLoading]       = useState(false)
  const [collectionRate, setCollectionRate] = useState<CollectionRate | null>(null)
  const [funnel,         setFunnel]        = useState<FunnelStage[]>([])
  const [priorityBal,    setPriorityBal]   = useState<PriorityBalance[]>([])
  const [msgEffect,      setMsgEffect]     = useState<MsgEffectRow[]>([])
  const [paymentTrends,  setPaymentTrends] = useState<PaymentTrendRow[]>([])
  const [carrierPerf,    setCarrierPerf]   = useState<CarrierPerfRow[]>([])
  const [practicePerf, setPracticePerf]   = useState<{
    openArTotal: number
    openWorkItemCount: number
    daysInAr: number
    grossCollectionRate: number
    netCollectionRate: number
    topDenialReasons: { reason: string; count: number }[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    const endpoints = [
      `/api/analytics/collection-rate?practiceId=${practiceId}`,
      `/api/analytics/stage-funnel?practiceId=${practiceId}`,
      `/api/analytics/priority-balances?practiceId=${practiceId}`,
      `/api/analytics/message-effectiveness?practiceId=${practiceId}`,
      `/api/analytics/payment-trends?practiceId=${practiceId}`,
      `/api/analytics/carrier-performance?practiceId=${practiceId}`,
      `/api/analytics/practice-performance?practiceId=${practiceId}`,
    ] as const
    Promise.all(endpoints.map((url) => apiFetch(url)))
      .then(async (rs) => {
        const parsed = await Promise.all(
          rs.map(async (r) => {
            const data = await parseApiJson(r)
            return { ok: r.ok, data, status: r.status }
          }),
        )
        const failed = parsed.filter((p) => !p.ok)
        if (failed.length === parsed.length) {
          throw new Error(
            (failed[0]?.data as { error?: string })?.error || 'Analytics unavailable',
          )
        }
        const [col, fun, pri, eff, trends, car, perf] = parsed.map((p) =>
          p.ok ? p.data : {},
        ) as [
          Record<string, unknown>,
          { funnel?: unknown[] },
          { priorityBalances?: unknown[] },
          { effectiveness?: unknown[] },
          { trends?: unknown[] },
          { performance?: CarrierPerfRow[] },
          { success?: boolean; data?: typeof practicePerf },
        ]
        // @ts-expect-error legacy analytics API shapes vary at runtime
        setCollectionRate(col)
        // @ts-expect-error legacy analytics API shapes vary at runtime
        setFunnel(fun.funnel ?? [])
        // @ts-expect-error legacy analytics API shapes vary at runtime
        setPriorityBal(pri.priorityBalances ?? [])
        // @ts-expect-error legacy analytics API shapes vary at runtime
        setMsgEffect(eff.effectiveness ?? [])
        // @ts-expect-error legacy analytics API shapes vary at runtime
        setPaymentTrends(trends.trends ?? [])
        setCarrierPerf(car.performance ?? [])
        setPracticePerf(perf.data ?? null)
        if (failed.length > 0) {
          setError('Some legacy analytics sections are unavailable; insurance metrics below are still shown.')
        }
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [practiceId])

  const dataBusy = practiceLoading || loading
  const callsPlaced = collectionRate?.totalCount ?? 0
  const hrsSaved    = hrsFromCalls(callsPlaced)
  const roi         = collectionRate
    ? `${(((collectionRate.totalCollected - 500) / 500) * 100).toFixed(0)}%`
    : 'N/A'

  const lineData = paymentTrends.map((t) => ({
    label: new Date(t.week).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }),
    value: t.totalAmount ?? 0,
  }))

  return (
    <DataState loading={dataBusy} error={error} isEmpty={false}>
      <div className="page-enter p-6 space-y-6 max-w-[1400px]">

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Analytics</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Insurance claims recovery, time saved, and collection performance
            </p>
          </div>
          {practiceId && (
            <a
              href={resolveApiUrl(`/api/analytics/practice-performance/export?practiceId=${encodeURIComponent(practiceId)}`)}
              className="inline-flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Export CSV
            </a>
          )}
        </div>

        {practicePerf && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatTile
              label="Unified open AR"
              value={`$${practicePerf.openArTotal.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`}
              sub={`${practicePerf.openWorkItemCount} queue items`}
            />
            <StatTile
              label="Days in AR"
              value={String(practicePerf.daysInAr)}
              sub="insurance claims average"
            />
            <StatTile
              label="Gross collection"
              value={`${practicePerf.grossCollectionRate}%`}
              sub="patient AR paid / billed"
            />
            <StatTile
              label="Net collection"
              value={`${practicePerf.netCollectionRate}%`}
              sub="insurance recovered / billed"
            />
          </div>
        )}

        {practicePerf && practicePerf.topDenialReasons.length > 0 && (
          <Card>
            <CardHeader title="Top denial reasons" subtitle="From insurance call outcomes (live)" />
            <ul className="px-4 pb-4 space-y-2 text-sm">
              {practicePerf.topDenialReasons.map((r) => (
                <li key={r.reason} className="flex justify-between gap-4">
                  <span className="text-gray-700 dark:text-gray-300 truncate">{r.reason}</span>
                  <span className="font-medium tabular-nums">{r.count}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* ── Insurance AI section ──────────────────────────────────────── */}
        {practiceId && <InsuranceSection practiceId={practiceId} />}

        {/* ── Patient AR analytics ──────────────────────────────────────── */}
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Patient AR, Collection Performance
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
              <CardHeader title="Collection Funnel" subtitle="Balances by stage, where drop-offs occur" />
              <BarChart
                data={funnel.map((s) => ({
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
                {priorityBal.slice(0, 8).map((b, i) => (
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
                {msgEffect.map((m) => (
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
