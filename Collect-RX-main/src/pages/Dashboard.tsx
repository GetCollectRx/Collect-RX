import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { apiFetchJson } from '../lib/apiFetch'
import {
  StatTile, Card, CardHeader, Button, StageBadge,
  ProgressBar, BarChart, DataState,
} from '../components/ui'
import CarrierPriorityPanel from '../components/CarrierPriorityPanel'
import { HelpTip } from '../components/HelpTip'

// ── Types ─────────────────────────────────────────────────────────────────
interface DashboardStats {
  totalOpenAR: number
  aging: { '0-30': number; '31-60': number; '>60': number }
  stageCounts: Record<string, number>
  openBalanceCount: number
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
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v)
}

// ── Recent payment row (patient + amount; outcome is ledger state) ───────────
function OutcomeRow({
  label, amount, outcome, time,
}: { label: string; amount: string; outcome: 'resolved' | 'escalated' | 'pending'; time: string }) {
  const colorMap = { resolved: 'text-crx-600 dark:text-crx-400', escalated: 'text-red-600 dark:text-red-400', pending: 'text-amber-600 dark:text-amber-400' }
  const labelMap = { resolved: 'Paid', escalated: 'Escalated', pending: 'Pending' }
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-50 dark:border-gray-700/50 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{label}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">{time}</p>
      </div>
      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{amount}</span>
      <span className={`text-xs font-medium ${colorMap[outcome]}`}>{labelMap[outcome]}</span>
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const [stats, setStats]   = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    apiFetchJson<DashboardStats>(`/api/dashboard/stats?practiceId=${practiceId}`)
      .then(data => setStats(data))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [practiceId])

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
      const agingBuckets = [
        { label: '0–30 d', value: s.aging['0-30'], color: '#0F6E56', pct: totalAging > 0 ? (s.aging['0-30'] / totalAging * 100) : 0 },
        { label: '31–60 d', value: s.aging['31-60'], color: '#f59e0b', pct: totalAging > 0 ? (s.aging['31-60'] / totalAging * 100) : 0 },
        { label: '> 60 d', value: s.aging['>60'], color: '#ef4444', pct: totalAging > 0 ? (s.aging['>60'] / totalAging * 100) : 0 },
      ]
      return (
    <div className="page-enter p-6 space-y-6 max-w-[1400px]">
      {/* Page header */}
        <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h1>
            <HelpTip>
              Aging and payments for the selected practice. Insurance follow-up runs from your queue rules; see{' '}
              <Link to="/guide" className="underline text-crx-600 dark:text-crx-400">How it works</Link> for the full flow.
            </HelpTip>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {new Date().toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm">Export</Button>
          <Button variant="primary" size="sm">Run Call Batch</Button>
        </div>
      </div>

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
                {blocked.map((b) => b.name).join(', ')} are paused for this practice (carrier block). Finish those
                claims manually if needed and contact your administrator — see{' '}
                <Link to="/guide" className="underline font-medium">How it works → Carrier block</Link>.
              </p>
            )}
            {payBlocked && (
              <p>
                <strong>Patient payments:</strong> Stripe Connect is not ready or the platform key is missing — payment
                links may not work. Open <Link to="/admin" className="underline font-medium">Admin → Integrations</Link> or
                ask your administrator to complete setup.
              </p>
            )}
          </div>
        )
      })()}

      {/* Hero stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          label="Total Open A/R"
          value={fmtCurrency(s.totalOpenAR)}
          sub={`${s.openBalanceCount} open claims`}
          icon="💰"
          accent="default"
        />
        <StatTile
          label="Claims Resolved Today"
          value={String(s.claimsResolvedToday ?? 0)}
          sub="payments posted today"
          icon="✓"
          accent="green"
        />
        <StatTile
          label="Calls Placed Today"
          value={s.telephony?.callsPlacedToday != null ? String(s.telephony.callsPlacedToday) : '—'}
          sub="Vapi telephony not connected to this dashboard yet"
          icon="📞"
          accent="blue"
        />
        <StatTile
          label="Revenue Recovered"
          value={fmtCurrency(s.revenueThisWeek ?? 0)}
          sub="last 7 days (successful payments)"
          icon="📈"
          accent="green"
        />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* A/R Aging analysis */}
        <Card className="xl:col-span-2">
          <CardHeader title="A/R Aging Breakdown" subtitle="By days outstanding — oldest is highest risk" />

          {/* Bar chart */}
          <BarChart
            data={agingBuckets.map(b => ({ label: b.label, value: b.value, color: b.color }))}
            height={140}
            valueFormatter={v => fmtCurrency(v)}
            ariaLabel="AR aging bar chart by bucket"
          />

          {/* Progress bars */}
          <div className="mt-5 space-y-3">
            {agingBuckets.map(b => (
              <ProgressBar
                key={b.label}
                label={b.label}
                amount={`${fmtCurrency(b.value)} (${b.pct.toFixed(0)}%)`}
                value={b.pct}
                color={b.color}
                height={6}
              />
            ))}
          </div>
        </Card>

        {/* Balances by stage */}
        <Card>
          <CardHeader title="Balances by Stage" />
          <div className="space-y-2">
            {Object.entries(s.stageCounts).map(([stage, count]) => (
              <div
                key={stage}
                className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-gray-700/50 last:border-0"
              >
                <StageBadge stage={stage} />
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Live calls + Recent outcomes + Carrier priority */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Active call feed */}
        <Card>
          <CardHeader
            title="Active Calls"
            subtitle="Live Vapi call status"
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
            No live call feed is configured. When Vapi (or your voice provider) streams real-time
            status to CollectRx, active calls will be listed here.
          </p>
        </Card>

        {/* Recent payments (real data) */}
        <Card>
          <CardHeader title="Recent payments" subtitle="From your ledger — not mock carrier names" />
          {(s.recentPayments && s.recentPayments.length > 0) ? (
            s.recentPayments.map((p) => (
              <OutcomeRow
                key={p.id}
                label={p.patientLabel}
                amount={fmtCurrency(p.amount)}
                outcome="resolved"
                time={new Date(p.paidAt).toLocaleString('en-CA', { dateStyle: 'short', timeStyle: 'short' })}
              />
            ))
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
              No payments recorded yet.
            </p>
          )}
        </Card>

        {/* Carrier priority */}
        <div>
          {practiceId && <CarrierPriorityPanel practiceId={practiceId} />}
        </div>
      </div>
    </div>
      )
    })()}
    </DataState>
  )
}
