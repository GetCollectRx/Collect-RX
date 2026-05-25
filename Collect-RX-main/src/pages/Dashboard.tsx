import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import { DataState } from '../components/ui'
import { QueueOverview } from '../components/QueueOverview'

interface DashboardStats {
  totalOpenAR: number
  aging: { '0-30': number; '31-60': number; '>60': number }
  stageCounts: Record<string, number>
  openBalanceCount: number
  openWorkItemCount?: number
  claimsResolvedToday?: number
  revenueThisWeek?: number
  telephony?: { callsPlacedToday: number | null; activeCalls: unknown[] }
  operationalAlerts?: {
    blockedCarriers: { code: string; name: string }[]
    patientPaymentsReady: boolean
  }
}

interface OwnerPlatformData {
  openEscalations: number
}

function fmtCurrency(v: number) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(v)
}

function StatPanel({
  label,
  value,
  sub,
  badge,
  badgeTone = 'green',
}: {
  label: string
  value: string
  sub?: string
  badge?: string
  badgeTone?: 'green' | 'amber' | 'red'
}) {
  const toneClass =
    badgeTone === 'amber' ? 'crx-badge-amber' : badgeTone === 'red' ? 'crx-badge-red' : 'crx-badge-green'
  return (
    <div className="crx-panel crx-panel-accent p-5 relative overflow-hidden">
      <div
        className="absolute top-0 left-0 right-0 h-0.5"
        style={{
          background:
            badgeTone === 'red'
              ? 'var(--crx-red)'
              : badgeTone === 'amber'
                ? 'var(--crx-gold)'
                : 'var(--crx-green)',
        }}
      />
      <p className="crx-stat-label mb-2">{label}</p>
      <p className="crx-stat-value tabular-nums">{value}</p>
      {sub && <p className="crx-sub mt-1">{sub}</p>}
      {badge && <span className={`crx-badge mt-3 inline-block ${toneClass}`}>{badge}</span>}
    </div>
  )
}

const STAGE_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  IN_QUEUE: 'In queue',
  IN_PROGRESS: 'In progress',
  CALLING: 'Calling',
  APPROVED_PENDING_PAYMENT: 'Approved',
  ESCALATED: 'Escalated',
  ON_HOLD: 'On hold',
  BLOCKED: 'Blocked',
}

