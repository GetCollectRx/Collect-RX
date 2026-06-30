import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePracticePageGate } from '../hooks/usePracticePageGate'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import type { PmsVendorCatalogEntry, PracticePmsInfo } from '../types/pms'
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
  const { practiceId, canFetch, pageBusy, pageError } = usePracticePageGate()
  const [runs, setRuns] = useState<ImportRun[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<PmsVendorCatalogEntry[]>([])
  const [pmsContext, setPmsContext] = useState<PracticePmsInfo | null>(null)
  const [runDetail, setRunDetail] = useState<{
    validationMessages: string[]
    rowErrors: { row?: number; message?: string }[]
  } | null>(null)

  const load = () => {
    if (!practiceId) return
    setLoading(true)
    Promise.all([
      apiFetchJson<{ success: boolean; data: ImportRun[] }>('/api/admin/sync/runs'),
      apiFetchJson<{ vendors: PmsVendorCatalogEntry[] }>('/api/pms/catalog').catch(() => ({ vendors: [] })),
      apiFetchJson<{ success: boolean; data: PracticePmsInfo }>('/api/pms/context').catch(() => ({ success: false, data: null })),
    ])
      .then(([runsRes, catRes, ctxRes]) => {
        setRuns(runsRes.data ?? [])
        setCatalog(catRes.vendors ?? [])
        setPmsContext(ctxRes.data ?? null)
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!canFetch) return
    load()
  }, [practiceId, canFetch])

  const upload = async (pmsVendor: string, file: File) => {
    setUploading(pmsVendor)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const r = await apiFetch(`/api/admin/sync/import/${pmsVendor}`, { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({})) as {
        error?: string
        imported?: number
        skipped?: number
        failed?: number
        validationPassed?: boolean
        pmsVendor?: string
      }
      if (!r.ok) throw new Error(j.error ?? 'Import failed')
      const label = catalog.find((c) => c.id === (j.pmsVendor ?? pmsVendor))?.displayName ?? pmsVendor
      setLastResult(
        `${label}: ${j.imported ?? 0} imported, ${j.skipped ?? 0} skipped, ${j.failed ?? 0} failed` +
          (j.validationPassed === false ? ' · validation drift flagged' : ''),
      )
      await apiFetch('/api/work-queue/sync', { method: 'POST' }).catch(() => undefined)
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(null)
    }
  }

  const vendors =
    catalog.length > 0
      ? catalog
      : [
          { id: 'dentrix', displayName: 'Dentrix', importFamily: 'dentrix' as const, supportsDesktopConnector: false, supportsEdiVersionGuard: false },
          { id: 'abeldent', displayName: 'AbelDent', importFamily: 'abeldent' as const, supportsDesktopConnector: true, supportsEdiVersionGuard: true },
          { id: 'open_dental', displayName: 'Open Dental', importFamily: 'generic' as const, supportsDesktopConnector: false, supportsEdiVersionGuard: false },
          { id: 'other', displayName: 'Other / CSV', importFamily: 'generic' as const, supportsDesktopConnector: false, supportsEdiVersionGuard: false },
        ]

  return (
    <DataState loading={pageBusy(loading)} error={pageError(error)}>
      <div className="page-enter p-6 space-y-6 max-w-5xl">
        <header className="flex items-center gap-3">
          <Link to="/admin"><Button variant="ghost" size="sm">← Admin</Button></Link>
          <div>
            <h1 className="page-title">Sync ops</h1>
            <p className="page-subtitle">
              PMS export imports feed the same carrier call engine
              {pmsContext ? ` · configured: ${pmsContext.displayName}` : ''}.
            </p>
          </div>
        </header>

        {lastResult && (
          <p className="text-sm text-crx-600 dark:text-crx-400" role="status">
            {lastResult}.{' '}
            <Link to="/insurance?tab=queue" className="underline">Open priority queue</Link>
          </p>
        )}

        <Card>
          <CardHeader title="Upload claim export" subtitle="CSV from your PMS, column names are mapped automatically" />
          <div className="px-4 pb-4 flex flex-wrap gap-4">
            {vendors.map((v) => (
              <label key={v.id} className="text-sm">
                <span className="block text-gray-500 mb-1">{v.displayName}</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  disabled={uploading !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void upload(v.id, f)
                  }}
                />
              </label>
            ))}
            <label className="text-sm">
              <span className="block text-gray-500 mb-1">Practice default (auto)</span>
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={uploading !== null}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void upload('auto', f)
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
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {runs.length === 0 ? (
                <TableEmpty colSpan={8} message="No import runs yet." />
              ) : (
                runs.map((run) => (
                  <Tr key={run.id}>
                    <Td className="text-xs">{new Date(run.startedAt).toLocaleString()}</Td>
                    <Td>{catalog.find((c) => c.id === run.pmsSource)?.displayName ?? run.pmsSource}</Td>
                    <Td><Badge>{run.status}</Badge></Td>
                    <Td>{run.recordsImported}/{run.recordsTotal}</Td>
                    <Td>{run.recordsFailed}</Td>
                    <Td>{run.driftPct != null ? `${(run.driftPct * 100).toFixed(2)}%` : 'N/A'}</Td>
                    <Td>{run.validationPassed == null ? 'N/A' : run.validationPassed ? '✓' : '✗'}</Td>
                    <Td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void apiFetchJson<{
                            success: boolean
                            data: { validationMessages?: string[]; rowErrors?: { row?: number; message?: string }[] }
                          }>(`/api/admin/sync/runs/${run.id}`).then((res) => {
                            setRunDetail({
                              validationMessages: res.data?.validationMessages ?? [],
                              rowErrors: res.data?.rowErrors ?? [],
                            })
                          })
                        }}
                      >
                        Details
                      </Button>
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </Table>
        </TableContainer>

        {runDetail && (
          <Card>
            <CardHeader title="Import run details" />
            <div className="px-4 pb-4 text-sm space-y-2">
              {runDetail.validationMessages.length > 0 && (
                <ul className="list-disc list-inside text-amber-700">
                  {runDetail.validationMessages.map((m) => <li key={m}>{m}</li>)}
                </ul>
              )}
              {runDetail.rowErrors.length > 0 ? (
                <ul className="text-xs text-gray-600 max-h-48 overflow-y-auto">
                  {runDetail.rowErrors.slice(0, 20).map((e, i) => (
                    <li key={i}>Row {e.row ?? '?'}: {e.message ?? 'error'}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500">No row-level errors recorded.</p>
              )}
              <Button variant="ghost" size="sm" onClick={() => setRunDetail(null)}>Close</Button>
            </div>
          </Card>
        )}
      </div>
    </DataState>
  )
}
