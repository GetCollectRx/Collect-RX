import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import { DataState } from '../components/ui'
import { QueueOverview } from '../components/QueueOverview'
import { LivingStatCard } from '../components/dashboard/LivingStatCard'
import { LivingAgingOrb } from '../components/dashboard/LivingAgingOrb'
import { LivingPipelineFlow } from '../components/dashboard/LivingPipelineFlow'

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

type DashboardBodyProps = {
  stats: DashboardStats
  platform: OwnerPlatformData | null
  practiceName: string | undefined
  isPracticeOwner: boolean
}

function DashboardBody({ stats: s, platform, practiceName, isPracticeOwner }: DashboardBodyProps) {
  const [arCloseMsg, setArCloseMsg] = useState<string | null>(null)

  const totalAging = s.aging['0-30'] + s.aging['31-60'] + s.aging['>60']
  const pct30 = totalAging > 0 ? (s.aging['0-30'] / totalAging) * 100 : 0
  const pct31 = totalAging > 0 ? (s.aging['31-60'] / totalAging) * 100 : 0
  const pct60 = totalAging > 0 ? (s.aging['>60'] / totalAging) * 100 : 0
  const blocked = s.operationalAlerts?.blockedCarriers ?? []
  const activeNow = Array.isArray(s.telephony?.activeCalls) ? s.telephony.activeCalls.length : 0
  const callsToday = s.telephony?.callsPlacedToday ?? 0

  const agingSegments = useMemo(
    () => [
      { id: '0-30', label: 'Current (0–30d)', amount: s.aging['0-30'], color: '#12C96D', pct: pct30 },
      { id: '31-60', label: '31–60 days', amount: s.aging['31-60'], color: '#F0B429', pct: pct31 },
      { id: '60+', label: '90+ days', amount: s.aging['>60'], color: '#FF5C5C', pct: pct60 },
    ],
    [s.aging, pct30, pct31, pct60],
  )

  return (
    <div className="page-enter living-dashboard-bg relative z-[1] p-4 space-y-4 max-w-[1400px]">
      <header className="flex flex-wrap items-start justify-between gap-4 relative z-10">
        <div>
          <p className="crx-section-label mb-1 flex items-center gap-2">
            Practice command center
            {activeNow > 0 && <span className="living-live-chip">Live calls</span>}
          </p>
          <h1 className="crx-h1">{practiceName ?? 'Your practice'}</h1>
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
          <Link to="/reports/aging" className="crx-btn-ghost">
            Aging
          </Link>
          <Link to="/reports/carriers" className="crx-btn-ghost">
            Carriers
          </Link>
          <Link to="/escalations" className="crx-btn-ghost">
            Escalations
          </Link>
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
        <p className="text-xs relative z-10" style={{ color: 'var(--crx-green)' }} role="status">
          {arCloseMsg}
        </p>
      )}

      {(blocked.length > 0 || s.operationalAlerts?.patientPaymentsReady === false) && (
        <div className="crx-alert px-4 py-3 text-sm relative z-10">
          <p className="font-semibold" style={{ color: 'var(--crx-gold)' }}>
            Attention needed
          </p>
          {blocked.length > 0 && (
            <p className="crx-sub mt-1">
              Carrier hold: {blocked.map((b) => b.name).join(', ')} —{' '}
              <Link to="/settings" className="underline" style={{ color: 'var(--crx-green)' }}>
                Settings
              </Link>
            </p>
          )}
        </div>
      )}

      {isPracticeOwner && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 relative z-10">
          <div className="lg:col-span-2 living-chart-panel p-4">
            <QueueOverview />
          </div>
          <LivingStatCard
            label="Open escalations"
            countUp={platform?.openEscalations ?? 0}
            displayValue="0"
            sub="Needs owner decision"
            badge="Action queue"
            tone="amber"
            delayMs={80}
          />
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 relative z-10">
        <LivingStatCard
          label="Total open A/R"
          displayValue={fmtCurrency(s.totalOpenAR)}
          countUp={Math.round(s.totalOpenAR)}
          formatCount={fmtCurrency}
          sub={`${s.openWorkItemCount ?? s.openBalanceCount} claims in queue`}
          badge="Synced live"
          delayMs={0}
        />
        <LivingStatCard
          label="31–60 day exposure"
          displayValue={fmtCurrency(s.aging['31-60'])}
          countUp={Math.round(s.aging['31-60'])}
          formatCount={fmtCurrency}
          sub={pct31 > 0 ? `${pct31.toFixed(0)}% of open A/R` : 'Healthy mid-band'}
          badge={pct31 > 40 ? 'Watch closely' : 'On track'}
          tone={pct31 > 40 ? 'amber' : 'green'}
          delayMs={60}
        />
        <LivingStatCard
          label="Resolved today"
          countUp={s.claimsResolvedToday ?? 0}
          displayValue="0"
          sub="Voice + manual outcomes"
          badge="Today"
          delayMs={120}
        />
        <LivingStatCard
          label="Calls today"
          countUp={callsToday}
          displayValue="0"
          sub={`${activeNow} active right now`}
          badge={activeNow > 0 ? 'On air' : 'Telephony'}
          tone={activeNow > 0 ? 'green' : 'blue'}
          live={activeNow > 0}
          delayMs={180}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 relative z-10">
        <LivingAgingOrb segments={agingSegments} totalAmount={totalAging} amountUnit="dollars" />
        <LivingPipelineFlow
          stageCounts={s.stageCounts}
          revenueWeekCents={Math.round((s.revenueThisWeek ?? 0) * 100)}
        />
      </div>

      <div className="living-chart-panel p-5 flex flex-wrap items-center justify-between gap-4 relative z-10">
        <div>
          <p className="living-chart-title text-base">Voice agent &amp; ops</p>
          <p className="crx-sub mt-1 max-w-lg">
            Tune call windows and carrier rules in Settings — front desk runs the live console when calls are
            in flight.
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
}

export default function Dashboard() {
  const { practiceId, loading: practiceLoading, isPracticeOwner, practice } = usePractice()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [platform, setPlatform] = useState<OwnerPlatformData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      {stats && (
        <DashboardBody
          stats={stats}
          platform={platform}
          practiceName={practice?.name}
          isPracticeOwner={isPracticeOwner}
        />
      )}
    </DataState>
  )
}
