import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../../context/PracticeContext'
import { apiFetchJson } from '../../lib/apiFetch'
import { workQueuePriorityLabel } from '../../lib/workQueuePriority'
import { carrierLabel } from '../../lib/recoveryDisplay'

interface WorkItemRow {
  id: string
  sourceId: string
  title: string | null
  dollarsAtRisk: string | number
  daysOutstanding: number
  carrierId: string | null
  rankScore: number
}

function fmtMoney(v: string | number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(v))
}

/** Top open claims by work-queue rank — dashboard command center slice. */
export function TopMoneyAtRisk({ limit = 5 }: { limit?: number }) {
  const { practiceId } = usePractice()
  const [rows, setRows] = useState<WorkItemRow[]>([])

  const load = useCallback(async () => {
    if (!practiceId) return
    try {
      const res = await apiFetchJson<{ success: boolean; items: WorkItemRow[] }>(
        `/api/work-queue?limit=${limit}&status=open`,
      )
      const sorted = [...(res.items ?? [])].sort((a, b) => b.rankScore - a.rankScore)
      setRows(sorted.slice(0, limit))
    } catch {
      setRows([])
    }
  }, [practiceId, limit])

  useEffect(() => {
    void load()
  }, [load])

  if (rows.length === 0) return null

  return (
    <section className="living-chart-panel p-5 relative z-10" aria-label="Top money at risk">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="living-chart-title text-base">Top money at risk</p>
          <p className="crx-sub mt-1">Highest-priority open claims CollectRx is working.</p>
        </div>
        <Link to="/insurance?tab=queue" className="crx-btn-ghost shrink-0 text-sm">
          Priority queue →
        </Link>
      </div>
      <ul className="divide-y divide-gray-200/80 dark:divide-gray-700/80">
        {rows.map((row) => {
          const { label, color } = workQueuePriorityLabel(row.rankScore)
          const claimRef = row.title?.replace(/^Claim\s+/i, '') ?? row.sourceId.slice(0, 8)
          return (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <Link
                  to={`/insurance/${row.sourceId}`}
                  className="text-sm font-semibold text-gray-900 dark:text-gray-100 hover:underline"
                >
                  {claimRef}
                </Link>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {row.carrierId ? carrierLabel(row.carrierId) : 'Carrier'} · {row.daysOutstanding}d ·{' '}
                  {fmtMoney(row.dollarsAtRisk)}
                </p>
              </div>
              <span className={`text-xs font-semibold shrink-0 ${color}`}>{label}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
