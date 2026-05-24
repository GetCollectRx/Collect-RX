import { useCallback, useEffect, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { apiFetchJson } from '../lib/apiFetch'
import { Card, CardHeader, StatTile, DataState } from './ui'
import type { QueueStats } from '../types/practiceSettings'

function fmtDuration(startedAt: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function QueueOverview() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const [stats, setStats] = useState<QueueStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetchJson<{ success: boolean; data: QueueStats }>(
        `/api/practices/${practiceId}/reports/queue`,
      )
      setStats(res.data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
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

  const busy = practiceLoading || (loading && !stats)

  return (
    <DataState loading={busy} error={error} isEmpty={!busy && !stats} emptyTitle="No queue data">
      {stats && (
        <Card>
          <CardHeader
            title="Queue overview"
            subtitle={
              stats.isPaused
                ? 'Queue paused'
                : stats.isWithinCallWindow
                  ? 'Within call window'
                  : 'Outside call window'
            }
          />
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatTile label="Queued" value={stats.queued} accent="blue" />
            <StatTile label="Held" value={stats.held} accent={stats.held > 0 ? 'amber' : 'default'} />
            <StatTile
              label="Paused"
              value={stats.isPaused ? 'Yes' : 'No'}
              accent={stats.isPaused ? 'amber' : 'green'}
            />
            <StatTile
              label="Active call"
              value={stats.activeCall ? stats.activeCall.claimRef : '—'}
              sub={
                stats.activeCall
                  ? `${stats.activeCall.carrierId.replace(/_/g, ' ')} · ${fmtDuration(stats.activeCall.startedAt)}`
                  : 'None'
              }
              accent={stats.activeCall ? 'green' : 'default'}
            />
            <StatTile label="Resolved today" value={stats.resolvedToday} accent="green" />
          </div>
        </Card>
      )}
    </DataState>
  )
}
