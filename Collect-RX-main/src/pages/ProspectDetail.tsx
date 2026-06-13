import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiFetchJson } from '../lib/apiFetch'
import { Card, CardHeader, Badge, DataState } from '../components/ui'

type ProspectStage =
  | 'new' | 'contacted' | 'engaged' | 'qualified'
  | 'demo_scheduled' | 'proposal_sent'
  | 'closed_won' | 'closed_lost' | 'not_interested'

type ProspectEvent = {
  id: string
  type: string
  metadata: Record<string, unknown> | null
  occurredAt: string
}

type ProspectSequence = {
  id: string
  sequenceType: string
  status: string
  currentStep: number
  totalSteps: number
  nextRunAt: string | null
  startedAt: string
}

type Prospect = {
  id: string
  name: string
  city: string | null
  province: string | null
  postalCode: string | null
  phone: string | null
  email: string | null
  website: string | null
  practiceSize: string | null
  pmsGuess: string | null
  source: string
  stage: ProspectStage
  score: number
  notes: string | null
  optedOutAt: string | null
  createdAt: string
  updatedAt: string
  sequences: ProspectSequence[]
  events: ProspectEvent[]
}

const STAGE_OPTIONS: { value: ProspectStage; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'engaged', label: 'Engaged' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'demo_scheduled', label: 'Demo Booked' },
  { value: 'proposal_sent', label: 'Proposal Sent' },
  { value: 'closed_won', label: 'Closed Won' },
  { value: 'closed_lost', label: 'Closed Lost' },
  { value: 'not_interested', label: 'Not Interested' },
]

const STAGE_COLORS: Record<ProspectStage, string> = {
  new: 'gray', contacted: 'blue', engaged: 'amber', qualified: 'purple',
  demo_scheduled: 'indigo', proposal_sent: 'blue',
  closed_won: 'green', closed_lost: 'red', not_interested: 'gray',
}

const EVENT_LABELS: Record<string, string> = {
  email_sent: 'Email sent',
  email_opened: 'Email opened',
  email_clicked: 'Email clicked',
  email_replied: 'Email replied (AI classified)',
  email_bounced: 'Email bounced',
  call_attempted: 'Call attempted',
  call_connected: 'Call connected — AI summary generated',
  call_outcome: 'Call outcome recorded',
  demo_booked: 'Demo booked',
  stage_changed: 'Stage changed',
  note_added: 'Note added',
  unsubscribed: 'Unsubscribed',
  harvested: 'Added via harvest',
}

function EventIcon({ type }: { type: string }) {
  if (type.startsWith('email_')) {
    return (
      <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
        <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </div>
    )
  }
  if (type.startsWith('call_')) {
    return (
      <div className="w-7 h-7 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
        <svg className="w-3.5 h-3.5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
      </div>
    )
  }
  return (
    <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center shrink-0">
      <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    </div>
  )
}

