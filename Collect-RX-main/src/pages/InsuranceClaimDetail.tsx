import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import { Card, CardHeader, Button, Badge, DataState, Select, Input } from '../components/ui'
import { useRoleAccess } from '../lib/useRoleAccess'

interface CallAttempt {
  id: string
  initiatedAt: string
  completedAt: string | null
  durationSeconds: number | null
  outcome: string | null
  outcomeDetail: string | null
  repName: string | null
  referenceNumber: string | null
  transcriptUrl: string | null
}

interface ClaimDetail {
  id: string
  claimNumber: string
  carrierId: string
  status: string
  billedAmount: string | number
  outstandingAmount: string | number
  daysOutstanding: number
  servicedAt: string | null
  callAttempts: CallAttempt[]
  queueEntry: { status: string; attempts: number; scheduledFor: string } | null
}

interface WorkItemLite {
  id: string
  assignedRep: string | null
  notes: string | null
  followUpAt: string | null
}

const NEXT_ACTIONS = ['appeal', 'write-off', 'resubmit', 'escalate'] as const

const OUTCOME_LABELS: Record<string, string> = {
  RESOLVED:                'Resolved',
  DENIED:                  'Denied',
  ESCALATED:               'Escalated — needs your call',
  PENDING:                 'Pending',
  BLOCK_DETECTED:          'Carrier block detected',
  FAILED:                  'Call failed',
  NO_ANSWER:               'No answer',
  HUNG_UP:                 'Call ended unexpectedly',
  APPROVED_PENDING_PAYMENT: 'Approved — awaiting payment',
}

function outcomeColor(outcome: string | null) {
  if (!outcome) return 'text-gray-500'
  if (outcome === 'RESOLVED' || outcome === 'APPROVED_PENDING_PAYMENT') return 'text-green-700 dark:text-green-400'
  if (outcome === 'ESCALATED') return 'text-amber-700 dark:text-amber-400'
  if (outcome === 'DENIED' || outcome === 'BLOCK_DETECTED') return 'text-red-700 dark:text-red-400'
  return 'text-gray-600 dark:text-gray-400'
}

