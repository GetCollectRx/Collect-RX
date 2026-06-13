import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetchJson } from '../lib/apiFetch'
import { Card, CardHeader, Badge, DataState } from '../components/ui'

type ProspectStage =
  | 'new' | 'contacted' | 'engaged' | 'qualified'
  | 'demo_scheduled' | 'proposal_sent'
  | 'closed_won' | 'closed_lost' | 'not_interested'

type ProspectCard = {
  id: string
  name: string
  city: string | null
  province: string | null
  score: number
  stage: ProspectStage
  updatedAt: string
  email: string | null
  phone: string | null
}

type PipelineColumn = {
  stage: ProspectStage
  count: number
  prospects: ProspectCard[]
}

type PipelineResponse = { pipeline: PipelineColumn[] }

type Stats = {
  total: number
  active: number
  emailsSent: number
  demoBooked: number
  byStage: Record<string, number>
}

const STAGE_LABELS: Record<ProspectStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  engaged: 'Engaged',
  qualified: 'Qualified',
  demo_scheduled: 'Demo Booked',
  proposal_sent: 'Proposal Sent',
  closed_won: 'Won',
  closed_lost: 'Lost',
  not_interested: 'Not Interested',
}

const STAGE_COLORS: Record<ProspectStage, string> = {
  new: 'gray',
  contacted: 'blue',
  engaged: 'amber',
  qualified: 'purple',
  demo_scheduled: 'indigo',
  proposal_sent: 'blue',
  closed_won: 'green',
  closed_lost: 'red',
  not_interested: 'gray',
}

const ACTIVE_STAGES: ProspectStage[] = ['new', 'contacted', 'engaged', 'qualified', 'demo_scheduled', 'proposal_sent']

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 75 ? 'green' : score >= 50 ? 'amber' : 'gray'
  return <Badge color={color as 'green' | 'amber' | 'gray'}>{score}</Badge>
}

function StatBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-center">
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
    </div>
  )
}

