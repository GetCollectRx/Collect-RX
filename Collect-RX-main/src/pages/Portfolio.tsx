import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetchJson } from '../lib/apiFetch'
import {
  Card, CardHeader, StatTile, DataState,
  TableContainer, Table, Thead, Tbody, Tr, Th, Td, Badge,
} from '../components/ui'
import type { AgingBucket, QueueStats } from '../types/practiceSettings'

type PortfolioRow = {
  practice: { id: string; name: string }
  aging: AgingBucket[]
  queueStats: QueueStats
  openEscalations: number
  topCarrierIssue: string | null
}

function fmtMoney(cents: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(cents / 100)
}

function totalAging(buckets: AgingBucket[]): number {
  return buckets.reduce((s, b) => s + b.totalAmount, 0)
}

export default function Portfolio() {
  const [rows, setRows] = useState<PortfolioRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    apiFetchJson<{ success: boolean; data: PortfolioRow[] }>('/api/reports/portfolio')
      .then((res) => setRows(res.data))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  const totalEsc = rows.reduce((s, r) => s + r.openEscalations, 0)
  const totalAr = rows.reduce((s, r) => s + totalAging(r.aging), 0)

  return (
    <DataState loading={loading} error={error} isEmpty={!loading && rows.length === 0} emptyTitle="No portfolio data">
      <div className="page-enter p-6 space-y-6 max-w-[1400px]">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Portfolio Overview</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
            Cross-practice billing operations summary
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatTile label="Practices" value={rows.length} accent="blue" />
          <StatTile label="Total open AR" value={fmtMoney(totalAr)} accent="amber" />
          <StatTile label="Open escalations" value={totalEsc} accent={totalEsc > 0 ? 'red' : 'green'} />
        </div>

        <Card padding="none">
          <div className="p-5 pb-0">
            <CardHeader title="Practices" subtitle="Aging, queue, and escalation snapshot" />
          </div>
          <TableContainer className="border-0 shadow-none rounded-none">
            <Table>
              <Thead>
                <Tr>
                  <Th>Practice</Th>
                  <Th align="right">Open AR</Th>
                  <Th align="right">Queued</Th>
                  <Th align="right">Escalations</Th>
                  <Th>Issue flag</Th>
                  <Th>Queue</Th>
                </Tr>
              </Thead>
              <Tbody>
                {rows.map((r) => (
                  <Tr key={r.practice.id}>
                    <Td bold>
                      <Link to={`/reports/aging?practice=${r.practice.id}`} className="text-crx-600 hover:underline dark:text-crx-400">
                        {r.practice.name}
                      </Link>
                    </Td>
                    <Td align="right">{fmtMoney(totalAging(r.aging))}</Td>
                    <Td align="right">{r.queueStats.queued}</Td>
                    <Td align="right">{r.openEscalations}</Td>
                    <Td>{r.topCarrierIssue ?? 'N/A'}</Td>
                    <Td>
                      {r.queueStats.isPaused ? (
                        <Badge color="amber">Paused</Badge>
                      ) : r.queueStats.isWithinCallWindow ? (
                        <Badge color="green">Active</Badge>
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
