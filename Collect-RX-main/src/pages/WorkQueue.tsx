import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import {
  Button, Select, Input, DataState,
  TableContainer, Table, Thead, Tbody, Th, Tr, Td, TableEmpty, Badge,
} from '../components/ui'

interface WorkItemRow {
  id: string
  itemType: string
  sourceType: string
  sourceId: string
  title: string | null
  dollarsAtRisk: string | number
  daysOutstanding: number
  carrierId: string | null
  assignedRep: string | null
  followUpAt: string | null
  notes: string | null
  rankScore: number
}

export default function WorkQueue() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const [items, setItems] = useState<WorkItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState({ itemType: '', aging: '' })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingRepId, setEditingRepId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [rep, setRep] = useState('')

  const load = () => {
    if (!practiceId) return
    setLoading(true)
    const params = new URLSearchParams({ limit: '100' })
    if (filters.itemType) params.set('itemType', filters.itemType)
    if (filters.aging) params.set('aging', filters.aging)
    apiFetchJson<{ success: boolean; items: WorkItemRow[] }>(`/api/work-queue?${params}`)
      .then((res) => setItems(res.items ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [practiceId, filters])

  const syncQueue = async () => {
    setSyncing(true)
    try {
      await apiFetch('/api/work-queue/sync', { method: 'POST' })
      load()
    } finally {
      setSyncing(false)
    }
  }

  const saveNotes = async (id: string) => {
    await apiFetch(`/api/work-queue/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    })
    setEditingId(null)
    load()
  }

  const saveRep = async (id: string) => {
    await apiFetch(`/api/work-queue/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedRep: rep || null }),
    })
    setEditingRepId(null)
    load()
  }

  const linkFor = (row: WorkItemRow) => {
    if (row.sourceType === 'insurance_claim') return `/insurance/${row.sourceId}`
    if (row.sourceType === 'patient_balance') return '/patient-ar'
    return `/balances/${row.sourceId}`
  }

  const typeColor = (t: string): 'blue' | 'green' | 'amber' | 'gray' => {
    if (t === 'insurance') return 'blue'
    if (t === 'patient_ar') return 'green'
    if (t === 'outreach') return 'amber'
    return 'gray'
  }

  const scoreLabel = (score: number) => {
    if (score >= 80) return { label: 'Critical', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
    if (score >= 60) return { label: 'High', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' }
    if (score >= 40) return { label: 'Med', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' }
    return { label: 'Low', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' }
  }

  return (
    <DataState loading={practiceLoading || loading} error={error}>
      <div className="page-enter">
        {/* ── Page header ── */}
        <div className="px-6 pt-6 pb-5 border-b border-gray-100 dark:border-gray-800/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="page-title">Work Queue</h1>
            <p className="page-subtitle mt-0.5">All open AR ranked by dollars at risk, aging, and carrier denial risk.</p>
          </div>
          <Button size="sm" onClick={() => void syncQueue()} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Refresh from sources'}
          </Button>
        </div>

        <div className="p-6 space-y-5 max-w-6xl">
          {/* ── Filters ── */}
          <div className="flex flex-wrap gap-2.5 items-center">
            <Select value={filters.itemType} onChange={(e) => setFilters((f) => ({ ...f, itemType: e.target.value }))} aria-label="Type">
              <option value="">All types</option>
              <option value="insurance">Insurance</option>
              <option value="patient_ar">Patient AR</option>
              <option value="outreach">Outreach</option>
            </Select>
            <Select value={filters.aging} onChange={(e) => setFilters((f) => ({ ...f, aging: e.target.value }))} aria-label="Aging">
              <option value="">All aging</option>
              <option value="30">30–59 days</option>
              <option value="60">60–89 days</option>
              <option value="90">90–119 days</option>
              <option value="120+">120+ days</option>
            </Select>
            {items.length > 0 && (
              <span className="ml-auto text-xs text-gray-400 dark:text-gray-600 font-medium">
                {items.length} item{items.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* ── Table ── */}
          <TableContainer>
            <Table>
              <Thead>
                <Tr>
                  <Th>Priority</Th>
                  <Th>Item</Th>
                  <Th>Type</Th>
                  <Th align="right">At Risk</Th>
                  <Th>Age</Th>
                  <Th>Rep</Th>
                  <Th>Notes</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {items.length === 0 ? (
                  <TableEmpty colSpan={8} message="Queue is empty — run Refresh from sources after a PMS import." />
                ) : (
                  items.map((row) => {
                    const { label, color } = scoreLabel(row.rankScore)
                    return (
                      <Tr key={row.id} highlight={row.daysOutstanding > 90}>
                        <Td>
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-2xs font-bold ${color}`}>
                            {label}
                          </span>
                        </Td>
                        <Td bold>{row.title ?? row.sourceId.slice(0, 8)}</Td>
                        <Td>
                          <Badge color={typeColor(row.itemType)} dot>
                            {row.itemType.replace('_', ' ')}
                          </Badge>
                        </Td>
                        <Td align="right" bold>
                          ${Number(row.dollarsAtRisk).toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </Td>
                        <Td>
                          <Badge color={row.daysOutstanding > 90 ? 'red' : row.daysOutstanding > 60 ? 'amber' : 'gray'}>
                            {row.daysOutstanding}d
                          </Badge>
                        </Td>
                        <Td muted className="text-xs max-w-[120px]">
                          {editingRepId === row.id ? (
                            <Input value={rep} onChange={(e) => setRep(e.target.value)} className="text-xs" />
                          ) : (
                            row.assignedRep ?? <span className="text-gray-300 dark:text-gray-700">—</span>
                          )}
                        </Td>
                        <Td className="max-w-xs">
                          {editingId === row.id ? (
                            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="text-xs" />
                          ) : (
                            <span className="text-xs text-gray-400 dark:text-gray-600 truncate block max-w-[160px]">
                              {row.notes ?? <span className="text-gray-300 dark:text-gray-700">No notes</span>}
                            </span>
                          )}
                        </Td>
                        <Td className="space-x-1">
                          <Link to={linkFor(row)}><Button variant="ghost" size="sm">Open</Button></Link>
                          {editingId === row.id ? (
                            <Button variant="secondary" size="sm" onClick={() => void saveNotes(row.id)}>Save</Button>
                          ) : editingRepId === row.id ? (
                            <Button variant="secondary" size="sm" onClick={() => void saveRep(row.id)}>Save</Button>
                          ) : (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => { setEditingId(row.id); setNotes(row.notes ?? '') }}>Note</Button>
                              <Button variant="ghost" size="sm" onClick={() => { setEditingRepId(row.id); setRep(row.assignedRep ?? '') }}>Rep</Button>
                            </>
                          )}
                        </Td>
                      </Tr>
                    )
                  })
                )}
              </Tbody>
            </Table>
          </TableContainer>
        </div>
      </div>
    </DataState>
  )
}