export default function Dashboard() {
  const { practiceId, loading: practiceLoading, isPracticeOwner, practice } = usePractice()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [platform, setPlatform] = useState<OwnerPlatformData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
          )
            .then((r) => r.data)
            .catch(() => null)
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
        const pct31 = totalAging > 0 ? (s.aging['31-60'] / totalAging) * 100 : 0
        const pct60 = totalAging > 0 ? (s.aging['>60'] / totalAging) * 100 : 0
        const totalStages = Object.values(s.stageCounts).reduce((a, b) => a + b, 0)
        const blocked = s.operationalAlerts?.blockedCarriers ?? []

        return (
          <div className="page-enter p-6 space-y-6 max-w-[1400px]">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="crx-section-label mb-1">Practice command center</p>
                <h1 className="crx-h1">
                  {practice?.name ?? 'Your practice'}
                </h1>
                <p className="crx-sub mt-1">
                  {new Date().toLocaleDateString('en-CA', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to="/reports/aging" className="crx-btn-ghost">Aging report</Link>
                <Link to="/reports/carriers" className="crx-btn-ghost">Carrier stats</Link>
                <Link to="/escalations" className="crx-btn-ghost">Escalations</Link>
                <Link to="/work-queue" className="crx-btn-ghost">Work queue</Link>
                <button
                  type="button"
                  className="crx-btn-primary"
                  onClick={() => {
                    void apiFetch('/api/dashboard/ar-close/run', { method: 'POST' })
                      .then(async (r) => {
                        const j = (await r.json()) as { error?: string; data?: { validationPassed?: boolean } }
                        if (!r.ok) throw new Error(j.error ?? 'AR close failed')
                        setArCloseMsg(
                          j.data?.validationPassed ? 'Daily AR close recorded' : 'AR close recorded with flag',
                        )
                      })
                      .catch((e) => setArCloseMsg((e as Error).message))
                  }}
                >
                  Run AR close
                </button>
              </div>
            </header>

            {arCloseMsg && (
              <p className="text-xs" style={{ color: 'var(--crx-green)' }} role="status">
                {arCloseMsg}
              </p>
            )}

            {(blocked.length > 0 || s.operationalAlerts?.patientPaymentsReady === false) && (
              <div className="crx-alert px-4 py-3 text-sm space-y-1">
                <p className="font-semibold" style={{ color: 'var(--crx-gold)' }}>
                  Attention needed
                </p>
                {blocked.length > 0 && (
                  <p className="crx-sub">
                    Carrier hold: {blocked.map((b) => b.name).join(', ')} — review in{' '}
                    <Link to="/settings" className="underline" style={{ color: 'var(--crx-green)' }}>
                      Settings
                    </Link>
                    .
                  </p>
                )}
              </div>
            )}

            {isPracticeOwner && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 crx-panel p-4">
                  <QueueOverview />
                </div>
                <div className="crx-panel p-5">
                  <p className="crx-stat-label mb-2">Open escalations</p>
                  <p className="crx-stat-value">{platform?.openEscalations ?? 0}</p>
                  <Link
                    to="/escalations"
                    className="inline-block mt-3 text-xs font-semibold"
                    style={{ color: 'var(--crx-green)' }}
                  >
                    Review escalations →
                  </Link>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatPanel
                label="Total open A/R"
                value={fmtCurrency(s.totalOpenAR)}
                sub={`${s.openWorkItemCount ?? s.openBalanceCount} claims in queue`}
                badge="Live from PMS"
              />
              <StatPanel
                label="31–60 day exposure"
                value={fmtCurrency(s.aging['31-60'])}
                sub={pct31 > 0 ? `${pct31.toFixed(0)}% of open A/R` : 'Low mid-band risk'}
                badge={pct31 > 40 ? 'Follow up' : 'On track'}
                badgeTone={pct31 > 40 ? 'amber' : 'green'}
              />
              <StatPanel
                label="Claims resolved today"
                value={String(s.claimsResolvedToday ?? 0)}
                sub="Voice agent + manual outcomes"
                badge="Today"
              />
              <StatPanel
                label="Calls placed today"
                value={String(s.telephony?.callsPlacedToday ?? 0)}
                sub={`${Array.isArray(s.telephony?.activeCalls) ? s.telephony.activeCalls.length : 0} active now`}
                badge="Telephony"
              />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="crx-panel p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--crx-t0)', fontFamily: 'var(--crx-fd)' }}>
                      A/R aging profile
                    </h2>
                    <p className="crx-sub">Four-bucket view — same data as Aging Report</p>
                  </div>
                  <Link to="/reports/aging" className="crx-btn-ghost text-xs">
                    Full report
                  </Link>
                </div>
                <div className="space-y-4">
                  {[
                    { key: '0-30', label: 'Current (0–30d)', cents: s.aging['0-30'], color: 'var(--crx-green)', pct: totalAging > 0 ? (s.aging['0-30'] / totalAging) * 100 : 0 },
                    { key: '31-60', label: '31–60 days', cents: s.aging['31-60'], color: 'var(--crx-gold)', pct: pct31 },
                    { key: '>60', label: '90+ days', cents: s.aging['>60'], color: 'var(--crx-red)', pct: pct60 },
                  ].map((row) => (
                    <div key={row.key}>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span style={{ color: 'var(--crx-t2)' }}>{row.label}</span>
                        <span className="font-semibold tabular-nums" style={{ color: 'var(--crx-t0)' }}>
                          {fmtCurrency(row.cents)}
                          <span className="ml-1 font-normal" style={{ color: 'var(--crx-t3)' }}>
                            ({row.pct.toFixed(0)}%)
                          </span>
                        </span>
                      </div>
                      <div className="crx-progress-track h-2">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${row.pct}%`, background: row.color }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="crx-panel p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--crx-t0)', fontFamily: 'var(--crx-fd)' }}>
                      Claim pipeline
                    </h2>
                    <p className="crx-sub">{totalStages} claims across stages</p>
                  </div>
                  <span className="crx-badge crx-badge-green">{fmtCurrency(s.revenueThisWeek ?? 0)} / 7d</span>
                </div>
                <div className="space-y-2 max-h-[220px] overflow-y-auto">
                  {Object.entries(s.stageCounts).length === 0 ? (
                    <p className="crx-sub text-center py-6">No claims in pipeline yet.</p>
                  ) : (
                    Object.entries(s.stageCounts).map(([stage, count]) => {
                      const pct = totalStages > 0 ? (count / totalStages) * 100 : 0
                      return (
                        <div key={stage} className="flex items-center gap-3">
                          <span className="text-xs flex-1 truncate" style={{ color: 'var(--crx-t2)' }}>
                            {STAGE_LABELS[stage] ?? stage}
                          </span>
                          <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--crx-t0)' }}>
                            {count}
                          </span>
                          <div className="w-24 crx-progress-track h-1.5">
                            <div
                              className="h-full rounded-full bg-[var(--crx-green)]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="crx-panel p-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="crx-stat-label">Voice agent &amp; operations</p>
                <p className="crx-sub mt-1 max-w-lg">
                  Configure call windows, carrier rules, and escalation phone in Settings. Front desk staff use the
                  live console for real-time call control.
                </p>
              </div>
              <div className="flex gap-2">
                <Link to="/settings" className="crx-btn-primary">
                  Practice settings
                </Link>
                <Link to="/insurance" className="crx-btn-ghost">
                  Insurance AR
                </Link>
              </div>
            </div>
          </div>
        )
      })()}
    </DataState>
  )
}
