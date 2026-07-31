import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../../context/PracticeContext'
import { apiFetchJson } from '../../lib/apiFetch'
import { carrierLabel, isDemoVapiCall } from '../../lib/recoveryDisplay'
import { SimulatedCallBadge } from '../claims/SimulatedCallBadge'
import type { QueueStats } from '../../types/practiceSettings'

function fmtDuration(startedAt: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function LiveActivityStrip() {
  const { practiceId } = usePractice()
  const [stats, setStats] = useState<QueueStats | null>(null)

  const load = useCallback(async () => {
    if (!practiceId) return
    try {
      const res = await apiFetchJson<{ success: boolean; data: QueueStats }>(
        `/api/practices/${practiceId}/reports/queue`,
      )
      setStats(res.data)
    } catch {
      // strip is optional — errors surface on Claims queue tab
    }
  }, [practiceId])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 30_000)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    if (!stats?.activeCall) return
    const id = setInterval(() => setStats((s) => (s ? { ...s } : s)), 1000)
    return () => clearInterval(id)
  }, [stats?.activeCall?.startedAt])

  const active = stats?.activeCall
  if (!stats && !active) return null

  const windowLabel = stats?.isPaused
    ? 'Queue paused'
    : stats?.isWithinCallWindow
      ? 'Within call window'
      : 'Outside call window'

  return (
    <div className="relative z-10 space-y-2" role="region" aria-label="Call queue activity">
      {active && (
        <div
          className="rounded-xl border border-crx-500/40 bg-crx-500/10 dark:bg-crx-500/15 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <span className="living-live-chip shrink-0">Live call</span>
            {isDemoVapiCall(active.vapiCallId) && <SimulatedCallBadge className="shrink-0" />}
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {active.claimRef}
            </p>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {carrierLabel(active.carrierId)}
            </span>
            <span className="text-sm font-mono tabular-nums text-crx-600 dark:text-crx-400">
              {fmtDuration(active.startedAt)}
            </span>
          </div>
          <Link
            to={`/insurance/${active.claimId}`}
            className="crx-btn-ghost shrink-0 text-sm"
          >
            View claim →
          </Link>
        </div>
      )}

      {stats && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-700 dark:text-gray-300">
            <span className="font-semibold text-gray-900 dark:text-gray-100">In progress</span>
            <span>
              <span className="text-gray-500 dark:text-gray-500">Queued</span>{' '}
              <span className="font-semibold tabular-nums">{stats.queued}</span>
            </span>
            <span>
              <span className="text-gray-500 dark:text-gray-500">Held</span>{' '}
              <span className={`font-semibold tabular-nums ${stats.held > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                {stats.held}
              </span>
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-500">{windowLabel}</span>
            <span>
              <span className="text-gray-500 dark:text-gray-500">Resolved today</span>{' '}
              <span className="font-semibold tabular-nums text-green-700 dark:text-green-400">
                {stats.resolvedToday}
              </span>
            </span>
          </div>
          <Link to="/insurance?tab=queue" className="crx-btn-ghost shrink-0 text-sm">
            Open priority queue →
          </Link>
        </div>
      )}
    </div>
  )
}
