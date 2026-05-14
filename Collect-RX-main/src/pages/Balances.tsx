import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { apiFetchJson } from '../lib/apiFetch'
import {
  Button, StageBadge, Select, Input, DataState,
  TableContainer, Table, Thead, Tbody, Th, Tr, Td, TableEmpty,
  Badge,
} from '../components/ui'
import { HelpTip } from '../components/HelpTip'

interface Balance {
  id: string
  patient: { displayName: string }
  amount: number
  daysOutstanding: number
  currentStage: string
  createdAt: string
}

const STAGES = ['CREATED','NOTIFIED','REMINDER_1','REMINDER_2','ESCALATED','STAFF_REVIEW','CLOSED']

function agingColor(days: number) {
  if (days > 60) return 'red'
  if (days > 30) return 'amber'
  return 'green'
}

export default function Balances() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const [balances, setBalances] = useState<Balance[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [filters, setFilters]   = useState({ stage: '', minAmount: '', maxAmount: '' })

  useEffect(() => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ practiceId })
    if (filters.stage)     params.append('stage', filters.stage)
    if (filters.minAmount) params.append('minAmount', filters.minAmount)
    if (filters.maxAmount) params.append('maxAmount', filters.maxAmount)

    apiFetchJson<Balance[]>(`/api/balances?${params}`)
      .then(data => {
        const sorted = Array.isArray(data)
          ? [...data].sort((a, b) => b.daysOutstanding - a.daysOutstanding)
          : []
        setBalances(sorted)
      })
      .catch((e) => { setError((e as Error).message) })
      .finally(() => setLoading(false))
  }, [practiceId, filters])

  const overdue60 = balances.filter(b => b.daysOutstanding > 60).length
  const dataBusy = practiceLoading || loading

  return (
    <DataState loading={dataBusy} error={error}>
    <div className="page-enter p-6 space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Insurance AR</h1>
            <HelpTip>
              List of open insurance balances: stage shows where each claim is in the workflow. Click a row for detail and
              payment links. Filter by stage or amount to prioritize work.
            </HelpTip>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Sortable by carrier, aging bucket, and amount</p>
        </div>
        <div className="flex items-center gap-2">
          {overdue60 > 0 && (
            <Badge color="red" dot>{overdue60} overdue &gt;60 d</Badge>
          )}
          <Button variant="secondary" size="sm">Export CSV</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-4 py-3 flex flex-wrap items-end gap-3">
        <Select
          label="Stage"
          value={filters.stage}
          onChange={e => setFilters(f => ({ ...f, stage: e.target.value }))}
          className="w-40"
        >
          <option value="">All stages</option>
          {STAGES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </Select>
        <Input
          label="Min amount"
          type="number"
          placeholder="$0"
          value={filters.minAmount}
          onChange={e => setFilters(f => ({ ...f, minAmount: e.target.value }))}
          className="w-28"
          leading="$"
        />
        <Input
          label="Max amount"
          type="number"
          placeholder="∞"
          value={filters.maxAmount}
          onChange={e => setFilters(f => ({ ...f, maxAmount: e.target.value }))}
          className="w-28"
          leading="$"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setFilters({ stage: '', minAmount: '', maxAmount: '' })}
        >
          Clear filters
        </Button>
        <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 self-end pb-0.5">
          {balances.length} result{balances.length !== 1 ? 's' : ''} · sorted oldest first
        </span>
      </div>

      {/* Table */}
        <TableContainer>
          <Table>
            <caption className="sr-only">Open insurance balances, sortable by patient, amount, and aging</caption>
            <Thead>
              <tr>
                <Th>Patient</Th>
                <Th align="right">Amount</Th>
                <Th align="right">Days Outstanding ↓</Th>
                <Th>Stage</Th>
                <Th>Created</Th>
                <Th>Actions</Th>
              </tr>
            </Thead>
            <Tbody>
              {balances.length === 0 ? (
                <TableEmpty message="No balances match your filters." colSpan={6} />
              ) : (
                balances.map((b, i) => {
                  const isOldest = i < 5 && b.daysOutstanding > 30
                  return (
                    <Tr key={b.id} highlight={isOldest}>
                      <Td bold>{b.patient.displayName}</Td>
                      <Td align="right" bold>
                        {new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(b.amount)}
                      </Td>
                      <Td align="right">
                        <Badge color={agingColor(b.daysOutstanding)}>
                          {b.daysOutstanding}d
                        </Badge>
                      </Td>
                      <Td><StageBadge stage={b.currentStage} /></Td>
                      <Td muted>{new Date(b.createdAt).toLocaleDateString('en-CA')}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Link to={`/balances/${b.id}`}>
                            <Button variant="secondary" size="xs">View</Button>
                          </Link>
                          {b.currentStage !== 'CLOSED' && (
                            <Button variant="ghost" size="xs" className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                              Escalate
                            </Button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  )
                })
              )}
            </Tbody>
          </Table>
        </TableContainer>
    </div>
    </DataState>
  )
}
