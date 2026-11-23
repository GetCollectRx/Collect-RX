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

interface AgingProblem {
  code: string
  field: string | null
  message: string
  suggestion?: string
}

interface AgingSpecField {
  id: string
  column: string
  label: string
  meaning: string
  example: string
  alsoAccepted: string[]
}

interface AgingCheck {
  accepted: boolean
  rowCount: number
  problems: AgingProblem[]
}

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
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<AgingCheck | null>(null)
  const [spec, setSpec] = useState<{ fields: AgingSpecField[]; templateHeader: string } | null>(null)
  const [result, setResult] = useState<{
    imported: number
    skipped: number
    failed: number
    validationPassed: boolean | null
    runId?: string
    rowErrors: { row?: number; message?: string }[]
    claimsClosedAsMissing: number
    missingClaimsWarning: string | null
  } | null>(null)
  const [fullExport, setFullExport] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canFetch) return
    setLoading(true)
    Promise.all([
      apiFetchJson<{ vendors: PmsVendorCatalogEntry[] }>('/api/pms/catalog').catch(() => ({ vendors: [] })),
      apiFetchJson<{ success: boolean; data: PracticePmsInfo }>('/api/pms/context').catch(() => ({ success: false, data: null })),
      apiFetchJson<{ success: boolean; data: { fields: AgingSpecField[]; templateHeader: string } }>('/api/admin/sync/aging-report-spec').catch(() => null),
    ])
      .then(([cat, ctx, specRes]) => {
        if (specRes?.data) setSpec(specRes.data)
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
    setCheck(null)
    setError(null)
    if (!f) {
      setPreview(null)
      setStep('prepare')
      return
    }
    const text = await f.text()
    const p = previewCsvFile(text)
    setPreview(p)
    setStep('preview')
    // The server decides whether the file is accepted, using the same rules the import applies.
    setChecking(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const r = await apiFetch('/api/admin/sync/import-check', { method: 'POST', body: fd })
      const j = (await r.json().catch(() => ({}))) as { error?: string; data?: AgingCheck }
      if (!r.ok || !j.data) throw new Error(j.error ?? 'Could not check the file')
      setCheck(j.data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setChecking(false)
    }
  }, [])

  const downloadTemplate = () => {
    if (!spec) return
    const url = URL.createObjectURL(new Blob([`${spec.templateHeader}\n`], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'collectrx-aging-report-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const runImport = async () => {
    if (!file || !check?.accepted) return
    setUploading(true)
    setError(null)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('exportScope', fullExport ? 'full' : 'partial')
    try {
      const r = await apiFetch(`/api/admin/sync/import/${vendor}`, { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({})) as {
        error?: string
        imported?: number
        skipped?: number
        failed?: number
        validationPassed?: boolean
        runId?: string
        claimsClosedAsMissing?: number
        missingClaimsWarning?: string | null
      }
      if (!r.ok) {
        const refused = j as { code?: string; problems?: AgingProblem[] }
        if (refused.code === 'AGING_REPORT_REJECTED' && Array.isArray(refused.problems)) {
          setCheck({ accepted: false, rowCount: preview?.rowCount ?? 0, problems: refused.problems })
          throw new Error('This file was not accepted. Nothing was imported.')
        }
        throw new Error(j.error ?? 'Import failed')
      }
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
        claimsClosedAsMissing: j.claimsClosedAsMissing ?? 0,
        missingClaimsWarning: j.missingClaimsWarning ?? null,
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
            Upload your insurance aging report as a CSV. The file must have the columns listed below, filled in, or it will not be accepted.
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
                  <li>In your practice software, run the <strong>insurance aging report</strong> (outstanding insurance claims, not patient balances), one row per claim.</li>
                  <li>Export it as a <strong>CSV</strong>. The first row must be the column names.</li>
                  <li>Make sure every column in the table below is there and filled in. Rename a column if your report calls it something else.</li>
                  <li>Drop the file below. We check it before anything is imported. If a column is missing, empty or unclear, the whole file is refused and we tell you what to fix.</li>
                </ol>
                {spec && (
                  <div className="overflow-x-auto">
                    <Table>
                      <Thead>
                        <Tr>
                          <Th>Column name</Th>
                          <Th>What it is</Th>
                          <Th>Example</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {spec.fields.map((f) => (
                          <Tr key={f.id}>
                            <Td className="align-top"><code className="text-xs">{f.column}</code></Td>
                            <Td className="align-top text-xs">
                              {f.meaning}
                              {f.alsoAccepted.length > 0 && (
                                <span className="block text-gray-500 mt-1">Also accepted: {f.alsoAccepted.slice(0, 8).join(', ')}</span>
                              )}
                            </Td>
                            <Td className="align-top text-xs">{f.example}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={downloadTemplate} disabled={!spec}>
                    Download blank template
                  </Button>
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
                {checking && <p className="text-sm text-gray-600">Checking the file…</p>}
                {check && !check.accepted && (
                  <div className="crx-alert px-4 py-3 text-sm" role="alert">
                    <p className="font-semibold">This file will not be accepted. Fix the following and upload it again.</p>
                    <ul className="mt-1 list-disc pl-4 space-y-1">
                      {check.problems.map((p, i) => (
                        <li key={`${p.code}-${p.field ?? i}`}>
                          {p.message}
                          {p.suggestion && <span className="block text-xs">{p.suggestion}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {check?.accepted && (
                  <p className="text-sm text-emerald-700 dark:text-emerald-300">The file has every required column. Rows with a problem are held back with a reason, and the rest import.</p>
                )}
                {check?.accepted && (
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
                <label htmlFor="csv-full-export" className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    id="csv-full-export"
                    type="checkbox"
                    className="mt-0.5"
                    checked={fullExport}
                    onChange={(e) => setFullExport(e.target.checked)}
                  />
                  <span>
                    This file lists all of our open insurance claims.
                    <span className="block text-xs text-gray-500">
                      Open claims missing from the file are treated as resolved in your practice software, and CollectRx stops calling about them. Untick this for a partial or date-ranged export.
                    </span>
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void runImport()} disabled={!check?.accepted || checking || uploading}>
                    {uploading ? 'Importing…' : `Import ${preview.rowCount} claims`}
                  </Button>
                  <Button variant="secondary" onClick={() => { setStep('prepare'); setFile(null); setPreview(null); setCheck(null) }}>
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
                  {result.claimsClosedAsMissing > 0 && (
                    <Badge>{result.claimsClosedAsMissing} closed as resolved in your software</Badge>
                  )}
                </div>
                {result.missingClaimsWarning && (
                  <div className="crx-alert px-4 py-3 text-sm" role="alert">
                    {result.missingClaimsWarning}
                  </div>
                )}
                <p className="text-sm text-gray-600">
                  Claims are in your work queue. Eligible claims are scheduled for carrier-status follow-up during business hours (Mon–Fri 8am–5pm ET); claims that need staff action remain in the work queue.
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
