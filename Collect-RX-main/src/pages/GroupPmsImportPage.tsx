import { useState, useEffect } from 'react'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import { parseCsvFile } from '../lib/csvClientPreview'
import type { PmsVendorCatalogEntry } from '../types/pms'

interface PracticeOption {
  id: string
  name: string
}

interface ImportRow {
  practiceId: string
  pmsVendor: string
  file: File | null
}

interface ImportResult {
  practiceId: string
  success: boolean
  runId?: string
  imported?: number
  skipped?: number
  failed?: number
  error?: string
}

export default function GroupPmsImportPage() {
  const [practices, setPractices] = useState<PracticeOption[]>([])
  const [vendors, setVendors] = useState<PmsVendorCatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [results, setResults] = useState<ImportResult[] | null>(null)

  useEffect(() => {
    Promise.all([
      apiFetchJson<{ practices: PracticeOption[] }>('/api/group/practices-summary'),
      apiFetchJson<{ vendors: PmsVendorCatalogEntry[] }>('/api/pms/catalog').catch(() => ({ vendors: [] })),
    ])
      .then(([p, v]) => {
        setPractices(p.practices)
        setVendors(v.vendors)
        setRows(p.practices.length ? [{ practiceId: p.practices[0].id, pmsVendor: 'other', file: null }] : [])
      })
      .catch(e => setLoadError((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  function addRow() {
    setRows(rs => [...rs, { practiceId: practices[0]?.id ?? '', pmsVendor: 'other', file: null }])
  }

  function removeRow(index: number) {
    setRows(rs => rs.filter((_, i) => i !== index))
  }

  function updateRow(index: number, patch: Partial<ImportRow>) {
    setRows(rs => rs.map((r, i) => i === index ? { ...r, ...patch } : r))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    setResults(null)
    const withFiles = rows.filter(r => r.file)
    if (withFiles.length === 0) {
      setSubmitError('Add at least one file before running the batch import.')
      return
    }
    setBusy(true)
    try {
      const imports = await Promise.all(withFiles.map(async (r) => {
        // r.file is guaranteed set — withFiles was filtered above.
        const text = await r.file!.text()
        return { practiceId: r.practiceId, pmsVendor: r.pmsVendor, records: parseCsvFile(text) }
      }))
      const empty = imports.filter(i => i.records.length === 0)
      if (empty.length > 0) {
        setSubmitError(`No data rows found in the file for ${practices.find(p => p.id === empty[0].practiceId)?.name ?? 'a selected practice'}.`)
        return
      }

      const res = await apiFetch('/api/group/pms-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imports }),
      })
      // A payload over the server's limit is rejected before any route runs, so
      // the response is not JSON — parsing it unconditionally would surface a
      // parse error instead of the real cause.
      const body = await res.json().catch(() => null) as { error?: string; results?: ImportResult[] } | null
      if (!res.ok) {
        setSubmitError(
          res.status === 413
            ? 'These files are too large to import in one batch. Run the import in smaller groups of locations.'
            : body?.error ?? 'Batch import failed',
        )
        return
      }
      setResults(body?.results ?? [])
    } catch (e) {
      setSubmitError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="page-enter p-6"><p className="text-sm text-gray-400">Loading…</p></div>

  return (
    <div className="page-enter p-6 space-y-6 max-w-[900px]">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Batch PMS import</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Import PMS export files for multiple locations in one run.
        </p>
      </div>

      {loadError && <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}

      {!loadError && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((row, i) => (
              <div key={i} className="px-5 py-4 flex items-center gap-3 flex-wrap">
                <select
                  value={row.practiceId}
                  onChange={e => updateRow(i, { practiceId: e.target.value })}
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                >
                  {practices.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select
                  value={row.pmsVendor}
                  onChange={e => updateRow(i, { pmsVendor: e.target.value })}
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                >
                  <option value="other">Other / CSV export</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.displayName}</option>)}
                </select>
                <input
                  type="file"
                  accept=".csv"
                  onChange={e => updateRow(i, { file: e.target.files?.[0] ?? null })}
                  className="text-sm text-gray-700 dark:text-gray-300"
                />
                {rows.length > 1 && (
                  <button type="button" onClick={() => removeRow(i)} className="text-2xs text-red-600 dark:text-red-400 hover:underline ml-auto">
                    Remove
                  </button>
                )}
              </div>
            ))}
            {practices.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">No practices in your organization yet.</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button type="button" onClick={addRow} className="text-sm font-medium text-crx-600 hover:underline">
              + Add another practice
            </button>
            <button
              type="submit"
              disabled={busy || practices.length === 0}
              className="text-sm font-medium px-4 py-2 rounded-lg bg-crx-500 text-white hover:bg-crx-600 disabled:opacity-50 ml-auto"
            >
              {busy ? 'Importing…' : 'Run batch import'}
            </button>
          </div>

          {submitError && <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>}
        </form>
      )}

      {results && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                {['Practice', 'Result', 'Imported', 'Skipped', 'Failed'].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-2xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map(r => (
                <tr key={r.practiceId} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                  <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">
                    {practices.find(p => p.id === r.practiceId)?.name ?? r.practiceId}
                  </td>
                  <td className="px-4 py-2">
                    {r.success
                      ? <span className="text-2xs font-medium px-1.5 py-0.5 rounded-full text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-900/20">Success</span>
                      : <span className="text-2xs font-medium px-1.5 py-0.5 rounded-full text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-900/20">{r.error ?? 'Failed'}</span>}
                  </td>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{r.imported ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{r.skipped ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{r.failed ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
