import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import {
  PracticeHealthBrief,
  type HealthActionItem,
  type HealthBriefMetrics,
} from '../components/dashboard/PracticeHealthBrief'
import { LiveActivityStrip } from '../components/dashboard/LiveActivityStrip'
import { TopMoneyAtRisk } from '../components/dashboard/TopMoneyAtRisk'
import { LivingStatCard } from '../components/dashboard/LivingStatCard'
import { LivingAgingOrb } from '../components/dashboard/LivingAgingOrb'
import { LivingPipelineFlow } from '../components/dashboard/LivingPipelineFlow'
import { SubscriptionUsageCard } from '../components/SubscriptionUsageCard'
import { PlanUsageBanner } from '../components/PlanUsageBanner'
import { PmsSyncBanner, type DashboardLastPmsImport } from '../components/dashboard/PmsSyncBanner'
import type { PracticePmsInfo } from '../types/pms'

interface RecoveryMetricsSnapshot {
  dollarsRecoveredSyncVerified: number
  dollarsRecoveredSyncVerifiedLast30Days: number
  recoveryRatePct: number | null
  cohortRecoveryRatePct?: number | null
  medianTimeToSyncVerifyHours?: number | null
  medianGateClearanceHours?: number | null
  syncVerifiedToday: number
  paymentsVerifiedBySync: number
  openInsuranceOutstanding: number
  blockingGatesOpen: number
  awaitingSyncVerification: number
}

interface RecoveryNotificationItem {
  id: string
  kind: 'blocking_gate' | 'payment_trace_due'
  severity: 'info' | 'warning'
  title: string
  detail: string
  claimId: string
  claimNumber: string
  href: string
}

interface DashboardStats {
  totalOpenAR: number
  aging: { '0-30': number; '31-60': number; '>60': number }
  stageCounts: Record<string, number>
  openBalanceCount: number
  openWorkItemCount?: number
  claimsResolvedToday?: number
  revenueThisWeek?: number
  telephony?: { callsPlacedToday: number | null; activeCalls: unknown[] }
  pms?: PracticePmsInfo
  lastPmsImport?: DashboardLastPmsImport | null
  operationalAlerts?: {
    blockedCarriers: { code: string; name: string }[]
    decliningCarriers?: { code: string; name: string; successRate: number }[]
  }
  recoveryMetrics?: RecoveryMetricsSnapshot | null
}

interface OwnerPlatformData {
  openEscalations: number
}

const DASHBOARD_STATS_CACHE_PREFIX = 'crx_dashboard_stats_'

function readCachedStats(practiceId: string): DashboardStats | null {
  try {
    const raw = sessionStorage.getItem(`${DASHBOARD_STATS_CACHE_PREFIX}${practiceId}`)
    if (!raw) return null
    return JSON.parse(raw) as DashboardStats
  } catch {
    return null
  }
}

function writeCachedStats(practiceId: string, stats: DashboardStats) {
  try {
    sessionStorage.setItem(`${DASHBOARD_STATS_CACHE_PREFIX}${practiceId}`, JSON.stringify(stats))
  } catch {
    // ignore quota / private mode
  }
}

const EMPTY_METRICS: HealthBriefMetrics = {
  totalOpenAR: 0,
  openWorkItemCount: 0,
  agingOver60: 0,
  claimsResolvedToday: 0,
  callsToday: 0,
  activeCalls: 0,
  blockingGatesOpen: 0,
  recovered30d: 0,
  recoveredAllTime: 0,
  awaitingSync: 0,
  openEscalations: 0,
}

function fmtCurrency(v: number) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(v)
}

function buildMetrics(
  stats: DashboardStats | null,
  platform: OwnerPlatformData | null,
): HealthBriefMetrics {
  if (!stats) return EMPTY_METRICS
  const rm = stats.recoveryMetrics
  const activeCalls = Array.isArray(stats.telephony?.activeCalls)
    ? stats.telephony.activeCalls.length
    : 0
  return {
    totalOpenAR: stats.totalOpenAR,
    openWorkItemCount: stats.openWorkItemCount ?? stats.openBalanceCount,
    agingOver60: stats.aging['>60'],
    claimsResolvedToday: stats.claimsResolvedToday ?? 0,
    callsToday: stats.telephony?.callsPlacedToday ?? 0,
    activeCalls,
    blockingGatesOpen: rm?.blockingGatesOpen ?? 0,
    recovered30d: rm?.dollarsRecoveredSyncVerifiedLast30Days ?? 0,
    recoveredAllTime: rm?.dollarsRecoveredSyncVerified ?? 0,
    awaitingSync: rm?.awaitingSyncVerification ?? 0,
    openEscalations: platform?.openEscalations ?? 0,
  }
}

