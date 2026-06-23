import { useEffect, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { apiFetchJson } from '../lib/apiFetch'
import { QueueOverview } from '../components/QueueOverview'
import { Card, CardHeader, DataState, StatTile } from '../components/ui'
import type { QueueStats } from '../types/practiceSettings'

export default function QueueStatsReport() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const [stats, setStats] = useState<QueueStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    apiFetchJson<{ success: boolean; data: QueueStats }>(
      `/api/practices/${practiceId}/reports/queue`,
    )
      .then((res) => setStats(res.data))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [practiceId])

  const busy = practiceLoading || (loading && !stats)

  return (
    <DataState loading={busy} error={error}>
      <div className="page-enter p-6 space-y-6 max-w-[1400px]">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Queue Stats</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
            Read-only queue metrics for audit review
          </p>
        </div>

        <QueueOverview />

        {stats && (
          <Card>
            <CardHeader title="Operational flags" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatTile
                label="Call window"
                value={stats.isWithinCallWindow ? 'Open' : 'Closed'}
                accent={stats.isWithinCallWindow ? 'green' : 'amber'}
              />
              <StatTile
                label="Queue state"
                value={stats.isPaused ? 'Paused' : 'Running'}
                accent={stats.isPaused ? 'amber' : 'green'}
              />
              <StatTile label="Pending calls" value={stats.queued} accent="blue" />
              <StatTile label="Blocked / held" value={stats.held} accent={stats.held > 0 ? 'red' : 'default'} />
            </div>
          </Card>
        )}
      </div>
    </DataState>
  )
}
