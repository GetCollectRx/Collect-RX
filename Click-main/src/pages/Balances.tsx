import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { api } from '../utils/api'
import { useDebounce } from '../hooks/useDebounce'
import type { BalanceListItem } from '../types'
import {
  Badge,
  Button,
  Input,
  Select,
  SkeletonTable,
  EmptyState,
  Table,
  Breadcrumb,
  useToast,
  type ToastVariant,
} from '../components/base'
import type { Column, SortDirection } from '../components/base'

const PAGE_SIZE = 20

const STAGE_OPTIONS = [
  { value: '',              label: 'All Stages' },
  { value: 'CREATED',      label: 'Created' },
  { value: 'NOTIFIED',     label: 'Notified' },
  { value: 'REMINDER_1',   label: 'Reminder 1' },
  { value: 'REMINDER_2',   label: 'Reminder 2' },
  { value: 'ESCALATED',    label: 'Escalated' },
  { value: 'STAFF_REVIEW', label: 'Staff Review' },
  { value: 'CLOSED',       label: 'Closed' },
]

const STATUS_OPTIONS = [
  { value: '',       label: 'All Statuses' },
  { value: 'OPEN',   label: 'Open' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'PAUSED', label: 'Paused' },
]

function stageVariant(stage: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  switch (stage) {
    case 'CLOSED':      return 'success'
    case 'ESCALATED':
    case 'STAFF_REVIEW': return 'error'
    case 'REMINDER_2':  return 'warning'
    case 'REMINDER_1':  return 'info'
    default:            return 'neutral'
  }
}

function stageLabel(stage: string) {
  return stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function ageVariant(days: number) {
  if (days > 60) return 'error'
  if (days > 30) return 'warning'
  return 'success'
}

const COLUMNS: Column<BalanceListItem>[] = [
  {
    key: 'patient',
    header: 'Patient',
    render: row => (
      <span className="font-medium text-gray-900">{row.patient.displayName}</span>
    ),
    sortable: true,
  },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    render: row => (
      <span className="tabular-nums font-semibold text-gray-900">
        ${row.amount.toFixed(2)}
      </span>
    ),
    sortable: true,
  },
  {
    key: 'daysOutstanding',
    header: 'Days Out',
    align: 'center',
    render: row => (
      <Badge variant={ageVariant(row.daysOutstanding)} size="sm">
        {row.daysOutstanding}d
      </Badge>
    ),
    sortable: true,
  },
  {
    key: 'currentStage',
    header: 'Stage',
    render: row => (
      <Badge variant={stageVariant(row.currentStage)} size="sm">
        {stageLabel(row.currentStage)}
      </Badge>
    ),
    sortable: true,
  },
  {
    key: 'status',
    header: 'Status',
    align: 'center',
    render: row => (
      <Badge
        variant={row.status === 'OPEN' ? 'info' : row.status === 'CLOSED' ? 'success' : 'neutral'}
        size="sm"
      >
        {row.status}
      </Badge>
    ),
    sortable: true,
  },
  {
    key: 'createdAt',
    header: 'Created',
    render: row => (
      <span className="text-gray-500 tabular-nums text-xs">
        {new Date(row.createdAt).toLocaleDateString()}
      </span>
    ),
    sortable: true,
  },
  {
    key: 'actions',
    header: '',
    align: 'right',
    render: row => (
      <Link to={`/balances/${row.id}`} onClick={e => e.stopPropagation()}>
        <Button size="sm" variant="ghost">View</Button>
      </Link>
    ),
  },
]

function sortRows(rows: BalanceListItem[], key: string, dir: SortDirection): BalanceListItem[] {
  if (!dir) return rows
  return [...rows].sort((a, b) => {
    let av: string | number
    let bv: string | number
    if (key === 'patient') {
      av = a.patient.displayName
      bv = b.patient.displayName
    } else {
      av = (a as unknown as Record<string, string | number>)[key]
      bv = (b as unknown as Record<string, string | number>)[key]
    }
    if (av < bv) return dir === 'asc' ? -1 : 1
    if (av > bv) return dir === 'asc' ? 1 : -1
    return 0
  })
}

