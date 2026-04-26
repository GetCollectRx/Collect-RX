import { useState, useEffect } from 'react'
import { api } from '../api'

export default function Escalations() {
  const [escalations, setEscalations] = useState([])
  const [loading, setLoading]         = useState(true)
  const [resolving, setResolving]     = useState({})
  const [notes, setNotes]             = useState({})

  async function load() {
    setLoading(true)
    try {
      const res = await api.listEscalations()
      setEscalations(res.escalations || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleResolve(id) {
    const n = notes[id]?.trim()
    if (!n) return alert('Add resolution notes first')
    setResolving(r => ({ ...r, [id]: true }))
    try {
      await api.resolveEscalation(id, n)
      load()
    } finally {
      setResolving(r => ({ ...r, [id]: false }))
    }
  }

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Escalations</h1>
        <span className="text-sm text-gray-400">{escalations.length} open</span>
      </div>

      {escalations.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-4xl mb-3">🎉</p>
          <p className="font-semibold text-gray-700">No open escalations</p>
          <p className="text-sm text-gray-400 mt-1">The AI resolved everything in the queue.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {escalations.map(e => (
            <div key={e.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    e.urgency === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {e.urgency === 'urgent' ? '🚨 Urgent' : '⚠️ Normal'}
                  </span>
                  <span className="text-xs text-gray-400">#{e.id} · Claim {e.claim_id}</span>
                </div>
                <span className="text-xs text-gray-400">{new Date(e.created_at).toLocaleDateString()}</span>
              </div>

              <p className="font-semibold text-gray-900">{e.reason}</p>
              {e.notes && <p className="text-sm text-gray-500 mt-1">{e.notes}</p>}

              <div className="mt-4 flex gap-2">
                <input
                  placeholder="Resolution notes..."
                  value={notes[e.id] || ''}
                  onChange={ev => setNotes(n => ({ ...n, [e.id]: ev.target.value }))}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
                <button
                  onClick={() => handleResolve(e.id)}
                  disabled={resolving[e.id]}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {resolving[e.id] ? 'Saving...' : 'Resolve'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
