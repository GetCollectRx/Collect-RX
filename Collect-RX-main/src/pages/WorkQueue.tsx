import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import { useRoleAccess } from '../lib/useRoleAccess'
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
  const { isReadOnly } = useRoleAccess()

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

  return (
    <DataState loading={practiceLoading || loading} error={error}>
      <div className="page-enter p-6 space-y-6 max-w-6xl">
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="page-title">Work queue</h1>
            <p className="page-subtitle">All open AR ranked by dollars at risk, aging, and carrier denial risk.</p>
          </div>
          <Button size="sm" onClick={() => void syncQueue()} disabled={syncing || isReadOnly}>
            {syncing ? 'Syncing…' : 'Refresh from sources'}
          </Button>
        </header>

        <div className="flex flex-wrap gap-3">
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
        </div>

        <TableContainer>
          <Table>
            <Thead>
              <Tr>
                <Th>Item</Th>
                <Th>Type</Th>
                <Th>At risk</Th>
                <Th>Days</Th>
                <Th>Rep</Th>
                <Th>Notes</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {items.length === 0 ? (
                <TableEmpty colSpan={7} message="Queue is empty — run Refresh from sources after a PMS import." />
              ) : (
                items.map((row) => (
                  <Tr key={row.id}>
                    <Td>{row.title ?? row.sourceId.slice(0, 8)}</Td>
                    <Td><Badge>{row.itemType}</Badge></Td>
                    <Td>${Number(row.dollarsAtRisk).toFixed(2)}</Td>
                    <Td>{row.daysOutstanding}</Td>
                    <Td className="text-xs max-w-[120px]">
                      {editingRepId === row.id ? (
                        <Input value={rep} onChange={(e) => setRep(e.target.value)} className="text-xs" />
                      ) : (
                        row.assignedRep ?? '—'
                      )}
                    </Td>
                    <Td className="max-w-xs">
                      {editingId === row.id ? (
                        <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="text-xs" />
                      ) : (
                        <span className="text-xs text-gray-500 truncate">{row.notes ?? '—'}</span>
                      )}
                    </Td>
                    <Td className="space-x-1">
                      <Link to={linkFor(row)}><Button variant="ghost" size="sm">Open</Button></Link>
                      {!isReadOnly && (
                        editingId === row.id ? (
                          <Button variant="secondary" size="sm" onClick={() => void saveNotes(row.id)}>Save</Button>
                        ) : editingRepId === row.id ? (
                          <Button variant="secondary" size="sm" onClick={() => void saveRep(row.id)}>Save</Button>
                        ) : (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => { setEditingId(row.id); setNotes(row.notes ?? '') }}>Note</Button>
                            <Button variant="ghost" size="sm" onClick={() => { setEditingRepId(row.id); setRep(row.assignedRep ?? '') }}>Rep</Button>
                          </>
                        )
                      )}
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </Table>
        </TableContainer>
      </div>
    </DataState>
  )
}