function Balances() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const { toast } = useToast()
  const showToast = (variant: ToastVariant, title: string) => toast({ variant, title })
  const [balances, setBalances]   = useState<BalanceListItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [page, setPage]           = useState(1)
  const [sortKey, setSortKey]     = useState('daysOutstanding')
  const [sortDir, setSortDir]     = useState<SortDirection>('desc')
  const [filters, setFilters]     = useState({ stage: '', status: '', minAmount: '', maxAmount: '' })

  const debouncedMin = useDebounce(filters.minAmount, 400)
  const debouncedMax = useDebounce(filters.maxAmount, 400)

  const fetchBalances = useCallback(async () => {
    if (!practiceId) return
    try {
      setLoading(true)
      setError(null)
      const params = new URLSearchParams({ practiceId })
      if (filters.stage)  params.append('stage', filters.stage)
      if (filters.status) params.append('status', filters.status)
      if (debouncedMin)   params.append('minAmount', debouncedMin)
      if (debouncedMax)   params.append('maxAmount', debouncedMax)
      const data = await api.get<BalanceListItem[]>(`/api/balances?${params}`)
      setBalances(Array.isArray(data) ? data : [])
      setPage(1)
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      showToast('error', `Failed to load balances: ${msg}`)
    } finally {
      setLoading(false)
    }
  }, [practiceId, filters.stage, filters.status, debouncedMin, debouncedMax, showToast])

  useEffect(() => { fetchBalances() }, [fetchBalances])

  const sorted = useMemo(() => sortRows(balances, sortKey, sortDir), [balances, sortKey, sortDir])
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const pageRows   = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleSort = (key: string, dir: SortDirection) => {
    setSortKey(key)
    setSortDir(dir)
    setPage(1)
  }

  const clearFilters = () => {
    setFilters({ stage: '', status: '', minAmount: '', maxAmount: '' })
    setPage(1)
  }

  const hasFilters = !!(filters.stage || filters.status || filters.minAmount || filters.maxAmount)

  if (practiceLoading) return null

  return (
    <main className="px-4 py-6 md:px-6 pb-20 md:pb-6 max-w-7xl mx-auto space-y-4">
      <Breadcrumb items={[{ label: 'Dashboard', href: '/' }, { label: 'Balances' }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Patient Balances</h1>
          {!loading && (
            <p className="text-sm text-gray-500 mt-0.5">
              {sorted.length} balance{sorted.length !== 1 ? 's' : ''}
              {hasFilters ? ' matching filters' : ' total'}
            </p>
          )}
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" role="search" aria-label="Balance filters">
        <Select
          label="Stage"
          value={filters.stage}
          onChange={e => setFilters(f => ({ ...f, stage: e.target.value }))}
          options={STAGE_OPTIONS}
        />
        <Select
          label="Status"
          value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
          options={STATUS_OPTIONS}
        />
        <Input
          label="Min amount"
          type="number"
          placeholder="$0"
          value={filters.minAmount}
          onChange={e => setFilters(f => ({ ...f, minAmount: e.target.value }))}
        />
        <Input
          label="Max amount"
          type="number"
          placeholder="Any"
          value={filters.maxAmount}
          onChange={e => setFilters(f => ({ ...f, maxAmount: e.target.value }))}
        />
      </div>

      {/* Error */}
      {error && !loading && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>Failed to load balances: {error}</span>
          <Button size="sm" variant="danger" onClick={fetchBalances}>Retry</Button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <SkeletonTable rows={8} cols={7} />
      ) : pageRows.length === 0 ? (
        <NoResults onClear={hasFilters ? clearFilters : undefined} />
      ) : (
        <>
          <Table<BalanceListItem>
            columns={COLUMNS}
            rows={pageRows}
            sortKey={sortKey}
            sortDirection={sortDir}
            onSort={handleSort}
            caption="Patient balances"
            striped
          />

          {totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          )}
        </>
      )}
    </main>
  )
}

function NoResults({ onClear }: { onClear?: () => void }) {
  return (
    <EmptyState
      compact
      title="No balances found"
      description={onClear ? 'No balances match your current filters.' : 'No balances have been created yet.'}
      action={onClear ? (
        <Button variant="secondary" size="sm" onClick={onClear}>Clear filters</Button>
      ) : undefined}
    />
  )
}

function Pagination({ page, totalPages, onChange }: {
  page: number
  totalPages: number
  onChange: (p: number) => void
}) {
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)

  return (
    <nav className="flex items-center justify-between mt-2" aria-label="Pagination">
      <Button
        variant="secondary" size="sm"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </Button>

      <div className="flex items-center gap-1">
        {pages.map((p, i, arr) => (
          <span key={p} className="flex items-center gap-1">
            {i > 0 && arr[i - 1] !== p - 1 && (
              <span className="px-1 text-gray-400 text-sm">&hellip;</span>
            )}
            <Button
              variant={p === page ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => onChange(p)}
              aria-current={p === page ? 'page' : undefined}
            >
              {p}
            </Button>
          </span>
        ))}
      </div>

      <Button
        variant="secondary" size="sm"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  )
}

export default Balances
