import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePracticePageGate } from '../hooks/usePracticePageGate'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import { previewCsvFile } from '../lib/csvClientPreview'
import { useAppToast } from '../context/ToastContext'
import type { PmsVendorCatalogEntry, PracticePmsInfo } from '../types/pms'
import {
  Button,
  Card,
  CardHeader,
  DataState,
  Select,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Badge,
} from '../components/ui'

type Step = 'prepare' | 'preview' | 'result'

const STEPS: { id: Step; label: string }[] = [
  { id: 'prepare', label: 'Prepare' },
  { id: 'preview', label: 'Preview' },
  { id: 'result', label: 'Done' },
]

export default function CsvImportPage() {
  const navigate = useNavigate()
  const { practiceId, canFetch, pageBusy, pageError } = usePracticePageGate()
  const { showToast } = useAppToast()
  const [step, setStep] = useState<Step>('prepare')
  const [catalog, setCatalog] = useState<PmsVendorCatalogEntry[]>([])
  const [pmsContext, setPmsContext] = useState<PracticePmsInfo | null>(null)
  const [vendor, setVendor] = useState('auto')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ReturnType<typeof previewCsvFile> | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{
    imported: number
    skipped: number
    failed: number
    validationPassed: boolean | null
    runId?: string
    rowErrors: { row?: number; message?: string }[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canFetch) return
    setLoading(true)
    Promise.all([
      apiFetchJson<{ vendors: PmsVendorCatalogEntry[] }>('/api/pms/catalog').catch(() => ({ vendors: [] })),
      apiFetchJson<{ success: boolean; data: PracticePmsInfo }>('/api/pms/context').catch(() => ({ success: false, data: null })),
    ])
      .then(([cat, ctx]) => {
        setCatalog(cat.vendors ?? [])
        setPmsContext(ctx.data ?? null)
        if (ctx.data?.vendorId) setVendor(ctx.data.vendorId)
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [canFetch, practiceId])

  const onFilePick = useCallback(async (f: File | null) => {
    setFile(f)
    setResult(null)
    if (!f) {
      setPreview(null)
      setStep('prepare')
      return
    }
    const text = await f.text()
    const p = previewCsvFile(text)
    setPreview(p)
    setStep('preview')
  }, [])

  const runImport = async () => {
    if (!file || !preview?.ready) return
    setUploading(true)
    setError(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const r = await apiFetch(`/api/admin/sync/import/${vendor}`, { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({})) as {
        error?: string
        imported?: number
        skipped?: number
        failed?: number
        validationPassed?: boolean
        runId?: string
      }
      if (!r.ok) throw new Error(j.error ?? 'Import failed')
      await apiFetch('/api/work-queue/sync', { method: 'POST' }).catch(() => undefined)

      let rowErrors: { row?: number; message?: string }[] = []
      if (j.runId) {
        const detail = await apiFetchJson<{
          success: boolean
          data: { rowErrors?: { row?: number; message?: string }[] }
        }>(`/api/admin/sync/runs/${j.runId}`).catch(() => null)
        rowErrors = detail?.data?.rowErrors ?? []
      }

      setResult({
        imported: j.imported ?? 0,
        skipped: j.skipped ?? 0,
        failed: j.failed ?? 0,
        validationPassed: j.validationPassed ?? null,
        runId: j.runId,
        rowErrors,
      })
      setStep('result')
      showToast('ok', `${j.imported ?? 0} claims imported`)
    } catch (e) {
      const msg = (e as Error).message
      setError(msg)
      showToast('err', msg)
    } finally {
      setUploading(false)
    }
  }

  const vendorOptions = [
    { value: 'auto', label: `Auto-detect${pmsContext?.displayName ? ` (${pmsContext.displayName})` : ''}` },
    ...catalog.map((v) => ({ value: v.id, label: v.displayName })),
  ]

  return (
    <DataState loading={pageBusy(loading)} error={pageError(error)}>
      <div className="page-enter max-w-[900px]">
        <div className="px-6 pt-6 pb-5 border-b border-gray-100 dark:border-gray-800/60">
          <h1 className="page-title">Import claims from CSV</h1>
          <p className="page-subtitle mt-0.5">
            Upload an outstanding-claims export from your practice management system. CollectRx maps common column names automatically.
          </p>
        </div>

        <div className="p-6 space-y-6">
          <nav className="crx-stepper" aria-label="Import steps">
            {STEPS.map((s, i) => (
              <div
                key={s.id}
                className={`crx-stepper-item${step === s.id ? ' active' : ''}${STEPS.findIndex((x) => x.id === step) > i ? ' done' : ''}`}
              >
                <span className="crx-stepper-num">{i + 1}</span>
                <span>{s.label}</span>
              </div>
            ))}
          </nav>

          {step === 'prepare' && (
            <Card>
              <CardHeader
                title="Step 1 — Get your file ready"
                subtitle="Export outstanding insurance claims from your PMS as CSV, or start from our template."
              />
              <div className="space-y-4 text-sm">
                <ol className="list-decimal list-inside space-y-2 text-gray-700 dark:text-gray-300">
                  <li>Export <strong>outstanding insurance claims</strong> (not patient balances) from your PMS.</li>
                  <li>Include claim id, carrier, outstanding amount, and procedure codes if available.</li>
                  <li>Save as <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">.csv</code> (UTF-8).</li>
                </ol>
                <div className="flex flex-wrap gap-2">
                  <a href="/sample-claims.csv" download className="crx-btn-secondary inline-flex items-center text-sm">
                    Download sample template
                  </a>
                  <Link to="/settings" className="crx-btn-ghost inline-flex items-center text-sm">
                    Practice settings (PMS vendor)
                  </Link>
                </div>
                <Select
                  label="PMS vendor"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                >
                  {vendorOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
                <p className="text-xs text-gray-500">Auto uses your practice default from Settings.</p>
                <div className="crx-upload-zone">
                  <label htmlFor="csv-file" className="crx-upload-label">
                    <span className="font-medium">Choose CSV file</span>
                    <span className="text-xs text-gray-500 mt-1">or drag and drop below</span>
                  </label>
                  <input
                    id="csv-file"
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    onChange={(e) => void onFilePick(e.target.files?.[0] ?? null)}
                  />
                  <div
                    className="crx-drop-target"
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over') }}
                    onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.currentTarget.classList.remove('drag-over')
                      const f = e.dataTransfer.files?.[0]
                      if (f) void onFilePick(f)
                    }}
                  >
                    {file ? (
                      <p><strong>{file.name}</strong> · {(file.size / 1024).toFixed(1)} KB</p>
                    ) : (
                      <p className="text-gray-500">Drop your CSV here</p>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {step === 'preview' && preview && file && (
            <Card>
              <CardHeader
                title="Step 2 — Preview & confirm"
                subtitle={`${preview.rowCount} data rows detected in ${file.name}`}
              />
              <div className="space-y-4">
                {preview.missingRequired.length > 0 && (
                  <div className="crx-alert px-4 py-3 text-sm" role="alert">
                    <p className="font-semibold">Missing required columns</p>
                    <ul className="mt-1 list-disc pl-4">
                      {preview.missingRequired.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {preview.missingRecommended.length > 0 && preview.ready && (
                  <p className="text-xs text-gray-500">
                    Optional columns not found: {preview.missingRecommended.join(', ')}. Import can still proceed.
                  </p>
                )}
                {preview.ready && (
                  <p className="text-sm text-gray-600">
                    Mapped columns: {preview.normalizedHeaders.slice(0, 8).join(', ')}
                    {preview.normalizedHeaders.length > 8 ? '…' : ''}
                  </p>
                )}
                <Table>
                  <Thead>
                    <Tr>
                      {preview.normalizedHeaders.slice(0, 6).map((h) => (
                        <Th key={h}>{h}</Th>
                      ))}
                    </Tr>
                  </Thead>
                  <Tbody>
                    {preview.previewRows.map((row, i) => (
                      <Tr key={i}>
                        {preview.normalizedHeaders.slice(0, 6).map((h) => (
                          <Td key={h} className="max-w-[140px] truncate text-xs">
                            {row[h] ?? '—'}
                          </Td>
                        ))}
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void runImport()} disabled={!preview.ready || uploading}>
                    {uploading ? 'Importing…' : `Import ${preview.rowCount} claims`}
                  </Button>
                  <Button variant="secondary" onClick={() => { setStep('prepare'); setFile(null); setPreview(null) }}>
                    Choose different file
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {step === 'result' && result && (
            <Card>
              <CardHeader title="Step 3 — Import complete" />
              <div className="space-y-4">
                <div className="flex flex-wrap gap-3">
                  <Badge color="green">{result.imported} imported</Badge>
                  <Badge>{result.skipped} skipped</Badge>
                  {result.failed > 0 && <Badge color="red">{result.failed} failed</Badge>}
                  {result.validationPassed === false && <Badge color="amber">Validation drift</Badge>}
                </div>
                <p className="text-sm text-gray-600">
                  Claims are in your work queue. CollectRx will schedule carrier follow-up during business hours (Mon–Fri 8am–5pm ET).
                </p>
                {result.rowErrors.length > 0 && (
                  <div className="text-sm">
                    <p className="font-medium mb-2">Row errors</p>
                    <ul className="list-disc pl-4 space-y-1 text-gray-600 max-h-40 overflow-y-auto">
                      {result.rowErrors.slice(0, 20).map((e, i) => (
                        <li key={i}>
                          {e.row != null ? `Row ${e.row}: ` : ''}{e.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => navigate('/insurance?tab=queue')}>View claims queue</Button>
                  <Button variant="secondary" onClick={() => navigate('/ar-command-center')}>
                    AR command center
                  </Button>
                  <Button variant="ghost" onClick={() => { setStep('prepare'); setFile(null); setPreview(null); setResult(null) }}>
                    Import another file
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </DataState>
  )
}