function buildActions(
  notifications: RecoveryNotificationItem[],
  metrics: HealthBriefMetrics,
): HealthActionItem[] {
  const items: HealthActionItem[] = notifications.map((n) => ({
    id: n.id,
    severity: n.severity === 'warning' ? 'urgent' : 'watch',
    title: n.title,
    detail: n.detail,
    href: n.href,
  }))

  if (metrics.blockingGatesOpen > 0 && !items.some((i) => i.href.includes('tab=blocked'))) {
    items.unshift({
      id: 'gates-summary',
      severity: 'urgent',
      title: `${metrics.blockingGatesOpen} practice gate${metrics.blockingGatesOpen === 1 ? '' : 's'} open`,
      detail: 'Resubmit, missing docs, or human verify, clear these to keep agents moving.',
      href: '/insurance?tab=blocked',
    })
  }

  if (metrics.openEscalations > 0 && !items.some((i) => i.href.includes('tab=human'))) {
    items.unshift({
      id: 'escalations-summary',
      severity: 'urgent',
      title: `${metrics.openEscalations} claim${metrics.openEscalations === 1 ? '' : 's'} need human review`,
      detail: 'Review on Claims before the next carrier call batch.',
      href: '/insurance?tab=human',
    })
  }

  return items
}

type DashboardBodyProps = {
  stats: DashboardStats
  platform: OwnerPlatformData | null
  isPracticeOwner: boolean
  canManageSync: boolean
  recoveryNotifications: RecoveryNotificationItem[]
}

