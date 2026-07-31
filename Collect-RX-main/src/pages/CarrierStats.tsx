import { useEffect, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { apiFetchJson } from '../lib/apiFetch'
import { resolveApiUrl } from '../lib/resolveApiUrl'
import {
  Card, CardHeader, Badge, DataState, StatTile,
  TableContainer, Table, Thead, Tbody, Tr, Th, Td, Button,
} from '../components/ui'
import type { CarrierStatRow, DenialAnalyticsSnapshot } from '../types/practiceSettings'

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
  const [denials, setDenials] = useState<DenialAnalyticsSnapshot | null>(null)
  const [carrierFeed, setCarrierFeed] = useState<Array<{ id: string; carrierId: string; recommendation: string; category: string }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    apiFetchJson<{ success: boolean; data: { stats: CarrierStatRow[]; denialAnalytics: DenialAnalyticsSnapshot } }>(
      `/api/practices/${practiceId}/reports/carriers?timeframe=${timeframe}`,
    )
      .then((res) => {
        setStats(res.data.stats)
        setDenials(res.data.denialAnalytics)
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
    apiFetchJson<{ success: boolean; data: Array<{ id: string; carrierId: string; recommendation: string; category: string }> }>(
      '/api/insurance/carrier-intelligence/feed',
    )
      .then((res) => setCarrierFeed(res.data ?? []))
      .catch(() => setCarrierFeed([]))
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

        {denials && (denials.topDenialReasons.length > 0 || denials.appealWinRate > 0) && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <StatTile
                label="Appeal win rate"
                value={`${denials.appealWinRate.toFixed(0)}%`}
                sub="Denied claims later resolved by follow-up"
                accent="green"
              />
              <StatTile
                label="Avg days to resolution"
                value={denials.avgDaysToResolution}
                sub="From first call to confirmed payment"
                accent="blue"
              />
            </div>
            {denials.topDenialReasons.length > 0 && (
              <Card padding="none">
                <div className="p-5 pb-0">
                  <CardHeader
                    title="Top denial reasons"
                    subtitle="Most common reasons carriers give for denying claims, use these to spot patterns in your submissions"
                  />
                </div>
                <TableContainer className="border-0 shadow-none rounded-none">
                  <Table>
                    <Thead>
                      <Tr>
                        <Th>Reason</Th>
                        <Th align="right">Occurrences</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {denials.topDenialReasons.map((r) => (
                        <Tr key={r.reason}>
                          <Td className="max-w-[600px]">{r.reason}</Td>
                          <Td align="right">{r.count}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </TableContainer>
              </Card>
            )}
          </div>
        )}

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
                    <Td className="max-w-[200px] truncate">{r.topDenialReason ?? 'N/A'}</Td>
                    <Td>
                      <Badge color={trendColor[r.trend]}>{r.trend}</Badge>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </TableContainer>
        </Card>

        {carrierFeed.length > 0 && (
          <Card>
            <CardHeader
              title="Carrier intelligence feed"
              subtitle="Human-approved operational lessons from recent carrier calls (no PHI)"
            />
            <ul className="px-5 pb-5 space-y-3 text-sm">
              {carrierFeed.slice(0, 8).map((item) => (
                <li key={item.id} className="border-b border-gray-100 dark:border-gray-800 pb-2 last:border-0">
                  <Badge>{item.category.replace(/_/g, ' ')}</Badge>
                  <span className="ml-2 text-gray-500">{item.carrierId}</span>
                  <p className="mt-1 text-gray-800 dark:text-gray-200">{item.recommendation}</p>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </DataState>
  )
}
