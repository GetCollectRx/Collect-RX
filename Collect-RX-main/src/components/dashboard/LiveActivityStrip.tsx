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
      // strip is optional — queue overview may show errors elsewhere
    }
  }, [practiceId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!stats?.activeCall) return
    const id = setInterval(() => setStats((s) => (s ? { ...s } : s)), 1000)
    return () => clearInterval(id)
  }, [stats?.activeCall?.startedAt])

  const active = stats?.activeCall
  if (!active) return null

  return (
    <div
      className="relative z-10 rounded-xl border border-crx-500/40 bg-crx-500/10 dark:bg-crx-500/15 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
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
  )
}
