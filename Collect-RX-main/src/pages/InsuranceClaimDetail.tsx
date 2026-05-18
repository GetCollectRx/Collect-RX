import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import { Card, CardHeader, Button, Badge, DataState, Select } from '../components/ui'

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

const NEXT_ACTIONS = ['appeal', 'write-off', 'resubmit', 'escalate'] as const

export default function InsuranceClaimDetail() {
  const { id } = useParams()
  const [claim, setClaim] = useState<ClaimDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nextAction, setNextAction] = useState<string>('')

  const load = () => {
    if (!id) return
    setLoading(true)
    apiFetchJson<{ success: boolean; data: ClaimDetail }>(`/api/insurance/claims/${id}`)
      .then((res) => setClaim(res.data))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  const confirmPayment = async () => {
    if (!id) return
    await apiFetch(`/api/insurance/claims/${id}/confirm-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: nextAction ? `Next: ${nextAction}` : undefined }),
    })
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

          <Card>
            <CardHeader title="Amounts" />
            <dl className="grid grid-cols-2 gap-4 text-sm px-4 pb-4">
              <div><dt className="text-gray-500">Billed</dt><dd className="font-medium">${Number(claim.billedAmount).toFixed(2)}</dd></div>
              <div><dt className="text-gray-500">Outstanding</dt><dd className="font-medium">${Number(claim.outstandingAmount).toFixed(2)}</dd></div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Next action" />
            <div className="px-4 pb-4 flex flex-wrap gap-3 items-end">
              <Select value={nextAction} onChange={(e) => setNextAction(e.target.value)} aria-label="Next action">
                <option value="">Select…</option>
                {NEXT_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </Select>
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
