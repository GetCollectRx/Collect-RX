import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import {
  Card, CardHeader, Button, DataState, ProgressBar, LineChart,
} from '../components/ui'
import { HelpTip } from '../components/HelpTip'
import { QueueOverview } from '../components/QueueOverview'

// ── Types ─────────────────────────────────────────────────────────────────
interface DashboardStats {
  totalOpenAR: number
  aging: { '0-30': number; '31-60': number; '>60': number }
  stageCounts: Record<string, number>
  openBalanceCount: number
  openWorkItemCount?: number
  insuranceOpenAR?: number
  unifiedAr?: boolean
  lastPmsImport?: {
    at: string
    status: string
    source: string
    validationPassed: boolean | null
  } | null
  claimsResolvedToday?: number
  revenueToday?: number
  revenueThisWeek?: number
  telephony?: { callsPlacedToday: number | null; activeCalls: unknown[] }
  recentPayments?: Array<{
    id: string
    amount: number
    paidAt: string
    patientLabel: string
  }>
  operationalAlerts?: {
    blockedCarriers: { code: string; name: string }[]
    patientPaymentsReady: boolean
  }
}

function fmtCurrency(v: number) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency', currency: 'CAD', maximumFractionDigits: 0,
  }).format(v)
}

// ── Vital card ────────────────────────────────────────────────────────────
type VitalStatus = 'on-track' | 'attention' | 'critical' | 'awaiting'

const statusStyles: Record<VitalStatus, string> = {
  'on-track': 'bg-crx-50 text-crx-700 dark:bg-crx-900/30 dark:text-crx-400',
  'attention': 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  'critical':  'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  'awaiting':  'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
}

const statusLabels: Record<VitalStatus, string> = {
  'on-track': 'On track',
  'attention': 'Attention',
  'critical':  'Critical',
  'awaiting':  'Awaiting data',
}

const accentBar: Record<VitalStatus, string> = {
  'on-track': 'bg-crx-500',
  'attention': 'bg-amber-400',
  'critical':  'bg-red-500',
  'awaiting':  'bg-gray-300 dark:bg-gray-600',
}

