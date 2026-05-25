import { useEffect, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { apiFetchJson } from '../lib/apiFetch'
import { resolveApiUrl } from '../lib/resolveApiUrl'
import {
  Card, CardHeader, Badge, DataState,
  TableContainer, Table, Thead, Tbody, Tr, Th, Td, Button,
} from '../components/ui'
import type { CarrierStatRow } from '../types/practiceSettings'

type Timeframe = '30d' | '90d' | 'all'

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

const trendColor: Record<CarrierStatRow['trend'], 'green' | 'amber' | 'gray'> = {
  improving: 'green',
  declining: 'amber',
  stable: 'gray',
}

export default function CarrierStats() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const [timeframe, setTimeframe] = useState<Timeframe>('30d')
  const [stats, setStats] = useState<CarrierStatRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    apiFetchJson<{ success: boolean; data: { stats: CarrierStatRow[] } }>(
      `/api/practices/${practiceId}/reports/carriers?timeframe=${timeframe}`,
    )
      .then((res) => setStats(res.data.stats))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [practiceId, timeframe])

  const busy = practiceLoading || (loading && stats.length === 0)

  async function downloadReport(format: 'html' | 'pdf') {
    if (!practiceId) return
    const res = await fetch(resolveApiUrl(`/api/practices/${practiceId}/reports/export`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportType: 'carriers', format }),
    })
    if (!res.ok) throw new Error('Export failed')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `carrier-stats.${format === 'pdf' ? 'pdf' : 'html'}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <DataState loading={busy} error={error} isEmpty={!busy && stats.length === 0} emptyTitle="No carrier stats">
      <div className="page-enter p-6 space-y-6 max-w-[1400px]">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Carrier Performance</h1>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
              Call success rates, duration, and denial patterns
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(['30d', '90d', 'all'] as Timeframe[]).map((tf) => (
              <Button
                key={tf}
                size="sm"
                variant={timeframe === tf ? 'primary' : 'secondary'}
                onClick={() => setTimeframe(tf)}
              >
                {tf === 'all' ? 'All time' : tf}
              </Button>
            ))}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void downloadReport('html').catch((e) => setError((e as Error).message))}
              disabled={stats.length === 0}
            >
              Export HTML
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void downloadReport('pdf').catch((e) => setError((e as Error).message))}
              disabled={stats.length === 0}
            >
              Export PDF
            </Button>
          </div>
        </div>

        <Card padding="none">
          <div className="p-5 pb-0">
            <CardHeader title="Carrier stats" subtitle={`${stats.length} carriers with activity`} />
          </div>
          <TableContainer className="border-0 shadow-none rounded-none">
            <Table>
              <Thead>
                <Tr>
                  <Th>Carrier</Th>
                  <Th align="right">Claims</Th>
                  <Th align="right">Success rate</Th>
                  <Th align="right">Avg duration</Th>
                  <Th align="right">Avg attempts</Th>
                  <Th>Top denial</Th>
                  <Th>Trend</Th>
                </Tr>
              </Thead>
              <Tbody>
                {stats.map((r) => (
                  <Tr key={r.carrierId}>
                    <Td>{r.carrierName}</Td>
                    <Td align="right">{r.totalClaims}</Td>
                    <Td align="right">{r.successRate.toFixed(1)}%</Td>
                    <Td align="right">{fmtDuration(r.avgCallDurationSeconds)}</Td>
                    <Td align="right">{r.avgAttempts.toFixed(1)}</Td>
                    <Td className="max-w-[200px] truncate">{r.topDenialReason ?? '—'}</Td>
                    <Td>
                      <Badge color={trendColor[r.trend]}>{r.trend}</Badge>
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
