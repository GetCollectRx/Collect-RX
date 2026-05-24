import { useCallback, useEffect, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { resolveApiUrl } from '../lib/resolveApiUrl'
import { parseApiJson } from '../lib/parseApiJson'

type HistoryRow = {
  id: string
  vapiCallId: string
  outcome: string | null
  outcomeDetail: string | null
  transcriptUrl: string | null
  liveState: string | null
  initiatedAt: string
  completedAt: string | null
  durationSeconds: number | null
  activeAgent: string | null
  claim: {
    claimNumber: string
    carrierId: string
    outstandingAmount: string
  }
}

const CARRIER_LABELS: Record<string, string> = {
  sun_life: 'Sun Life',
  canada_life: 'Canada Life',
  manulife: 'Manulife',
  green_shield: 'Green Shield',
  rbc: 'RBC',
  telus_adjudicare: 'TELUS AdjudiCare',
}

export default function CallHistory() {
  const { practiceId } = usePractice()
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [carrier, setCarrier] = useState('')
  const [outcome, setOutcome] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!practiceId) return
    setLoading(true)
    const q = new URLSearchParams({ page: String(page), limit: '25' })
    if (carrier) q.set('carrier', carrier)
    if (outcome) q.set('outcome', outcome)
    const res = await fetch(resolveApiUrl(`/api/desk/${practiceId}/history?${q}`), {
      credentials: 'include',
    })
    const json = await parseApiJson<{
      data: HistoryRow[]
      pagination: { pages: number }
    }>(res)
    setRows(json.data)
    setPages(json.pagination.pages)
    setLoading(false)
  }, [practiceId, page, carrier, outcome])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Call history</h1>

      <div className="flex flex-wrap gap-3 mb-4">
        <select
          className="text-sm border rounded px-2 py-1 dark:bg-gray-900"
          value={carrier}
          onChange={(e) => { setCarrier(e.target.value); setPage(1) }}
          aria-label="Filter by carrier"
        >
          <option value="">All carriers</option>
          {Object.entries(CARRIER_LABELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <select
          className="text-sm border rounded px-2 py-1 dark:bg-gray-900"
          value={outcome}
          onChange={(e) => { setOutcome(e.target.value); setPage(1) }}
          aria-label="Filter by outcome"
        >
          <option value="">All outcomes</option>
          <option value="RESOLVED">Resolved</option>
          <option value="PENDING">Pending</option>
          <option value="DENIED">Denied</option>
          <option value="NO_ANSWER">No answer</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-left text-2xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Outcome</th>
                <th className="px-3 py-2">Claim</th>
                <th className="px-3 py-2">Carrier</th>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-3 py-2">
                    <span className="text-xs font-medium">{r.outcome ?? '—'}</span>
                  </td>
                  <td className="px-3 py-2">{r.claim.claimNumber}</td>
                  <td className="px-3 py-2">{CARRIER_LABELS[r.claim.carrierId] ?? r.claim.carrierId}</td>
                  <td className="px-3 py-2">{new Date(r.initiatedAt).toLocaleString()}</td>
                  <td className="px-3 py-2">{r.durationSeconds != null ? `${r.durationSeconds}s` : '—'}</td>
                  <td className="px-3 py-2 space-x-2">
                    {r.transcriptUrl && (
                      <a
                        href={r.transcriptUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-crx-600 text-xs hover:underline"
                      >
                        Recording
                      </a>
                    )}
                    {r.outcome === 'NO_ANSWER' && (
                      <span className="text-xs text-gray-500">Retry via queue</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-2 mt-4 justify-center">
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <span className="text-xs self-center">Page {page} of {pages}</span>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={page >= pages}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  )
}