export default function ProspectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [prospect, setProspect] = useState<Prospect | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)

  // Edit state
  const [editNotes, setEditNotes] = useState('')
  const [editStage, setEditStage] = useState<ProspectStage>('new')
  const [editScore, setEditScore] = useState(50)
  const [editPms, setEditPms] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetchJson<{ prospect: Prospect }>(`/api/marketing/prospects/${id}`)
      setProspect(res.prospect)
      setEditNotes(res.prospect.notes ?? '')
      setEditStage(res.prospect.stage)
      setEditScore(res.prospect.score)
      setEditPms(res.prospect.pmsGuess ?? '')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function saveChanges() {
    if (!prospect) return
    setSaving(true)
    try {
      await apiFetchJson(`/api/marketing/prospects/${prospect.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: editNotes, stage: editStage, score: editScore, pmsGuess: editPms }),
      })
      setActionFeedback('Saved')
      await load()
    } catch (e) {
      setActionFeedback(`Error: ${(e as Error).message}`)
    } finally {
      setSaving(false)
      setTimeout(() => setActionFeedback(null), 3000)
    }
  }

  async function startSequence() {
    if (!prospect) return
    setSaving(true)
    try {
      const res = await apiFetchJson<{ sequenceId: string; alreadyActive: boolean }>(
        `/api/marketing/prospects/${prospect.id}/sequence/start`,
        { method: 'POST' }
      )
      setActionFeedback(res.alreadyActive ? 'Email cadence already active' : 'Email cadence started')
      await load()
    } catch (e) {
      setActionFeedback(`Error: ${(e as Error).message}`)
    } finally {
      setSaving(false)
      setTimeout(() => setActionFeedback(null), 4000)
    }
  }

  async function stopSequence() {
    if (!prospect) return
    setSaving(true)
    try {
      await apiFetchJson(`/api/marketing/prospects/${prospect.id}/sequence/stop`, { method: 'POST' })
      setActionFeedback('Sequence stopped')
      await load()
    } catch (e) {
      setActionFeedback(`Error: ${(e as Error).message}`)
    } finally {
      setSaving(false)
      setTimeout(() => setActionFeedback(null), 3000)
    }
  }

  async function startCall() {
    if (!prospect) return
    setSaving(true)
    try {
      const res = await apiFetchJson<{ callId: string }>(
        `/api/marketing/prospects/${prospect.id}/call`,
        { method: 'POST' }
      )
      setActionFeedback(`Call initiated — Vapi ID: ${res.callId}`)
      await load()
    } catch (e) {
      setActionFeedback(`Error: ${(e as Error).message}`)
    } finally {
      setSaving(false)
      setTimeout(() => setActionFeedback(null), 6000)
    }
  }

  const activeSeq = prospect?.sequences.find((s) => s.status === 'active')

  return (
    <DataState loading={loading} error={error} isEmpty={!loading && !prospect} emptyTitle="Prospect not found">
      {prospect && (
        <div className="page-enter p-6 space-y-6 max-w-[1100px]">
          {/* Back + header */}
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/partnerships')} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Pipeline
            </button>
            <span className="text-gray-300 dark:text-gray-600">/</span>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{prospect.name}</h1>
            <Badge color={STAGE_COLORS[prospect.stage] as 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'indigo'}>
              {STAGE_OPTIONS.find((o) => o.value === prospect.stage)?.label}
            </Badge>
            {prospect.optedOutAt && <Badge color="red">Opted out</Badge>}
          </div>

          {actionFeedback && (
            <div className="text-sm bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 rounded-lg px-4 py-2">
              {actionFeedback}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: details + edit */}
            <div className="lg:col-span-2 space-y-5">
              {/* Contact info */}
              <Card>
                <CardHeader title="Contact info" />
                <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
                  {[
                    ['City / Province', [prospect.city, prospect.province].filter(Boolean).join(', ') || '—'],
                    ['Postal code', prospect.postalCode || '—'],
                    ['Phone', prospect.phone || '—'],
                    ['Email', prospect.email || '—'],
                    ['Website', prospect.website || '—'],
                    ['Source', prospect.source],
                    ['Practice size', prospect.practiceSize || 'Unknown'],
                    ['Score', String(prospect.score)],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                      <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{value}</p>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Edit panel */}
              <Card>
                <CardHeader title="Manage" />
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Stage</label>
                      <select
                        value={editStage}
                        onChange={(e) => setEditStage(e.target.value as ProspectStage)}
                        className="w-full text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-1.5"
                      >
                        {STAGE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Score (0–100)</label>
                      <input
                        type="number" min={0} max={100} value={editScore}
                        onChange={(e) => setEditScore(parseInt(e.target.value) || 0)}
                        className="w-full text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-1.5"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">PMS (dental software)</label>
                    <input
                      type="text" value={editPms}
                      onChange={(e) => setEditPms(e.target.value)}
                      placeholder="Abeldent, Dentrix, unknown…"
                      className="w-full text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
                    <textarea
                      rows={3} value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      className="w-full text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-3 py-1.5 resize-none"
                    />
                  </div>
                  <button
                    onClick={saveChanges} disabled={saving}
                    className="text-sm px-4 py-1.5 rounded bg-crx-600 text-white hover:bg-crx-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </Card>

              {/* Activity timeline */}
              <Card>
                <CardHeader title="Activity" subtitle={`${prospect.events.length} events`} />
                {prospect.events.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 mt-3 italic">No events yet</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {prospect.events.map((ev) => (
                      <div key={ev.id} className="flex items-start gap-3">
                        <EventIcon type={ev.type} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 dark:text-gray-200 font-medium">
                            {EVENT_LABELS[ev.type] ?? ev.type}
                          </p>
                    {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 space-y-0.5">
                        {/* AI call summary */}
                        {ev.type === 'call_connected' && typeof ev.metadata['summary'] === 'string' && (
                          <p className="bg-blue-50 dark:bg-blue-900/20 rounded px-2 py-1 text-blue-800 dark:text-blue-300">
                            {ev.metadata['summary']}
                          </p>
                        )}
                        {ev.type === 'call_connected' && Array.isArray(ev.metadata['painPoints']) && (ev.metadata['painPoints'] as string[]).length > 0 && (
                          <p><span className="font-medium">Pain points:</span> {(ev.metadata['painPoints'] as string[]).join(', ')}</p>
                        )}
                        {/* AI reply classification */}
                        {ev.type === 'email_replied' && typeof ev.metadata['intent'] === 'string' && (
                          <p className="bg-amber-50 dark:bg-amber-900/20 rounded px-2 py-1 text-amber-800 dark:text-amber-300">
                            Intent: <strong>{ev.metadata['intent']}</strong>
                            {typeof ev.metadata['objectionType'] === 'string' && ` · ${ev.metadata['objectionType']}`}
                            {typeof ev.metadata['summary'] === 'string' && ` — ${ev.metadata['summary']}`}
                          </p>
                        )}
                        {ev.type === 'email_replied' && typeof ev.metadata['suggestedReply'] === 'string' && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-crx-600 dark:text-crx-400 hover:underline">View suggested reply</summary>
                            <p className="mt-1 bg-gray-50 dark:bg-gray-700 rounded p-2 whitespace-pre-wrap">{ev.metadata['suggestedReply']}</p>
                          </details>
                        )}
                        {/* Fallback: show key metadata as text */}
                        {ev.type !== 'call_connected' && ev.type !== 'email_replied' && (
                          <p className="truncate">
                            {Object.entries(ev.metadata)
                              .filter(([k]) => !['action', 'bodySnippet'].includes(k))
                              .slice(0, 4)
                              .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                              .join(' · ')}
                          </p>
                        )}
                      </div>
                    )}
                        </div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap shrink-0">
                          {new Date(ev.occurredAt).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* Right: actions + sequences */}
            <div className="space-y-5">
              {/* Actions */}
              <Card>
                <CardHeader title="Actions" />
                <div className="mt-3 space-y-2">
                  {!prospect.optedOutAt && prospect.email && (
                    <>
                      {activeSeq ? (
                        <button
                          onClick={stopSequence} disabled={saving}
                          className="w-full text-sm px-3 py-2 rounded border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                        >
                          Stop email cadence
                        </button>
                      ) : (
                        <button
                          onClick={startSequence} disabled={saving}
                          className="w-full text-sm px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          Start email cadence
                        </button>
                      )}
                    </>
                  )}
                  {prospect.optedOutAt && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 italic">Email opted out — no outreach allowed</p>
                  )}
                  {!prospect.email && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 italic">Add an email address to start a cadence</p>
                  )}
                  {prospect.phone && (
                    <button
                      onClick={startCall} disabled={saving}
                      className="w-full text-sm px-3 py-2 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                    >
                      Call (Sales Qualifier)
                    </button>
                  )}
                </div>
              </Card>

              {/* Active sequences */}
              <Card>
                <CardHeader title="Sequences" />
                {prospect.sequences.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 mt-3 italic">No sequences</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {prospect.sequences.map((seq) => (
                      <div key={seq.id} className="text-sm">
                        <div className="flex items-center gap-2">
                          <Badge color={seq.status === 'active' ? 'green' : seq.status === 'completed' ? 'blue' : 'gray'}>
                            {seq.status}
                          </Badge>
                          <span className="text-gray-700 dark:text-gray-300 capitalize">
                            {seq.sequenceType.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          Step {seq.currentStep}/{seq.totalSteps}
                          {seq.nextRunAt && seq.status === 'active' && (
                            <> · Next: {new Date(seq.nextRunAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Metadata */}
              <Card>
                <CardHeader title="Record info" />
                <div className="mt-3 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <p>Created: {new Date(prospect.createdAt).toLocaleDateString('en-CA')}</p>
                  <p>Updated: {new Date(prospect.updatedAt).toLocaleDateString('en-CA')}</p>
                  <p className="font-mono truncate text-gray-400 dark:text-gray-600">{prospect.id}</p>
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}
    </DataState>
  )
}