function fmtDuration(seconds: number | null) {
  if (!seconds) return null
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

export default function InsuranceClaimDetail() {
  const { id } = useParams()
  const { isReadOnly, canInitiateCalls } = useRoleAccess()
  const [claim, setClaim] = useState<ClaimDetail | null>(null)
  const [workItem, setWorkItem] = useState<WorkItemLite | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nextAction, setNextAction] = useState('')
  const [assignedRep, setAssignedRep] = useState('')
  const [notes, setNotes] = useState('')
  const [triggering, setTriggering] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolveNotes, setResolveNotes] = useState('')
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const load = () => {
    if (!id) return
    setLoading(true)
    Promise.all([
      apiFetchJson<{ success: boolean; data: ClaimDetail }>(`/api/insurance/claims/${id}`),
      apiFetchJson<{ success: boolean; data: WorkItemLite | null }>(
        `/api/work-queue/by-source/insurance_claim/${id}`,
      ),
    ])
      .then(([claimRes, wiRes]) => {
        setClaim(claimRes.data)
        const wi = wiRes.data
        setWorkItem(wi)
        setAssignedRep(wi?.assignedRep ?? '')
        setNotes(wi?.notes ?? '')
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  const saveWorkItem = async () => {
    if (!workItem) return
    const noteText = nextAction
      ? [notes, `Next: ${nextAction}`].filter(Boolean).join(' · ')
      : notes
    await apiFetch(`/api/work-queue/${workItem.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedRep: assignedRep || null, notes: noteText || null }),
    })
    setActionMsg('Assignment saved')
    load()
  }

  const triggerCall = async () => {
    if (!id) return
    setTriggering(true)
    setActionMsg(null)
    try {
      const r = await apiFetch(`/api/insurance/queue/trigger/${id}`, { method: 'POST' })
      const j = await r.json().catch(() => ({})) as { error?: string; success?: boolean }
      if (!r.ok) throw new Error(j.error ?? 'Could not trigger call')
      setActionMsg('Call queued')
      load()
    } catch (e) {
      setActionMsg((e as Error).message)
    } finally {
      setTriggering(false)
    }
  }

  const resolveEscalation = async () => {
    if (!id) return
    setResolving(true)
    setActionMsg(null)
    try {
      const r = await apiFetch(`/api/insurance/claims/${id}/resolve-escalation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: resolveNotes || undefined }),
      })
      const j = await r.json().catch(() => ({})) as { error?: string; success?: boolean }
      if (!r.ok) throw new Error(j.error ?? 'Could not resolve claim')
      setActionMsg('Claim marked resolved')
      setResolveNotes('')
      load()
    } catch (e) {
      setActionMsg((e as Error).message)
    } finally {
      setResolving(false)
    }
  }

  const confirmPayment = async () => {
    if (!id) return
    await apiFetch(`/api/insurance/claims/${id}/confirm-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: nextAction ? `Next: ${nextAction}` : undefined }),
    })
    setActionMsg('Payment recorded')
    load()
  }

  const isEscalated = claim?.status === 'ESCALATED'

  return (
    <DataState loading={loading} error={error} isEmpty={!claim} emptyTitle="Claim not found">
      {claim && (
        <div className="page-enter p-6 space-y-6 max-w-4xl">
          <div className="flex items-center gap-3">
            <Link to="/insurance"><Button variant="ghost" size="sm">← Insurance AR</Button></Link>
            <div className="flex-1">
              <h1 className="page-title">Claim {claim.claimNumber}</h1>
              <p className="page-subtitle">{claim.carrierId} · {claim.daysOutstanding} days outstanding</p>
            </div>
            <Badge color={isEscalated ? 'amber' : undefined}>{claim.status}</Badge>
          </div>

          {/* ── Escalation banner ── */}
          {isEscalated && (
            <div className="rounded-2xl border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-5 space-y-4">
              <div className="flex items-start gap-3">
                <span className="text-amber-500 text-xl leading-none mt-0.5">⚠</span>
                <div>
                  <h2 className="text-sm font-bold text-amber-900 dark:text-amber-300">AI handed off — your call required</h2>
                  <p className="text-xs text-amber-800 dark:text-amber-400 mt-1 leading-relaxed">
                    The AI reached the carrier but hit a wall it can't cross — a supervisor, appeals department, or written
                    dispute is needed. Read the AI's call summary below, then call the carrier directly to resolve it.
                    Once resolved, mark it done here.
                  </p>
                </div>
              </div>

              {!isReadOnly && (
                <div className="border-t border-amber-200 dark:border-amber-800 pt-4 space-y-3">
                  <p className="text-xs font-semibold text-amber-900 dark:text-amber-300 uppercase tracking-wide">
                    After your call
                  </p>
                  <Input
                    value={resolveNotes}
                    onChange={(e) => setResolveNotes(e.target.value)}
                    placeholder="Optional — outcome notes (e.g. 'Spoke with supervisor Jane, claim reprocessing in 5–7 days')"
                    className="text-sm"
                  />
                  <Button
                    size="sm"
                    onClick={() => void resolveEscalation()}
                    disabled={resolving}
                  >
                    {resolving ? 'Saving…' : '✓ Mark resolved — I called the carrier'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {claim.queueEntry && (
            <p className="text-xs text-gray-500 -mt-4">
              Voice queue: {claim.queueEntry.status} · {claim.queueEntry.attempts} attempt(s) · next{' '}
              {new Date(claim.queueEntry.scheduledFor).toLocaleString()}
            </p>
          )}

          {actionMsg && (
            <p className="text-sm text-crx-600 dark:text-crx-400" role="status">{actionMsg}</p>
          )}

          <Card>
            <CardHeader title="Amounts" />
            <dl className="grid grid-cols-2 gap-4 text-sm px-4 pb-4">
              <div><dt className="text-gray-500">Billed</dt><dd className="font-medium">${Number(claim.billedAmount).toFixed(2)}</dd></div>
              <div><dt className="text-gray-500">Outstanding</dt><dd className="font-medium">${Number(claim.outstandingAmount).toFixed(2)}</dd></div>
            </dl>
          </Card>

          {/* ── AI Call Summary ── */}
          <Card>
            <CardHeader
              title="AI call summary"
              subtitle={
                isEscalated
                  ? 'What the AI found out before handing off to you'
                  : 'Outcomes from each voice agent call'
              }
            />
            <div className="px-4 pb-4 space-y-4">
              {claim.callAttempts.length === 0 ? (
                <p className="text-sm text-gray-500">No calls yet.</p>
              ) : (
                claim.callAttempts.map((a, i) => {
                  const isEscalatedAttempt = a.outcome === 'ESCALATED'
                  return (
                    <div
                      key={a.id}
                      className={`rounded-xl border p-4 space-y-2 ${
                        isEscalatedAttempt
                          ? 'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10'
                          : 'border-gray-100 dark:border-gray-800'
                      }`}
                    >
                      {/* Header row */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-400 dark:text-gray-600">
                            Call {i + 1}
                          </span>
                          <span className={`text-sm font-semibold ${outcomeColor(a.outcome)}`}>
                            {OUTCOME_LABELS[a.outcome ?? ''] ?? a.outcome ?? 'In progress'}
                          </span>
                        </div>
                        <span className="text-xs text-gray-400">
                          {new Date(a.initiatedAt).toLocaleString()}
                          {a.durationSeconds ? ` · ${fmtDuration(a.durationSeconds)}` : ''}
                        </span>
                      </div>

                      {/* Escalation explanation */}
                      {isEscalatedAttempt && (
                        <div className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded-lg px-3 py-2 leading-relaxed">
                          <strong>Why it was escalated:</strong>{' '}
                          {a.outcomeDetail ?? 'The carrier required a supervisor or appeals department that the AI could not access.'}
                        </div>
                      )}

                      {/* Non-escalation outcome detail */}
                      {!isEscalatedAttempt && a.outcomeDetail && (
                        <p className="text-xs text-gray-600 dark:text-gray-400">{a.outcomeDetail}</p>
                      )}

                      {/* Rep + reference */}
                      {(a.repName || a.referenceNumber) && (
                        <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-500">
                          {a.repName && <span>Rep spoken with: <span className="font-medium text-gray-700 dark:text-gray-300">{a.repName}</span></span>}
                          {a.referenceNumber && <span>Reference #: <span className="font-medium text-gray-700 dark:text-gray-300 font-mono">{a.referenceNumber}</span></span>}
                        </div>
                      )}

                      {/* Transcript link */}
                      {a.transcriptUrl && (
                        <a
                          href={a.transcriptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-crx-500 hover:text-crx-600 dark:hover:text-crx-400 transition-colors"
                        >
                          View full call transcript →
                        </a>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </Card>

          {!isReadOnly && (
            <Card>
              <CardHeader title="Staff assignment" subtitle="Stored on the unified work queue row" />
              <div className="px-4 pb-4 space-y-3">
                {!workItem ? (
                  <p className="text-sm text-gray-500">
                    No work queue row yet.{' '}
                    <Link to="/work-queue" className="text-crx-600 underline">Refresh from sources</Link> on the work queue.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-3 items-end">
                      <div className="text-sm">
                        <label htmlFor="detail-assigned-rep" className="block text-gray-500 mb-1">Assigned rep</label>
                        <Input id="detail-assigned-rep" value={assignedRep} onChange={(e) => setAssignedRep(e.target.value)} className="w-48" />
                      </div>
                      <Select value={nextAction} onChange={(e) => setNextAction(e.target.value)} aria-label="Next action">
                        <option value="">Next action…</option>
                        {NEXT_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                      </Select>
                    </div>
                    <div className="text-sm">
                      <label htmlFor="detail-notes" className="block text-gray-500 mb-1">Notes</label>
                      <Input id="detail-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => void saveWorkItem()}>Save assignment</Button>
                      {canInitiateCalls && (
                        <Button size="sm" variant="secondary" onClick={() => void triggerCall()} disabled={triggering}>
                          {triggering ? 'Queueing…' : 'Trigger carrier call'}
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </Card>
          )}

          {!isReadOnly && !isEscalated && (
            <Card>
              <CardHeader title="Record payment / resolve" />
              <div className="px-4 pb-4">
                <Button size="sm" onClick={() => void confirmPayment()}>Record payment</Button>
              </div>
            </Card>
          )}
        </div>
      )}
    </DataState>
  )
}
