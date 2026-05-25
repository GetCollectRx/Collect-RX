import { useEffect, useMemo, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { apiFetchJson } from '../lib/apiFetch'
import {
  Card, CardHeader, StatTile, DataState, Button,
  TableContainer, Table, Thead, Tbody, Tr, Th, Td,
} from '../components/ui'
import { AgingStackedBarChart } from '../components/AgingStackedBarChart'
import { resolveApiUrl } from '../lib/resolveApiUrl'
import type { AgingBucket, CarrierAgingRow } from '../types/practiceSettings'

type Timeframe = '30d' | '90d' | 'all'

function fmtMoney(cents: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)
}

function exportCsv(rows: CarrierAgingRow[], buckets: AgingBucket[]) {
  const header = ['Carrier', 'Current', '31-60', '61-90', '90+', 'Total']
  const lines = rows.map((r) =>
    [r.carrierName, r.current, r.days31to60, r.days61to90, r.days90plus, r.total]
      .map((v) => (typeof v === 'string' && v.includes(',') ? `"${v}"` : String(v)))
      .join(','),
  )
  const summary = buckets.map((b) => `# ${b.label}: ${b.claimCount} claims, ${b.totalAmount} cents`).join('\n')
  const csv = [summary, header.join(','), ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `aging-report-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function AgingReport() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const [timeframe, setTimeframe] = useState<Timeframe>('30d')
  const [buckets, setBuckets] = useState<AgingBucket[]>([])
  const [carrierRows, setCarrierRows] = useState<CarrierAgingRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    apiFetchJson<{ success: boolean; data: { buckets: AgingBucket[]; carrierRows: CarrierAgingRow[] } }>(
      `/api/practices/${practiceId}/reports/aging?timeframe=${timeframe}`,
    )
      .then((res) => {
        setBuckets(res.data.buckets)
        setCarrierRows(res.data.carrierRows)
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [practiceId, timeframe])

  const totalClaims = useMemo(() => buckets.reduce((s, b) => s + b.claimCount, 0), [buckets])
  const busy = practiceLoading || (loading && buckets.length === 0)

  async function downloadReport(format: 'html' | 'pdf') {
    if (!practiceId) return
    const res = await fetch(resolveApiUrl(`/api/practices/${practiceId}/reports/export`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportType: 'aging', format }),
    })
    if (!res.ok) throw new Error('Export failed')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aging-report.${format === 'pdf' ? 'pdf' : 'html'}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <DataState loading={busy} error={error} isEmpty={!busy && buckets.length === 0} emptyTitle="No aging data">
      <div className="page-enter p-6 space-y-6 max-w-[1400px]">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Aging Report</h1>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
              Open claims by age bucket and carrier
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
              onClick={() => exportCsv(carrierRows, buckets)}
              disabled={carrierRows.length === 0}
            >
              Export CSV
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void downloadReport('html').catch((e) => setError((e as Error).message))}
              disabled={buckets.length === 0}
            >
              Export HTML
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void downloadReport('pdf').catch((e) => setError((e as Error).message))}
              disabled={buckets.length === 0}
            >
              Export PDF
            </Button>
          </div>
        </div>

        {carrierRows.length > 0 && <AgingStackedBarChart rows={carrierRows} />}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {buckets.map((b) => (
            <StatTile
              key={b.label}
              label={b.label}
              value={fmtMoney(b.totalAmount)}
              sub={`${b.claimCount} claims · ${b.percentOfTotal.toFixed(1)}%`}
              accent={b.label === '90+' ? 'red' : b.label === '61–90' ? 'amber' : 'default'}
            />
          ))}
        </div>

        <Card padding="none">
          <div className="p-5 pb-0">
            <CardHeader title="By carrier" subtitle={`${totalClaims} open claims across carriers`} />
          </div>
          <TableContainer className="border-0 shadow-none rounded-none">
            <Table>
              <Thead>
                <Tr>
                  <Th>Carrier</Th>
                  <Th align="right">Current</Th>
                  <Th align="right">31–60</Th>
                  <Th align="right">61–90</Th>
                  <Th align="right">90+</Th>
                  <Th align="right">Total</Th>
                </Tr>
              </Thead>
              <Tbody>
                {carrierRows.map((r) => (
                  <Tr key={r.carrierId}>
                    <Td>{r.carrierName}</Td>
                    <Td align="right">{fmtMoney(r.current)}</Td>
                    <Td align="right">{fmtMoney(r.days31to60)}</Td>
                    <Td align="right">{fmtMoney(r.days61to90)}</Td>
                    <Td align="right">{fmtMoney(r.days90plus)}</Td>
                    <Td align="right" className="font-semibold">{fmtMoney(r.total)}</Td>
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