function DashboardBody({
  stats: s,
  platform,
  isPracticeOwner,
  canManageSync,
  recoveryNotifications,
}: DashboardBodyProps) {
  const [arCloseMsg, setArCloseMsg] = useState<string | null>(null)

  const totalAging = s.aging['0-30'] + s.aging['31-60'] + s.aging['>60']
  const pct31 = totalAging > 0 ? (s.aging['31-60'] / totalAging) * 100 : 0
  const blocked = s.operationalAlerts?.blockedCarriers ?? []
  const declining = s.operationalAlerts?.decliningCarriers ?? []
  const activeNow = Array.isArray(s.telephony?.activeCalls) ? s.telephony.activeCalls.length : 0
  const callsToday = s.telephony?.callsPlacedToday ?? 0
  const rm = s.recoveryMetrics

  const agingSegments = useMemo(
    () => {
      const pct30 = totalAging > 0 ? (s.aging['0-30'] / totalAging) * 100 : 0
      const pct60 = totalAging > 0 ? (s.aging['>60'] / totalAging) * 100 : 0
      return [
        { id: '0-30', label: 'Current (0–30d)', amount: s.aging['0-30'], color: '#12C96D', pct: pct30 },
        { id: '31-60', label: '31–60 days', amount: s.aging['31-60'], color: '#F0B429', pct: pct31 },
        { id: '60+', label: '90+ days', amount: s.aging['>60'], color: '#FF5C5C', pct: pct60 },
      ]
    },
    [s.aging, pct31, totalAging],
  )

  return (
    <div className="page-enter living-dashboard-bg relative z-[1] p-4 space-y-4 max-w-[1400px] border-t border-[var(--crx-bdr)] mt-2">
      <header className="flex flex-wrap items-center justify-between gap-4 relative z-10 pt-2">
        <div>
          <p className="crx-section-label mb-1 flex items-center gap-2">
            Live command center
            {activeNow > 0 && <span className="living-live-chip">Live calls</span>}
          </p>
          <p className="crx-sub">Charts, queue depth, and recovery detail from your practice data.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/reports/aging" className="crx-btn-ghost">
            Aging
          </Link>
          <Link to="/reports/carriers" className="crx-btn-ghost">
            Carriers
          </Link>
          <Link to="/insurance?tab=human" className="crx-btn-ghost">
            Needs human
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

      <LiveActivityStrip />

      <TopMoneyAtRisk />

      <SubscriptionUsageCard compact className="relative z-10" />

      <div className="relative z-10 space-y-3">
        <PlanUsageBanner />
        {s.pms && (
          <PmsSyncBanner
            pms={s.pms}
            lastImport={s.lastPmsImport ?? null}
            canManageSync={canManageSync}
          />
        )}
      </div>

      {(blocked.length > 0) && (
        <div className="crx-alert px-4 py-3 text-sm relative z-10">
          <p className="font-semibold" style={{ color: 'var(--crx-gold)' }}>
            Attention needed
          </p>
          {blocked.length > 0 && (
            <p className="crx-sub mt-1">
              Carrier hold: {blocked.map((b) => b.name).join(', ')}.{' '}
              <Link to="/settings" className="underline" style={{ color: 'var(--crx-green)' }}>
                Settings
              </Link>
            </p>
          )}
        </div>
      )}

      {declining.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-900/20 p-4 space-y-1 relative z-10">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Carrier response trend declining
          </p>
          <p className="text-sm text-amber-800 dark:text-amber-300">
            {declining.map((c) => `${c.name} (${c.successRate.toFixed(0)}% success)`).join(', ')}.{' '}
            <Link to="/reports/carriers" className="underline">
              Carrier Performance
            </Link>
          </p>
        </div>
      )}

      {rm && recoveryNotifications.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-900/20 p-4 space-y-2 relative z-10">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Recovery attention ({recoveryNotifications.filter((n) => n.severity === 'warning').length} urgent)
          </p>
          <ul className="text-sm space-y-1">
            {recoveryNotifications.slice(0, 5).map((n) => (
              <li key={n.id}>
                <Link to={n.href} className="text-amber-800 dark:text-amber-300 underline">
                  {n.claimNumber}
                </Link>
                {' · '}
                {n.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rm && (
        <div className="living-chart-panel p-5 relative z-10 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="living-chart-title text-base">Insurance recovery loop</p>
              <p className="crx-sub mt-1 max-w-xl">
                Money confirmed when your PMS sync drops the balance, not call status alone.
              </p>
            </div>
            <Link to="/insurance" className="crx-btn-ghost shrink-0">
              Open Claims →
            </Link>
            {(rm.blockingGatesOpen ?? 0) > 0 && (
              <Link to="/insurance?tab=blocked" className="crx-btn-primary shrink-0">
                Blocked gates ({rm.blockingGatesOpen})
              </Link>
            )}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <LivingStatCard
              label="$ at risk over 60 days"
              displayValue={fmtCurrency(s.aging['>60'])}
              countUp={Math.round(s.aging['>60'])}
              formatCount={fmtCurrency}
              sub={`${fmtCurrency(s.totalOpenAR)} total open insurance A/R`}
              badge={s.aging['>60'] > 0 ? 'Focus here' : 'Healthy'}
              tone={s.aging['>60'] > s.totalOpenAR * 0.25 ? 'amber' : 'green'}
              delayMs={0}
            />
            <LivingStatCard
              label="Sync-verified recovery (30d)"
              displayValue={fmtCurrency(rm.dollarsRecoveredSyncVerifiedLast30Days)}
              countUp={Math.round(rm.dollarsRecoveredSyncVerifiedLast30Days)}
              formatCount={fmtCurrency}
              sub={`${fmtCurrency(rm.dollarsRecoveredSyncVerified)} all-time · PMS confirmed`}
              badge="North star"
              tone="green"
              delayMs={40}
            />
            <LivingStatCard
              label="Practice gates open"
              countUp={rm.blockingGatesOpen}
              displayValue="0"
              sub="Resubmit, docs, or human verify"
              badge={rm.blockingGatesOpen > 0 ? 'Action needed' : 'Clear'}
              tone={rm.blockingGatesOpen > 0 ? 'amber' : 'green'}
              delayMs={80}
            />
            <LivingStatCard
              label="Awaiting PMS sync"
              countUp={rm.awaitingSyncVerification}
              displayValue="0"
              sub={
                rm.cohortRecoveryRatePct != null
                  ? `${rm.cohortRecoveryRatePct.toFixed(1)}% cohort recovery (30d)`
                  : rm.medianTimeToSyncVerifyHours != null
                    ? `Median ${rm.medianTimeToSyncVerifyHours}h to sync verify`
                    : 'Carrier approved, balance pending'
              }
              badge="Checking PMS"
              tone="blue"
              delayMs={120}
            />
          </div>
        </div>
      )}

      {isPracticeOwner && (
        <div className="relative z-10">
          <LivingStatCard
            label="Needs human review"
            countUp={platform?.openEscalations ?? 0}
            displayValue="0"
            sub="Escalated claims on Claims tab"
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
    </div>
  )
}

export default function Dashboard() {
  const {
    practiceId,
    loading: practiceLoading,
    isPracticeOwner,
    practice,
    isPlatformDev,
    role,
  } = usePractice()
  const canManageSync =
    isPracticeOwner || isPlatformDev || role === 'office_manager' || role === 'billing_coordinator'
  const [stats, setStats] = useState<DashboardStats | null>(() =>
    practiceId ? readCachedStats(practiceId) : null,
  )
  const [platform, setPlatform] = useState<OwnerPlatformData | null>(null)
  const [recoveryNotifications, setRecoveryNotifications] = useState<RecoveryNotificationItem[]>([])
  const [loading, setLoading] = useState(() => Boolean(practiceId && !readCachedStats(practiceId)))
  const [error, setError] = useState<string | null>(null)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadDashboard = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!practiceId) return
    if (!opts?.quiet) {
      setLoading(true)
      setError(null)
    }
    try {
      const [dash, notifRes, plat] = await Promise.all([
        apiFetchJson<DashboardStats>(`/api/dashboard/stats?practiceId=${practiceId}`),
        apiFetchJson<{ success: boolean; data: RecoveryNotificationItem[] }>(
          `/api/insurance/recovery/notifications?practiceId=${practiceId}`,
        ).catch(() => ({ success: true, data: [] as RecoveryNotificationItem[] })),
        isPracticeOwner
          ? apiFetchJson<{ success: boolean; data: OwnerPlatformData }>(
              `/api/practices/${practiceId}/dashboard`,
            )
              .then((r) => r.data)
              .catch(() => null)
          : Promise.resolve(null),
      ])
      setStats(dash)
      writeCachedStats(practiceId, dash)
      setRecoveryNotifications(notifRes.data ?? [])
      setPlatform(plat)
      setError(null)
    } catch (e) {
      const msg = (e as Error).message
      const rateLimited = /too many requests|rate limit/i.test(msg)
      setError(
        rateLimited
          ? 'Live numbers are catching up. Your home page is ready; we will refresh shortly.'
          : msg,
      )
      if (rateLimited) {
        if (retryTimer.current) clearTimeout(retryTimer.current)
        retryTimer.current = setTimeout(() => {
          void loadDashboard({ quiet: true })
        }, 4000)
      }
    } finally {
      if (!opts?.quiet) setLoading(false)
    }
  }, [practiceId, isPracticeOwner])

  useEffect(() => {
    if (!practiceId) {
      setStats(null)
      setLoading(false)
      return
    }
    const cached = readCachedStats(practiceId)
    if (cached) setStats(cached)
    void loadDashboard({ quiet: Boolean(cached) })
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [loadDashboard, practiceId])

  const metrics = useMemo(() => buildMetrics(stats, platform), [stats, platform])
  const actions = useMemo(
    () => buildActions(recoveryNotifications, metrics),
    [recoveryNotifications, metrics],
  )

  const dataBusy = loading && !stats
  const practiceName = practice?.name ?? 'Your practice'

  if (!practiceId && !practiceLoading) {
    return (
      <div className="practice-health-brief page-enter p-6">
        <p className="crx-section-label">Practice health</p>
        <h1 className="crx-h1">Connect to your practice</h1>
        <p className="crx-sub mt-2 max-w-md">
          We couldn&apos;t load your practice session. Sign out and sign in again, or contact support if
          this keeps happening.
        </p>
      </div>
    )
  }

  return (
    <div>
      {error && (
        <div className="mx-6 mt-4 crx-alert px-4 py-3 text-sm" role="alert">
          <p className="font-semibold" style={{ color: 'var(--crx-red)' }}>
            Couldn&apos;t refresh all numbers
          </p>
          <p className="crx-sub mt-1">{error}</p>
        </div>
      )}
      <PracticeHealthBrief
        practiceName={practiceName}
        metrics={metrics}
        actions={actions}
        pms={stats?.pms}
        lastImport={stats?.lastPmsImport}
        loading={dataBusy}
      />
      {stats && (
        <DashboardBody
          stats={stats}
          platform={platform}
          isPracticeOwner={isPracticeOwner}
          canManageSync={canManageSync}
          recoveryNotifications={recoveryNotifications}
        />
      )}
    </div>
  )
}
