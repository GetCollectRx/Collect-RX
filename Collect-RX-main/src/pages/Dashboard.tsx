import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { apiFetchJson } from '../lib/apiFetch'
import {
  PracticeHealthBrief,
  type HealthActionItem,
  type HealthBriefMetrics,
} from '../components/dashboard/PracticeHealthBrief'
import type { DashboardLastPmsImport } from '../components/dashboard/PmsSyncBanner'
import type { PracticePmsInfo } from '../types/pms'

interface RecoveryMetricsSnapshot {
  dollarsRecoveredSyncVerified: number
  dollarsRecoveredSyncVerifiedLast30Days: number
  blockingGatesOpen: number
  awaitingSyncVerification: number
}

interface RecoveryNotificationItem {
  id: string
  kind: 'blocking_gate' | 'payment_trace_due'
  severity: 'info' | 'warning'
  title: string
  detail: string
  href: string
}

interface DashboardStats {
  totalOpenAR: number
  aging: { '0-30': number; '31-60': number; '>60': number }
  openBalanceCount: number
  openWorkItemCount?: number
  claimsResolvedToday?: number
  telephony?: { callsPlacedToday: number | null; activeCalls: unknown[] }
  pms?: PracticePmsInfo
  lastPmsImport?: DashboardLastPmsImport | null
  recoveryMetrics?: RecoveryMetricsSnapshot | null
}

interface OwnerPlatformData {
  openEscalations: number
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

  if (metrics.blockingGatesOpen > 0 && !items.some((i) => i.href.includes('/gates'))) {
    items.unshift({
      id: 'gates-summary',
      severity: 'urgent',
      title: `${metrics.blockingGatesOpen} practice gate${metrics.blockingGatesOpen === 1 ? '' : 's'} open`,
      detail: 'Resubmit, missing docs, or human verify, clear these to keep agents moving.',
      href: '/insurance/gates',
    })
  }

  if (metrics.openEscalations > 0 && !items.some((i) => i.href.includes('/escalations'))) {
    items.unshift({
      id: 'escalations-summary',
      severity: 'urgent',
      title: `${metrics.openEscalations} open escalation${metrics.openEscalations === 1 ? '' : 's'}`,
      detail: 'Claims that need an owner decision before the next call batch.',
      href: '/escalations',
    })
  }

  return items
}

export default function Dashboard() {
  const { practiceId, loading: practiceLoading, isPracticeOwner, practice } = usePractice()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [platform, setPlatform] = useState<OwnerPlatformData | null>(null)
  const [recoveryNotifications, setRecoveryNotifications] = useState<RecoveryNotificationItem[]>([])
  const [loading, setLoading] = useState(false)
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
    void loadDashboard()
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [loadDashboard])

  const metrics = useMemo(() => buildMetrics(stats, platform), [stats, platform])
  const actions = useMemo(
    () => buildActions(recoveryNotifications, metrics),
    [recoveryNotifications, metrics],
  )

  const dataBusy = practiceLoading || (loading && !stats && !error)
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
    </div>
  )
}
