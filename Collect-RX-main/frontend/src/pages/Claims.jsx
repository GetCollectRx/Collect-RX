import { useState, useEffect } from 'react'
import { api } from '../api'

const STATUS_COLORS = {
  queued:      'bg-sky-100 text-sky-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  resolved:    'bg-green-100 text-green-700',
  escalated:   'bg-red-100 text-red-700',
  paused:      'bg-gray-100 text-gray-600',
  excluded:    'bg-gray-100 text-gray-400',
}

export default function Claims() {
  const [claims, setClaims]   = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ queue_status: '', carrier: '', bucket: '' })
  const [selected, setSelected] = useState(null)
  const [detail, setDetail]   = useState(null)
  const [pauseReason, setPauseReason] = useState('')

  async function load() {
    setLoading(true)
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
      const res = await api.listClaims({ ...params, limit: 200 })
      setClaims(res.claims || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filters])

  async function openDetail(claim) {
    setSelected(claim)
    try {
      const res = await api.getClaim(claim.id)
      setDetail(res)
    } catch {
      setDetail(null)
    }
  }

  async function handlePause(id) {
    if (!pauseReason.trim()) return alert('Enter a reason')
    await api.pauseClaim(id, pauseReason)
    setPauseReason('')
    setSelected(null)
    load()
  }

  async function handleUnpause(id) {
    await api.unpauseClaim(id)
    setSelected(null)
    load()
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Claims</h1>

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap">
        {[
          { key: 'queue_status', label: 'Status', opts: ['queued','in_progress','resolved','escalated','paused','excluded'] },
          { key: 'bucket',       label: 'Aging',  opts: ['0-29','30-59','60-89','90-119','120+'] },
        ].map(({ key, label, opts }) => (
          <select
            key={key}
            value={filters[key]}
            onChange={e => setFilters(f => ({ ...f, [key]: e.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white shadow-sm"
          >
            <option value="">All {label}</option>
            {opts.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}
        <input
          placeholder="Filter by carrier..."
          value={filters.carrier}
          onChange={e => setFilters(f => ({ ...f, carrier: e.target.value }))}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white shadow-sm w-48"
        />
        <span className="ml-auto text-sm text-gray-400 self-center">{claims.length} claims</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Patient', 'Carrier', 'Outstanding', 'Aging', 'Status', 'Attempts', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            ) : claims.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No claims found.</td></tr>
            ) : claims.map(c => (
              <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {c.patient_first_name} {c.patient_last_name}
                </td>
                <td className="px-4 py-3 text-gray-600">{c.carrier_name}</td>
                <td className="px-4 py-3 font-semibold text-gray-900">${parseFloat(c.amount_outstanding).toFixed(2)}</td>
                <td className="px-4 py-3 text-gray-500">{c.aging_bucket}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[c.queue_status] || 'bg-gray-100 text-gray-500'}`}>
                    {c.queue_status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500">{c.call_attempts}</td>
                <td className="px-4 py-3">
                  <button onClick={() => openDetail(c)} className="text-sky-600 hover:underline text-xs font-medium">
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={() => setSelected(null)}>
          <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold">{selected.patient_first_name} {selected.patient_last_name}</h2>
                <p className="text-sm text-gray-400">{selected.carrier_name} · {selected.policy_number}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>

            <div className="p-6 space-y-5">
              {/* Key fields */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ['Amount Outstanding', `$${parseFloat(selected.amount_outstanding).toFixed(2)}`],
                  ['Amount Billed',      `$${parseFloat(selected.amount_billed || 0).toFixed(2)}`],
                  ['Days Outstanding',   selected.days_outstanding],
                  ['Aging Bucket',       selected.aging_bucket],
                  ['Queue Status',       selected.queue_status],
                  ['Call Attempts',      selected.call_attempts],
                  ['Priority Score',     selected.priority_score],
                  ['Procedure Code',     selected.procedure_code],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs text-gray-400">{label}</p>
                    <p className="font-medium text-gray-900">{value || '—'}</p>
                  </div>
                ))}
              </div>

              {/* Call history */}
              <div>
                <h3 className="font-semibold text-sm mb-2">Call History</h3>
                {detail?.callHistory?.length ? (
                  <div className="space-y-2">
                    {detail.callHistory.map(a => (
                      <div key={a.id} className="border border-gray-100 rounded-lg p-3 text-xs">
                        <div className="flex justify-between mb-1">
                          <span className="font-medium">{a.outcome_code || a.status}</span>
                          <span className="text-gray-400">{new Date(a.created_at).toLocaleDateString()}</span>
                        </div>
                        {a.vapi_summary && <p className="text-gray-500">{a.vapi_summary}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">No calls made yet.</p>
                )}
              </div>

              {/* Actions */}
              <div className="border-t border-gray-100 pt-4 space-y-3">
                {selected.queue_status === 'paused' ? (
                  <button onClick={() => handleUnpause(selected.id)} className="w-full py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700">
                    Return to Queue
                  </button>
                ) : (
                  <>
                    <input
                      placeholder="Pause reason..."
                      value={pauseReason}
                      onChange={e => setPauseReason(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    />
                    <button onClick={() => handlePause(selected.id)} className="w-full py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
                      Pause Claim
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