function VitalCard({
  label, value, sub, benchmark, status,
}: {
  label: string
  value: string
  sub?: string
  benchmark: string
  status: VitalStatus
}) {
  return (
    <div className="relative bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-card overflow-hidden">
      {/* Top accent stripe */}
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${accentBar[status]}`} />
      <div className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-3">
          {label}
        </p>
        <p className={`text-2xl font-bold tabular-nums leading-none mb-1 ${
          status === 'awaiting'
            ? 'text-gray-300 dark:text-gray-600'
            : status === 'critical'
            ? 'text-red-600 dark:text-red-400'
            : status === 'attention'
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-gray-900 dark:text-gray-100'
        }`}>
          {value}
        </p>
        {sub && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 mb-3">{sub}</p>
        )}
        <div className="flex items-center justify-between pt-3 border-t border-gray-50 dark:border-gray-700/60 mt-3">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            Target: <span className="font-semibold text-gray-600 dark:text-gray-400">{benchmark}</span>
          </span>
          <span className={`text-2xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${statusStyles[status]}`}>
            {statusLabels[status]}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Pipeline row ───────────────────────────────────────────────────────────
const STAGE_COLORS: Record<string, string> = {
  PENDING:                  '#94a3b8',
  IN_QUEUE:                 '#3b82f6',
  IN_PROGRESS:              '#3b82f6',
  CALLING:                  '#0d9488',
  APPROVED_PENDING_PAYMENT: '#10b981',
  ESCALATED:                '#ef4444',
  ON_HOLD:                  '#f59e0b',
  BLOCKED:                  '#8b5cf6',
}

const STAGE_LABELS: Record<string, string> = {
  PENDING:                  'Pending submission',
  IN_QUEUE:                 'In queue',
  IN_PROGRESS:              'In progress',
  CALLING:                  'Carrier calling',
  APPROVED_PENDING_PAYMENT: 'Approved — awaiting payment',
  ESCALATED:                'Escalated',
  ON_HOLD:                  'On hold',
  BLOCKED:                  'Blocked',
}

function PipelineRow({
  stage, count, total,
}: { stage: string; count: number; total: number }) {
  const pct = total > 0 ? (count / total) * 100 : 0
  const color = STAGE_COLORS[stage] ?? '#94a3b8'
  const label = STAGE_LABELS[stage] ?? stage
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-50 dark:border-gray-700/50 last:border-0">
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{label}</span>
          <span className="text-xs font-bold text-gray-900 dark:text-gray-100 tabular-nums ml-2 flex-shrink-0">{count}</span>
        </div>
        <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
      </div>
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────
interface OwnerPlatformData {
  openEscalations: number
  recentCalls: Array<{
    id: string
    claimRef: string
    carrierId: string
    outcome: string | null
    initiatedAt: string
    durationSeconds: number | null
  }>
}

export default function Dashboard() {
  const { practiceId, loading: practiceLoading, isPracticeOwner } = usePractice()
  const [stats, setStats]     = useState<DashboardStats | null>(null)
  const [platform, setPlatform] = useState<OwnerPlatformData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [arCloseMsg, setArCloseMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    Promise.all([
      apiFetchJson<DashboardStats>(`/api/dashboard/stats?practiceId=${practiceId}`),
      isPracticeOwner
        ? apiFetchJson<{ success: boolean; data: OwnerPlatformData }>(
            `/api/practices/${practiceId}/dashboard`,
          ).then((r) => r.data).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([dash, plat]) => {
        setStats(dash)
        setPlatform(plat)
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [practiceId, isPracticeOwner])

  const dataBusy = practiceLoading || (loading && !stats)

  return (
    <DataState
      loading={dataBusy}
      error={error}
      isEmpty={!dataBusy && !error && !stats}
      emptyTitle="No dashboard data"
      emptyDetail="Try seeding the database or check your connection."
    >
    {stats && (() => {
      const s = stats
      const totalAging = s.aging['0-30'] + s.aging['31-60'] + s.aging['>60']
      const totalStageCount = Object.values(s.stageCounts).reduce((a, b) => a + b, 0)

      // Revenue trend — show weekly recovered + outstanding
      // Once historical data is wired to the API, swap these static weeks for real series
      const revenueTrendData = [
        { label: 'Apr 28', value: 0 },
        { label: 'May 5',  value: 0 },
        { label: 'May 12', value: s.revenueThisWeek ?? 0 },
      ]

      // Determine aging risk status
      const pct31to60 = totalAging > 0 ? (s.aging['31-60'] / totalAging) * 100 : 0

      return (
        <div className="page-enter p-6 space-y-6 max-w-[1400px]">

          {/* ── Page header ──────────────────────────────────── */}
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Practice Dashboard</h1>
                <HelpTip>
                  Your practice health at a glance — collection rate, aging risk, pipeline progress, and denial patterns.
                  See <Link to="/guide" className="underline text-crx-600 dark:text-crx-400">How it works</Link> for the full AR flow.
                </HelpTip>
              </div>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
                {new Date().toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link to="/work-queue"><Button variant="secondary" size="sm">Work queue</Button></Link>
              <Link to="/insurance"><Button variant="secondary" size="sm">Insurance AR</Button></Link>
              <Link to="/admin/sync"><Button variant="ghost" size="sm">PMS sync</Button></Link>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  void apiFetch('/api/dashboard/ar-close/run', { method: 'POST' })
                    .then(async (r) => {
                      const j = await r.json() as { error?: string; data?: { validationPassed?: boolean } }
                      if (!r.ok) throw new Error(j.error ?? 'AR close failed')
                      setArCloseMsg(j.data?.validationPassed ? 'Daily AR close recorded' : 'AR close recorded with variance flag')
                    })
                    .catch((e) => setArCloseMsg((e as Error).message))
                }}
              >
                Run AR close
              </Button>
            </div>
          </div>

          {arCloseMsg && (
            <p className="text-xs text-crx-600 dark:text-crx-400 -mt-4" role="status">{arCloseMsg}</p>
          )}

          {/* ── Operational alerts ──────────────────────────── */}
          {(() => {
            const oa = s.operationalAlerts
            if (!oa) return null
            const blocked = oa.blockedCarriers ?? []
            const payBlocked = oa.patientPaymentsReady === false
            if (blocked.length === 0 && !payBlocked) return null
            return (
              <div
                className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/90 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-950 dark:text-amber-100 space-y-2"
                role="status"
              >
                <p className="font-semibold">Attention needed</p>
                {blocked.length > 0 && (
                  <p>
                    <strong>Carrier hold:</strong> Automated calls to{' '}
                    {blocked.map(b => b.name).join(', ')} are paused (carrier block).
                    Finish those claims manually and contact your administrator —{' '}
                    <Link to="/guide" className="underline font-medium">How it works → Carrier block</Link>.
                  </p>
                )}
                {payBlocked && (
                  <p>
                    <strong>Patient payments:</strong> Stripe Connect is not ready or the platform key is missing — payment
                    links may not work. Open <Link to="/admin/integrations" className="underline font-medium">Admin → Integrations</Link> or
                    ask your administrator to complete setup.
                  </p>
                )}
              </div>
            )
          })()}

          {isPracticeOwner && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <QueueOverview />
              </div>
              <Card padding="none">
                <div className="px-5 pt-5">
                  <CardHeader
                    title="Open escalations"
                    subtitle="Claims needing owner decision"
                    action={
                      platform && platform.openEscalations > 0 ? (
                        <Link to="/escalations" className="text-xs font-semibold text-crx-600 hover:underline">
                          View all ({platform.openEscalations})
                        </Link>
                      ) : null
                    }
                  />
                </div>
                <div className="px-5 pb-5 space-y-2">
                  {!platform || platform.openEscalations === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">No open escalations.</p>
                  ) : (
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      {platform.openEscalations} claim{platform.openEscalations === 1 ? '' : 's'} need review.
                      <Link to="/escalations" className="block mt-2 text-crx-600 font-medium text-xs">
                        Review escalations →
                      </Link>
                    </p>
                  )}
                </div>
              </Card>
            </div>
          )}

          {/* ── Practice Vital Signs ─────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Practice Vital Signs
              </h2>
              <span className="text-xs text-gray-400 dark:text-gray-500">Industry benchmarks shown per metric</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">

              <VitalCard
                label="Total Open A/R"
                value={fmtCurrency(s.totalOpenAR)}
                sub={`${s.openWorkItemCount ?? s.openBalanceCount} claims in queue`}
                benchmark="≤ 1× monthly production"
                status="attention"
              />

              <VitalCard
                label="Revenue at Risk"
                value={s.aging['31-60'] > 0 ? fmtCurrency(s.aging['31-60']) : '$0'}
                sub={
                  s.aging['31-60'] > 0
                    ? `${pct31to60.toFixed(0)}% of A/R — 31–60 day claims`
                    : 'No 31–60 day exposure'
                }
                benchmark="< 30% of total A/R"
                status={pct31to60 > 50 ? 'attention' : 'on-track'}
              />

              <VitalCard
                label="Collection Rate"
                value="—"
                sub="Resolve claims to track"
                benchmark="≥ 98%"
                status="awaiting"
              />

              <VitalCard
                label="Avg. Days in A/R"
                value="—"
                sub="Needs claim history"
                benchmark="≤ 30 days"
                status="awaiting"
              />

              <VitalCard
                label="Clean Claim Rate"
                value="—"
                sub="First-pass acceptance"
                benchmark="≥ 95%"
                status="awaiting"
              />

            </div>
          </div>

          {/* ── Revenue trend + Claim pipeline ──────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

            {/* Revenue trend */}
            <Card className="xl:col-span-2" padding="none">
              <div className="px-5 pt-5 pb-0">
                <CardHeader
                  title="Revenue Recovered"
                  subtitle="Weekly — resolved payments posted to ledger"
                  action={
                    <span className="text-xs font-semibold tabular-nums text-crx-600 dark:text-crx-400">
                      {fmtCurrency(s.revenueThisWeek ?? 0)} this week
                    </span>
                  }
                />
              </div>
              <div className="px-5 pb-5">
                {(s.revenueThisWeek ?? 0) === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="w-10 h-10 rounded-full bg-crx-50 dark:bg-crx-900/20 flex items-center justify-center mb-3">
                      <svg className="w-5 h-5 text-crx-500" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"/>
                      </svg>
                    </div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      No payments recovered yet
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 max-w-xs">
                      Once claims are resolved and payments post, your weekly collection trend will appear here.
                    </p>
                  </div>
                ) : (
                  <LineChart
                    data={revenueTrendData}
                    height={160}
                    color="#0F6E56"
                    valueFormatter={v => fmtCurrency(v)}
                    ariaLabel="Weekly revenue recovered"
                  />
                )}

                {/* Today's activity strip */}
                <div className="mt-4 grid grid-cols-3 gap-3 pt-4 border-t border-gray-50 dark:border-gray-700/60">
                  <div>
                    <p className="text-2xs uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500 mb-0.5">
                      Claims resolved today
                    </p>
                    <p className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                      {s.claimsResolvedToday ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-2xs uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500 mb-0.5">
                      Calls placed today
                    </p>
                    <p className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                      {s.telephony?.callsPlacedToday ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-2xs uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500 mb-0.5">
                      Active calls now
                    </p>
                    <p className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                      {Array.isArray(s.telephony?.activeCalls) ? s.telephony.activeCalls.length : 0}
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            {/* Claim pipeline */}
            <Card padding="none">
              <div className="px-5 pt-5">
                <CardHeader
                  title="Claim Pipeline"
                  subtitle="Where your money is right now"
                  action={
                    <span className="text-xs font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                      {totalStageCount} total
                    </span>
                  }
                />
              </div>
              <div className="px-5 pb-2">
                {Object.entries(s.stageCounts).length > 0 ? (
                  Object.entries(s.stageCounts).map(([stage, count]) => (
                    <PipelineRow key={stage} stage={stage} count={count} total={totalStageCount} />
                  ))
                ) : (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
                    No claims in pipeline yet.
                  </p>
                )}
              </div>
              <div className="mx-5 mb-5 mt-2 rounded-lg bg-gray-50 dark:bg-gray-700/40 px-4 py-3 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  Total Open A/R
                </span>
                <span className="text-base font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                  {fmtCurrency(s.totalOpenAR)}
                </span>
              </div>
            </Card>

          </div>

          {/* ── A/R Aging Risk + Denial Reasons ─────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* A/R Aging Risk */}
            <Card padding="none">
              <div className="px-5 pt-5">
                <CardHeader
                  title="A/R Aging Risk Profile"
                  subtitle="Older claims are harder to collect — act before 60 days"
                  action={
                    <div className="text-right">
                      <p className="text-2xs uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500">AR Ratio</p>
                      <p className="text-lg font-bold text-gray-900 dark:text-gray-100 leading-none">1.0×</p>
                      <p className="text-2xs text-crx-600 dark:text-crx-400 font-semibold">≤ 1.0 = Healthy</p>
                    </div>
                  }
                />
              </div>
              <div className="px-5 space-y-4 pb-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-crx-500" />
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">0–30 days</span>
                      <span className="text-2xs text-gray-400 dark:text-gray-500">Low risk</span>
                    </div>
                    <span className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                      {fmtCurrency(s.aging['0-30'])}
                      <span className="text-xs font-normal text-gray-400 ml-1">
                        ({totalAging > 0 ? ((s.aging['0-30'] / totalAging) * 100).toFixed(0) : 0}%)
                      </span>
                    </span>
                  </div>
                  <ProgressBar
                    value={totalAging > 0 ? (s.aging['0-30'] / totalAging) * 100 : 0}
                    color="#0F6E56"
                    height={6}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-400" />
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">31–60 days</span>
                      <span className="text-2xs text-amber-600 dark:text-amber-400 font-medium">Follow up now</span>
                    </div>
                    <span className="text-sm font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                      {fmtCurrency(s.aging['31-60'])}
                      <span className="text-xs font-normal text-gray-400 ml-1">
                        ({totalAging > 0 ? ((s.aging['31-60'] / totalAging) * 100).toFixed(0) : 0}%)
                      </span>
                    </span>
                  </div>
                  <ProgressBar
                    value={totalAging > 0 ? (s.aging['31-60'] / totalAging) * 100 : 0}
                    color="#f59e0b"
                    height={6}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">&gt; 60 days</span>
                      <span className="text-2xs text-red-600 dark:text-red-400 font-medium">Critical zone</span>
                    </div>
                    <span className="text-sm font-bold text-red-600 dark:text-red-400 tabular-nums">
                      {fmtCurrency(s.aging['>60'])}
                      <span className="text-xs font-normal text-gray-400 ml-1">
                        ({totalAging > 0 ? ((s.aging['>60'] / totalAging) * 100).toFixed(0) : 0}%)
                      </span>
                    </span>
                  </div>
                  <ProgressBar
                    value={totalAging > 0 ? (s.aging['>60'] / totalAging) * 100 : 0}
                    color="#ef4444"
                    height={6}
                  />
                </div>
              </div>
              {/* Benchmark callout */}
              <div className="mx-5 mb-5 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 px-4 py-3 flex gap-2.5">
                <svg className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/>
                </svg>
                <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                  <strong>Industry benchmark:</strong> Top practices keep &gt;50% of A/R in 0–30 days.
                  {s.aging['31-60'] > 0 && (
                    <> Your <strong>{fmtCurrency(s.aging['31-60'])}</strong> in 31–60 day claims needs active follow-up this week.</>
                  )}
                </p>
              </div>
            </Card>

            {/* Denial Reasons */}
            <Card padding="none">
              <div className="px-5 pt-5">
                <CardHeader
                  title="Top Denial Reasons"
                  subtitle="Patterns from resolved & denied claims — last 30 days"
                  action={
                    <span className="text-2xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
                      0 denials
                    </span>
                  }
                />
              </div>

              {/* Empty state */}
              <div className="flex flex-col items-center justify-center py-8 text-center px-6">
                <div className="w-10 h-10 rounded-full bg-crx-50 dark:bg-crx-900/20 flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-crx-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                  </svg>
                </div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">No denials recorded yet</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed max-w-xs">
                  As claims resolve, denial patterns will surface here — codes, carriers, and fix actions to close revenue leakage.
                </p>
              </div>

              {/* What to watch for */}
              <div className="mx-5 mb-5 rounded-lg bg-gray-50 dark:bg-gray-700/40 px-4 py-3 space-y-2.5">
                <p className="text-2xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  Common denial patterns to watch for
                </p>
                {[
                  { color: '#f59e0b', label: 'Missing or invalid patient info' },
                  { color: '#ef4444', label: 'Frequency limitation exceeded' },
                  { color: '#8b5cf6', label: 'Non-covered or excluded procedure' },
                  { color: '#3b82f6', label: 'Carrier underpayment vs. fee schedule' },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: item.color }} />
                    <span className="text-xs text-gray-600 dark:text-gray-400">{item.label}</span>
                  </div>
                ))}
              </div>
            </Card>

          </div>

          {/* ── Recent payments ─────────────────────────────── */}
          {s.recentPayments && s.recentPayments.length > 0 && (
            <Card padding="none">
              <div className="px-5 pt-5">
                <CardHeader title="Recent Payments" subtitle="Latest posted to your ledger" />
              </div>
              <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8">
                {s.recentPayments.map(p => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 py-2.5 border-b border-gray-50 dark:border-gray-700/50 last:border-0"
                  >
                    <div className="w-7 h-7 rounded-full bg-crx-50 dark:bg-crx-900/20 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3.5 h-3.5 text-crx-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{p.patientLabel}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {new Date(p.paidAt).toLocaleString('en-CA', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-crx-600 dark:text-crx-400 tabular-nums">
                      {fmtCurrency(p.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

        </div>
      )
    })()}
    </DataState>
  )
}
