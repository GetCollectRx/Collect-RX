import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import StatCard from '../components/StatCard'

export default function Dashboard() {
  const [stats, setStats]         = useState(null)
  const [queue, setQueue]         = useState([])
  const [escalations, setEscalations] = useState([])
  const [running, setRunning]     = useState(false)
  const [runResult, setRunResult] = useState(null)
  const [loading, setLoading]     = useState(true)

  async function load() {
    try {
      const [s, q, e] = await Promise.all([
        api.getQueueStats(),
        api.buildQueue(),
        api.listEscalations(),
      ])
      setStats(s.stats)
      setQueue(q.queue || [])
      setEscalations(e.escalations || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleRunQueue() {
    if (!window.confirm(`Dispatch ${queue.length} calls to Vapi now?`)) return
    setRunning(true)
    setRunResult(null)
    try {
      const res = await api.runQueue()
      setRunResult(res)
      load()
    } catch (err) {
      setRunResult({ error: err.message })
    } finally {
      setRunning(false)
    }
  }

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>

  const s = stats || {}

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date().toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <button
          onClick={handleRunQueue}
          disabled={running || queue.length === 0}
          className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors shadow-sm"
        >
          {running ? 'Dispatching...' : `Run Queue (${queue.length} calls)`}
        </button>
      </div>

      {/* Run result banner */}
      {runResult && (
        <div className={`rounded-lg p-4 text-sm font-medium ${runResult.error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {runResult.error
            ? `Error: ${runResult.error}`
            : `✓ Dispatched ${runResult.dispatched} calls. ${runResult.failed} failed.`}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Queued"      value={s.queued}      color="sky"    sub="ready to call" />
        <StatCard label="In Progress" value={s.in_progress} color="yellow" sub="calls active" />
        <StatCard label="Escalations" value={s.escalated}   color="red"    sub="need attention" />
        <StatCard label="Resolved"    value={s.resolved}    color="green"  sub="all time" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Next queue */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Next Queue Preview</h2>
            <span className="text-xs bg-sky-100 text-sky-700 font-medium px-2 py-0.5 rounded-full">{queue.length} claims</span>
          </div>
          {queue.length === 0 ? (
            <p className="p-5 text-sm text-gray-400">No eligible claims in queue.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {queue.slice(0, 8).map(c => (
                <div key={c.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {c.patient_first_name} {c.patient_last_name}
                    </p>
                    <p className="text-xs text-gray-400">{c.carrier_name} · {c.aging_bucket} days</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">${parseFloat(c.amount_outstanding).toFixed(0)}</p>
                    <p className="text-xs text-gray-400">score {c.priority_score}</p>
                  </div>
                </div>
              ))}
              {queue.length > 8 && (
                <p className="px-5 py-2 text-xs text-gray-400">+{queue.length - 8} more</p>
              )}
            </div>
          )}
        </div>

        {/* Open escalations */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Open Escalations</h2>
            <Link to="/escalations" className="text-xs text-sky-600 hover:underline">View all</Link>
          </div>
          {escalations.length === 0 ? (
            <p className="p-5 text-sm text-gray-400">No open escalations. 🎉</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {escalations.slice(0, 5).map(e => (
                <div key={e.id} className="px-5 py-3">
                  <div className="flex items-start justify-between">
                    <p className="text-sm font-medium text-gray-900">{e.reason || 'Escalation'}</p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ml-2 ${
                      e.urgency === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>{e.urgency || 'normal'}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{e.notes}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
