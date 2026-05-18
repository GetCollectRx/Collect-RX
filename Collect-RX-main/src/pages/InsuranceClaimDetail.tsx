import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import { Card, CardHeader, Button, Badge, DataState, Select, Input } from '../components/ui'

interface CallAttempt {
  id: string
  initiatedAt: string
  completedAt: string | null
  outcome: string | null
  outcomeDetail: string | null
  repName: string | null
  referenceNumber: string | null
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

export default function InsuranceClaimDetail() {
  const { id } = useParams()
  const [claim, setClaim] = useState<ClaimDetail | null>(null)
  const [workItem, setWorkItem] = useState<WorkItemLite | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nextAction, setNextAction] = useState('')
  const [assignedRep, setAssignedRep] = useState('')
  const [notes, setNotes] = useState('')
  const [triggering, setTriggering] = useState(false)
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
            <Badge>{claim.status}</Badge>
          </div>

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
                    <label className="text-sm">
                      <span className="block text-gray-500 mb-1">Assigned rep</span>
                      <Input value={assignedRep} onChange={(e) => setAssignedRep(e.target.value)} className="w-48" />
                    </label>
                    <Select value={nextAction} onChange={(e) => setNextAction(e.target.value)} aria-label="Next action">
                      <option value="">Next action…</option>
                      {NEXT_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </Select>
                  </div>
                  <label className="text-sm block">
                    <span className="block text-gray-500 mb-1">Notes</span>
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => void saveWorkItem()}>Save assignment</Button>
                    <Button size="sm" variant="secondary" onClick={() => void triggerCall()} disabled={triggering}>
                      {triggering ? 'Queueing…' : 'Trigger carrier call'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Resolve in ledger" />
            <div className="px-4 pb-4">
              <Button size="sm" onClick={() => void confirmPayment()}>Record payment / resolve</Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="Voice queue history" subtitle="Call outcomes from Vapi" />
            <div className="px-4 pb-4 space-y-4">
              {claim.callAttempts.length === 0 ? (
                <p className="text-sm text-gray-500">No calls yet.</p>
              ) : (
                claim.callAttempts.map((a) => (
                  <div key={a.id} className="border-l-2 border-crx-400 pl-4">
                    <p className="text-sm font-medium">{a.outcome ?? 'pending'} · {new Date(a.initiatedAt).toLocaleString()}</p>
                    {a.outcomeDetail && <p className="text-xs text-gray-600 mt-1">{a.outcomeDetail}</p>}
                    {a.repName && <p className="text-xs text-gray-400">Rep: {a.repName} · Ref: {a.referenceNumber}</p>}
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}
    </DataState>
  )
}
