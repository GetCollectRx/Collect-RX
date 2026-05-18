import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import {
  Button, Card, CardHeader, DataState,
  TableContainer, Table, Thead, Tbody, Th, Tr, Td, TableEmpty, Badge,
} from '../components/ui'

interface ImportRun {
  id: string
  pmsSource: string
  status: string
  startedAt: string
  completedAt: string | null
  recordsTotal: number
  recordsImported: number
  recordsFailed: number
  recordsSkipped: number
  driftPct: number | null
  validationPassed: boolean | null
}

export default function SyncOpsDashboard() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const [runs, setRuns] = useState<ImportRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)

  const load = () => {
    if (!practiceId) return
    setLoading(true)
    apiFetchJson<{ success: boolean; data: ImportRun[] }>('/api/admin/sync/runs')
      .then((res) => setRuns(res.data ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [practiceId])

  const upload = async (pmsSource: 'dentrix' | 'abeldent', file: File) => {
    setUploading(pmsSource)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const r = await apiFetch(`/api/admin/sync/import/${pmsSource}`, { method: 'POST', body: fd })
      if (!r.ok) throw new Error('Import failed')
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(null)
    }
  }

  return (
    <DataState loading={practiceLoading || loading} error={error}>
      <div className="page-enter p-6 space-y-6 max-w-5xl">
        <header className="flex items-center gap-3">
          <Link to="/admin"><Button variant="ghost" size="sm">← Admin</Button></Link>
          <div>
            <h1 className="page-title">Sync ops</h1>
            <p className="page-subtitle">PMS export imports, validation drift, and error drill-down.</p>
          </div>
        </header>

        <Card>
          <CardHeader title="Upload nightly export" />
          <div className="px-4 pb-4 flex flex-wrap gap-4">
            <label className="text-sm">
              <span className="block text-gray-500 mb-1">Dentrix CSV</span>
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={uploading !== null}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void upload('dentrix', f)
                }}
              />
            </label>
            <label className="text-sm">
              <span className="block text-gray-500 mb-1">AbelDent CSV</span>
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={uploading !== null}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void upload('abeldent', f)
                }}
              />
            </label>
          </div>
        </Card>

        <TableContainer>
          <Table>
            <Thead>
              <Tr>
                <Th>Started</Th>
                <Th>PMS</Th>
                <Th>Status</Th>
                <Th>Imported</Th>
                <Th>Failed</Th>
                <Th>Drift</Th>
                <Th>Valid</Th>
              </Tr>
            </Thead>
            <Tbody>
              {runs.length === 0 ? (
                <TableEmpty colSpan={7} message="No import runs yet." />
              ) : (
                runs.map((run) => (
                  <Tr key={run.id}>
                    <Td className="text-xs">{new Date(run.startedAt).toLocaleString()}</Td>
                    <Td>{run.pmsSource}</Td>
                    <Td><Badge>{run.status}</Badge></Td>
                    <Td>{run.recordsImported}/{run.recordsTotal}</Td>
                    <Td>{run.recordsFailed}</Td>
                    <Td>{run.driftPct != null ? `${(run.driftPct * 100).toFixed(2)}%` : '—'}</Td>
                    <Td>{run.validationPassed == null ? '—' : run.validationPassed ? '✓' : '✗'}</Td>
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
