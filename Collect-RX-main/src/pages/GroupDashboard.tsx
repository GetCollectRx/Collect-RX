import { useState, useEffect } from 'react'
import { apiFetchJson } from '../lib/apiFetch'

interface PracticeSummary {
  id: string
  name: string
  subscriptionStatus: string | null
  totalClaims: number
  resolvedClaims: number
  resolutionRate: number
  outstandingAR: number
  activeUsers: number
}

export default function GroupDashboard() {
  const [practices, setPractices] = useState<PracticeSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetchJson<{ practices: PracticeSummary[] }>('/api/group/practices-summary')
      .then(d => setPractices(d.practices))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  const totalOutstandingAR = practices.reduce((s, p) => s + p.outstandingAR, 0)
  const totalClaims = practices.reduce((s, p) => s + p.totalClaims, 0)
  const avgResolutionRate = practices.length
    ? Math.round(practices.reduce((s, p) => s + p.resolutionRate, 0) / practices.length)
    : 0

  function statusBadge(status: string | null) {
    if (status === 'active') return 'text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-900/20'
    if (status === 'trialing') return 'text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/20'
    if (status === 'past_due') return 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/20'
    return 'text-gray-500 bg-gray-100 dark:bg-gray-800'
  }

  return (
    <div className="page-enter p-6 space-y-6 max-w-[1200px]">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Group overview</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Aggregate performance across all practice locations.</p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!loading && !error && (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Locations',           value: practices.length.toString() },
              { label: 'Total claims',         value: totalClaims.toLocaleString() },
              { label: 'Avg resolution rate',  value: `${avgResolutionRate}%` },
              { label: 'Outstanding AR',       value: `$${totalOutstandingAR.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
            ].map(t => (
              <div key={t.label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 px-4 py-4">
                <p className="text-2xs text-gray-400 dark:text-gray-500 uppercase tracking-wide font-medium">{t.label}</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{t.value}</p>
              </div>
            ))}
          </div>

          {/* Per-practice table */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  {['Practice', 'Status', 'Claims', 'Resolution', 'Outstanding AR', 'Active staff'].map(h => (
                    <th key={h} scope="col" className="px-4 py-3 text-left text-2xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {practices.map((p, i) => (
                  <tr key={p.id} className={i < practices.length - 1 ? 'border-b border-gray-50 dark:border-gray-800/50' : ''}>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{p.name}</td>
                    <td className="px-4 py-3">
                      <span className={`text-2xs font-medium px-1.5 py-0.5 rounded-full ${statusBadge(p.subscriptionStatus)}`}>
                        {p.subscriptionStatus ?? 'no plan'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{p.totalClaims.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-crx-500"
                            style={{ width: `${p.resolutionRate}%` }}
                          />
                        </div>
                        <span className="text-gray-700 dark:text-gray-300">{p.resolutionRate}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                      ${p.outstandingAR.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{p.activeUsers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {practices.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">No practice data available.</p>
            )}
          </div>
        </>
      )}

      {loading && <p className="text-sm text-gray-400">Loading…</p>}
    </div>
  )
}
