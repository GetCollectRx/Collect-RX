import { useCallback, useEffect, useState } from 'react'
import { apiFetchJson } from '../lib/apiFetch'
import {
  Card, CardHeader, StatTile, DataState, Badge,
  TableContainer, Table, Thead, Tbody, Tr, Th, Td,
} from '../components/ui'
import type { QueueStats } from '../types/practiceSettings'

type PracticeQueueStat = QueueStats & {
  practice: { id: string; name: string }
}

const REFRESH_MS = 30_000

export default function SystemHealth() {
  const [stats, setStats] = useState<PracticeQueueStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await apiFetchJson<{ success: boolean; data: PracticeQueueStat[] }>(
        '/api/admin/queue/stats',
      )
      setStats(res.data)
      setLastRefresh(new Date())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  const totalQueued = stats.reduce((s, r) => s + r.queued, 0)
  const totalHeld = stats.reduce((s, r) => s + r.held, 0)
  const activeCount = stats.filter((r) => r.activeCall).length
  const pausedCount = stats.filter((r) => r.isPaused).length

  return (
    <DataState loading={loading && stats.length === 0} error={error} isEmpty={!loading && stats.length === 0} emptyTitle="No queue stats">
      <div className="page-enter p-6 space-y-6 max-w-[1400px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">System Health</h1>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
              Platform-wide queue status — auto-refreshes every 30s
            </p>
          </div>
          {lastRefresh && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Updated {lastRefresh.toLocaleTimeString('en-CA')}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Practices" value={stats.length} accent="blue" />
          <StatTile label="Total queued" value={totalQueued} accent="blue" />
          <StatTile label="Active calls" value={activeCount} accent="green" />
          <StatTile label="Paused queues" value={pausedCount} accent={pausedCount > 0 ? 'amber' : 'default'} />
        </div>

        {totalHeld > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {totalHeld} held call{totalHeld !== 1 ? 's' : ''} across the platform
          </p>
        )}

        <Card padding="none">
          <div className="p-5 pb-0">
            <CardHeader title="Per-practice queue" />
          </div>
          <TableContainer className="border-0 shadow-none rounded-none">
            <Table>
              <Thead>
                <Tr>
                  <Th>Practice</Th>
                  <Th align="right">Queued</Th>
                  <Th align="right">Held</Th>
                  <Th>Active call</Th>
                  <Th align="right">Resolved today</Th>
                  <Th>Status</Th>
                </Tr>
              </Thead>
              <Tbody>
                {stats.map((r) => (
                  <Tr key={r.practice.id}>
                    <Td bold>{r.practice.name}</Td>
                    <Td align="right">{r.queued}</Td>
                    <Td align="right">{r.held}</Td>
                    <Td>{r.activeCall?.claimRef ?? '—'}</Td>
                    <Td align="right">{r.resolvedToday}</Td>
                    <Td>
                      {r.isPaused ? (
                        <Badge color="amber">Paused</Badge>
                      ) : r.activeCall ? (
                        <Badge color="green">On call</Badge>
                      ) : r.isWithinCallWindow ? (
                        <Badge color="blue">Ready</Badge>
                      ) : (
                        <Badge color="gray">Off hours</Badge>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </TableContainer>
        </Card>
      </div>
    </DataState>
  )
}
