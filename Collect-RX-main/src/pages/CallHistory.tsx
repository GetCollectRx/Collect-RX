import { useCallback, useEffect, useState } from 'react'
import { usePracticePageGate } from '../hooks/usePracticePageGate'
import { resolveApiUrl } from '../lib/resolveApiUrl'
import { parseApiJson } from '../lib/parseApiJson'
import {
  callOutcomeLabel,
  carrierLabel,
  outcomeBadgeColor,
  CARRIER_LABELS,
} from '../lib/recoveryDisplay'
import {
  Button, Select, DataState,
  TableContainer, Table, Thead, Tbody, Th, Tr, Td, TableEmpty, Badge,
} from '../components/ui'

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

function formatDurationSec(sec: number | null): string {
  if (sec == null) return 'N/A'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function CallHistory() {
  const { practiceId, canFetch, pageBusy, pageError } = usePracticePageGate()
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [carrier, setCarrier] = useState('')
  const [outcome, setOutcome] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    const q = new URLSearchParams({ page: String(page), limit: '25' })
    if (carrier) q.set('carrier', carrier)
    if (outcome) q.set('outcome', outcome)
    try {
      const res = await fetch(resolveApiUrl(`/api/desk/${practiceId}/history?${q}`), {
        credentials: 'include',
      })
      const json = await parseApiJson<{
        data: HistoryRow[]
        pagination: { pages: number; total?: number }
      }>(res)
      setRows(json.data)
      setPages(json.pagination.pages)
      setTotal(json.pagination.total ?? json.data.length)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [practiceId, page, carrier, outcome])

  useEffect(() => {
    if (!canFetch) return
    void load()
  }, [load, canFetch])

  return (
    <DataState loading={pageBusy(loading)} error={pageError(error)}>
      <div className="page-enter">

        {/* ── Page header ── */}
        <div className="px-6 pt-6 pb-5 border-b border-gray-100 dark:border-gray-800/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="page-title">Call History</h1>
            <p className="page-subtitle mt-0.5">All AI-placed calls with outcomes, durations, and recordings.</p>
          </div>
        </div>

        <div className="p-6 space-y-5 max-w-5xl">

          {/* ── Filters ── */}
          <div className="flex flex-wrap gap-2.5 items-center">
            <Select
              value={carrier}
              onChange={(e) => { setCarrier(e.target.value); setPage(1) }}
              aria-label="Filter by carrier"
            >
              <option value="">All carriers</option>
              {Object.entries(CARRIER_LABELS).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </Select>

            <Select
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
            </Select>

            {!loading && total > 0 && (
              <span className="ml-auto text-xs text-gray-400 dark:text-gray-600 font-medium">
                {total} call{total !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* ── Table ── */}
          {loading ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="skeleton h-10 rounded-lg" />
              ))}
            </div>
          ) : (
            <TableContainer>
              <Table>
                <Thead>
                  <Tr>
                    <Th>Outcome</Th>
                    <Th>Claim</Th>
                    <Th>Carrier</Th>
                    <Th>When</Th>
                    <Th>Duration</Th>
                    <Th>Detail</Th>
                    <Th />
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.length === 0 ? (
                    <TableEmpty colSpan={7} message="No calls match these filters." />
                  ) : (
                    rows.map((r) => (
                      <Tr key={r.id}>
                        <Td>
                          <Badge color={outcomeBadgeColor(r.outcome)} dot>
                            {callOutcomeLabel(r.outcome)}
                          </Badge>
                        </Td>
                        <Td bold>{r.claim.claimNumber}</Td>
                        <Td muted>{carrierLabel(r.claim.carrierId)}</Td>
                        <Td muted className="text-xs tabular-nums whitespace-nowrap">
                          {formatDate(r.initiatedAt)}
                        </Td>
                        <Td muted className="font-mono text-xs tabular-nums">
                          {formatDurationSec(r.durationSeconds)}
                        </Td>
                        <Td className="max-w-[180px]">
                          {r.outcomeDetail ? (
                            <span className="text-xs text-gray-500 dark:text-gray-500 truncate block">
                              {r.outcomeDetail}
                            </span>
                          ) : r.outcome === 'NO_ANSWER' ? (
                            <span className="text-xs text-gray-400 dark:text-gray-600">Retry via queue</span>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-700">N/A</span>
                          )}
                        </Td>
                        <Td>
                          {r.transcriptUrl && (
                            <a
                              href={r.transcriptUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-medium text-emerald-600 dark:text-emerald-500 hover:underline"
                            >
                              Recording ↗
                            </a>
                          )}
                        </Td>
                      </Tr>
                    ))
                  )}
                </Tbody>
              </Table>
            </TableContainer>
          )}

          {/* ── Pagination ── */}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Previous
              </Button>
              <span className="text-xs text-gray-500 dark:text-gray-500 tabular-nums">
                Page {page} of {pages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </Button>
            </div>
          )}
        </div>
      </div>
    </DataState>
  )
}