function ProspectKanbanCard({ prospect, onClick }: { prospect: ProspectCard; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:border-crx-400 dark:hover:border-crx-500 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-sm text-gray-900 dark:text-gray-100 leading-snug line-clamp-2">{prospect.name}</p>
        <ScoreBadge score={prospect.score} />
      </div>
      {(prospect.city || prospect.province) && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {[prospect.city, prospect.province].filter(Boolean).join(', ')}
        </p>
      )}
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
        {new Date(prospect.updatedAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
      </p>
    </button>
  )
}

type AddProspectModalProps = {
  onClose: () => void
  onSaved: () => void
}

function AddProspectModal({ onClose, onSaved }: AddProspectModalProps) {
  const [form, setForm] = useState({ name: '', city: '', province: '', phone: '', email: '', website: '', pmsGuess: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await apiFetchJson('/api/marketing/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function field(key: keyof typeof form, label: string, placeholder = '') {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
        <input
          type="text"
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          placeholder={placeholder}
          className="w-full text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:ring-1 focus:ring-crx-500 outline-none"
        />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Add prospect</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          {field('name', 'Practice name *', 'Downtown Dental')}
          <div className="grid grid-cols-2 gap-3">
            {field('city', 'City', 'Toronto')}
            {field('province', 'Province', 'ON')}
          </div>
          {field('phone', 'Phone', '+1 416-555-0100')}
          {field('email', 'Email', 'office@example.com')}
          {field('website', 'Website', 'https://example.com')}
          {field('pmsGuess', 'PMS (dental software)', 'Abeldent, Dentrix…')}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:ring-1 focus:ring-crx-500 outline-none resize-none"
            />
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="text-sm px-4 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="text-sm px-4 py-1.5 rounded bg-crx-600 text-white hover:bg-crx-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Add prospect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

type HarvestModalProps = {
  onClose: () => void
  onDone: (result: { found: number; created: number; skipped: number }) => void
}

function HarvestModal({ onClose, onDone }: HarvestModalProps) {
  const [form, setForm] = useState({ city: '', province: '', maxResults: '20' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const result = await apiFetchJson<{ found: number; created: number; skipped: number; errors: number }>(
        '/api/marketing/harvest',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ city: form.city, province: form.province, maxResults: parseInt(form.maxResults) }),
        }
      )
      onDone(result)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Harvest prospects</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Search Google Places for dental practices in a city and import them as prospects. Requires <code className="font-mono text-xs">GOOGLE_PLACES_API_KEY</code>.
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">City *</label>
            <input
              type="text"
              value={form.city}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              placeholder="Toronto"
              className="w-full text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:ring-1 focus:ring-crx-500 outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Province</label>
              <input type="text" value={form.province} onChange={(e) => setForm((f) => ({ ...f, province: e.target.value }))} placeholder="ON" className="w-full text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:ring-1 focus:ring-crx-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Max results</label>
              <input type="number" min={1} max={60} value={form.maxResults} onChange={(e) => setForm((f) => ({ ...f, maxResults: e.target.value }))} className="w-full text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:ring-1 focus:ring-crx-500 outline-none" />
            </div>
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="text-sm px-4 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button type="submit" disabled={loading || !form.city} className="text-sm px-4 py-1.5 rounded bg-crx-600 text-white hover:bg-crx-700 disabled:opacity-50">
              {loading ? 'Searching…' : 'Run harvest'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Partnerships() {
  const navigate = useNavigate()
  const [pipeline, setPipeline] = useState<PipelineColumn[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showHarvest, setShowHarvest] = useState(false)
  const [harvestResult, setHarvestResult] = useState<{ found: number; created: number; skipped: number } | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [pipelineRes, statsRes] = await Promise.all([
        apiFetchJson<PipelineResponse>('/api/marketing/pipeline'),
        apiFetchJson<Stats>('/api/marketing/stats'),
      ])
      setPipeline(pipelineRes.pipeline)
      setStats(statsRes)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  return (
    <div className="page-enter p-6 space-y-6 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Partnerships</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
            Outbound prospect pipeline — dental practices to partner with
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => setShowHarvest(true)}
            className="text-sm px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 1 0 6.6 6.6a7.5 7.5 0 0 0 10.05 10.05z" />
            </svg>
            Harvest
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="text-sm px-3 py-1.5 rounded bg-crx-600 text-white hover:bg-crx-700 flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add prospect
          </button>
        </div>
      </div>

      {/* Harvest result banner */}
      {harvestResult && (
        <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3">
          <p className="text-sm text-green-800 dark:text-green-300">
            Harvest complete — {harvestResult.found} found, <strong>{harvestResult.created} new</strong>, {harvestResult.skipped} duplicates skipped
          </p>
          <button onClick={() => setHarvestResult(null)} className="text-green-600 dark:text-green-400 hover:text-green-800 text-lg leading-none">×</button>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatBox label="Total prospects" value={stats.total} />
          <StatBox label="Active pipeline" value={stats.active} />
          <StatBox label="Emails sent" value={stats.emailsSent} />
          <StatBox label="Demos booked" value={stats.demoBooked} />
        </div>
      )}

      <DataState loading={loading} error={error} isEmpty={!loading && pipeline.length === 0} emptyTitle="No pipeline data">
        {/* Kanban board — active stages only */}
        <Card padding="none">
          <div className="p-5 pb-3">
            <CardHeader title="Active pipeline" subtitle="Top 10 per stage — click a card to manage" />
          </div>
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-3 px-5 pb-2" style={{ minWidth: `${ACTIVE_STAGES.length * 220}px` }}>
              {ACTIVE_STAGES.map((stage) => {
                const col = pipeline.find((c) => c.stage === stage)
                  return (
                    <div key={stage} className="w-52 shrink-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                          {STAGE_LABELS[stage]}
                        </span>
                        <Badge color={STAGE_COLORS[stage] as 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'indigo'}>
                          {col?.count ?? 0}
                        </Badge>
                      </div>
                    <div className="space-y-2 min-h-[120px]">
                      {(col?.prospects ?? []).map((p) => (
                        <ProspectKanbanCard
                          key={p.id}
                          prospect={p}
                          onClick={() => navigate(`/partnerships/${p.id}`)}
                        />
                      ))}
                      {(col?.count ?? 0) === 0 && (
                        <p className="text-xs text-gray-400 dark:text-gray-600 italic pt-3 text-center">Empty</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </Card>

        {/* Closed/terminal stages row */}
        <div className="grid grid-cols-3 gap-4">
          {(['closed_won', 'closed_lost', 'not_interested'] as ProspectStage[]).map((stage) => {
            const col = pipeline.find((c) => c.stage === stage)
            return (
              <Card key={stage} padding="sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{STAGE_LABELS[stage]}</span>
                  <Badge color={STAGE_COLORS[stage] as 'green' | 'red' | 'gray'}>{col?.count ?? 0}</Badge>
                </div>
                <div className="space-y-1">
                  {(col?.prospects ?? []).slice(0, 3).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => navigate(`/partnerships/${p.id}`)}
                      className="w-full text-left text-xs text-gray-600 dark:text-gray-400 hover:text-crx-600 dark:hover:text-crx-400 truncate"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </Card>
            )
          })}
        </div>
      </DataState>

      {showAdd && (
        <AddProspectModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); loadData() }}
        />
      )}
      {showHarvest && (
        <HarvestModal
          onClose={() => setShowHarvest(false)}
          onDone={(result) => {
            setShowHarvest(false)
            setHarvestResult(result)
            loadData()
          }}
        />
      )}
    </div>
  )
}
