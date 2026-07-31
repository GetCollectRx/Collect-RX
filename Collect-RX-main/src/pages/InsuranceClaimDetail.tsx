import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import { Card, CardHeader, Button, Badge, DataState, Select, Input } from '../components/ui'
import { ClaimNextActionCard, ClaimTimeline } from '../components/claims/ClaimTimeline'
import {
  OUTCOME_LABELS,
  mapTriggerCallError,
  outcomeColor,
  fmtCallDuration,
  recallDueLabelDetailed,
  recoveryRouteBadgeColor,
  claimStatusLabel,
  isDemoVapiCall,
} from '../lib/recoveryDisplay'
import { ClaimStatusStrip } from '../components/claims/ClaimStatusStrip'
import { SimulatedCallBadge } from '../components/claims/SimulatedCallBadge'
import { useAppToast } from '../context/ToastContext'
import { useRoleAccess } from '../lib/useRoleAccess'

interface CallAttempt {
  id: string
  vapiCallId?: string | null
  initiatedAt: string
  completedAt: string | null
  durationSeconds: number | null
  outcome: string | null
  outcomeDetail: string | null
  repName: string | null
  referenceNumber: string | null
  transcriptUrl: string | null
  validationPassed?: boolean | null
  validationResult?: { escalationReason?: string; safetyScore?: number } | null
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
  recoveryRoute?: string | null
  paymentExpectedBy?: string | null
  callAttempts: CallAttempt[]
  queueEntry: { status: string; attempts: number; scheduledFor: string } | null
}

interface RecoveryActionView {
  id: string
  actionType: string
  status: string
  title: string
  detail: string | null
  scheduledRecallAt: string | null
  createdAt: string
  blocking: boolean
}

interface RecoveryEventView {
  id: string
  eventType: string
  amountRecoveredCents: number | null
  previousOutstanding: number | null
  newOutstanding: number | null
  createdAt: string
  metadata?: Record<string, unknown> | null
}

interface RecoverySummary {
  recoveryRoute: string | null
  routeLabel: string
  routeDescription: string
  paymentExpectedBy: string | null
  scheduledRecallAt: string | null
  queueStatus: string | null
  queueAttempts: number
  stopCalling: boolean
  canCallCarrier: boolean
  dispatchBlockReason: string | null
  openActions: RecoveryActionView[]
  recentEvents: RecoveryEventView[]
  dollarsRecoveredSyncVerified: number
  cdcpCaseId: string | null
  cdcpCaseStatus: string | null
  claimStatus?: string | null
}

interface WorkItemLite {
  id: string
  assignedRep: string | null
  notes: string | null
  followUpAt: string | null
}

interface EvidenceItem {
  id: string
  evidenceType: string
  status: string
  attestedAt: string | null
  note: string | null
}

interface ClaimSubmission {
  id: string
  method: string
  referenceNumber: string | null
  submittedAt: string
}

const NEXT_ACTIONS = ['appeal', 'write-off', 'resubmit', 'escalate'] as const

export default function InsuranceClaimDetail() {
  const { id } = useParams()
  const { isReadOnly, canInitiateCalls, canClearGates, canResolveEscalations } = useRoleAccess()
  const { showToast } = useAppToast()
  const [claim, setClaim] = useState<ClaimDetail | null>(null)
  const [recovery, setRecovery] = useState<RecoverySummary | null>(null)
  const [recoveryLoadError, setRecoveryLoadError] = useState<string | null>(null)
  const [workItem, setWorkItem] = useState<WorkItemLite | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextAction, setNextAction] = useState('')
  const [assignedRep, setAssignedRep] = useState('')
  const [notes, setNotes] = useState('')
  const [triggering, setTriggering] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [clearingGateId, setClearingGateId] = useState<string | null>(null)
  const [resolveNotes, setResolveNotes] = useState('')
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [routeExplanation, setRouteExplanation] = useState<{
    matchedRule: string
    notes: string
    legacyOutcome: string | null
  } | null>(null)
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([])
  const [submissions, setSubmissions] = useState<ClaimSubmission[]>([])
  const [submissionMethod, setSubmissionMethod] = useState('')
  const [submissionRef, setSubmissionRef] = useState('')
  const [exportingPack, setExportingPack] = useState(false)

  const load = () => {
    if (!id) {
      setLoading(false)
      setError('Claim not found')
      return
    }
    setLoading(true)
    Promise.all([
      apiFetchJson<{ success: boolean; data: ClaimDetail }>(`/api/insurance/claims/${id}`),
      apiFetchJson<{ success: boolean; data: RecoverySummary }>(`/api/insurance/claims/${id}/recovery`).catch(
        (e) => {
          setRecoveryLoadError((e as Error).message || 'Recovery status unavailable')
          return null
        },
      ),
      apiFetchJson<{ success: boolean; data: WorkItemLite | null }>(
        `/api/work-queue/by-source/insurance_claim/${id}`,
      ),
      apiFetchJson<{ success: boolean; data: { matchedRule: string; notes: string; legacyOutcome: string | null } }>(
        `/api/insurance/claims/${id}/route-explanation`,
      ).catch(() => null),
      apiFetchJson<{ success: boolean; data: { items: EvidenceItem[]; submissions: ClaimSubmission[] } }>(
        `/api/insurance/claims/${id}/evidence`,
      ).catch(() => null),
    ])
      .then(([claimRes, recoveryRes, wiRes, routeRes, evidenceRes]) => {
        setClaim(claimRes.data)
        setRecovery(recoveryRes?.data ?? null)
        if (recoveryRes?.success) setRecoveryLoadError(null)
        setRouteExplanation(routeRes?.data ?? null)
        setEvidenceItems(evidenceRes?.data?.items ?? [])
        setSubmissions(evidenceRes?.data?.submissions ?? [])
        const wi = wiRes.data
        setWorkItem(wi)
        setAssignedRep(wi?.assignedRep ?? '')
        setNotes(wi?.notes ?? '')
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  const shouldPollRecovery =
    claim?.status === 'CALLING' ||
    recovery?.recoveryRoute === 'WAIT_SYNC' ||
    recovery?.claimStatus === 'CALLING'

  useEffect(() => {
    if (!id || !shouldPollRecovery) return
    const interval = setInterval(() => {
      apiFetchJson<{ success: boolean; data: RecoverySummary }>(`/api/insurance/claims/${id}/recovery`)
        .then((res) => setRecovery(res.data))
        .catch(() => undefined)
      apiFetchJson<{ success: boolean; data: ClaimDetail }>(`/api/insurance/claims/${id}`)
        .then((res) => setClaim(res.data))
        .catch(() => undefined)
    }, 20_000)
    return () => clearInterval(interval)
  }, [id, shouldPollRecovery])

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
    showToast('ok', 'Assignment saved')
    load()
  }

  const triggerCall = async () => {
    if (!id) return
    setTriggering(true)
    setActionMsg(null)
    try {
      const r = await apiFetch(`/api/insurance/queue/trigger/${id}`, { method: 'POST' })
      const j = await r.json().catch(() => ({})) as { error?: string; success?: boolean }
      if (!r.ok) {
        throw new Error(mapTriggerCallError(j.error ?? ''))
      }
      setActionMsg('Call queued')
      showToast('ok', 'Call queued')
      load()
    } catch (e) {
      const msg = (e as Error).message
      setActionMsg(msg)
      showToast('err', msg)
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
      showToast('ok', 'Claim marked resolved')
      setResolveNotes('')
      load()
    } catch (e) {
      const msg = (e as Error).message
      setActionMsg(msg)
      showToast('err', msg)
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

  const clearRecoveryGate = async (actionId: string) => {
    if (!id) return
    setClearingGateId(actionId)
    setActionMsg(null)
    try {
      const r = await apiFetch(`/api/insurance/recovery/actions/${actionId}/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId: id }),
      })
      const j = await r.json().catch(() => ({})) as { error?: string; scheduledRecallAt?: string }
      if (!r.ok) throw new Error(j.error ?? 'Could not clear gate')
      setActionMsg(
        j.scheduledRecallAt
          ? `Gate cleared, follow-up call scheduled for ${new Date(j.scheduledRecallAt).toLocaleString()}`
          : 'Gate cleared',
      )
      showToast('ok', 'Gate cleared')
      load()
    } catch (e) {
      const msg = (e as Error).message
      setActionMsg(msg)
      showToast('err', msg)
    } finally {
      setClearingGateId(null)
    }
  }

  const isEscalated = claim?.status === 'ESCALATED'

  return (
    <DataState loading={loading} error={error} isEmpty={!claim} emptyTitle="Claim not found">
      {claim && (
        <div className="page-enter p-6 space-y-6 max-w-4xl">
          <div className="flex items-center gap-3">
            <Link to="/insurance"><Button variant="ghost" size="sm">← Claims</Button></Link>
            <div className="flex-1">
              <h1 className="page-title">Claim {claim.claimNumber}</h1>
              <p className="page-subtitle">{claim.carrierId} · {claim.daysOutstanding} days outstanding</p>
            </div>
            <Badge color={isEscalated ? 'amber' : undefined}>{claimStatusLabel(claim.status)}</Badge>
            {claim.callAttempts.some((c) => !c.completedAt && isDemoVapiCall(c.vapiCallId)) && (
              <SimulatedCallBadge />
            )}
            {shouldPollRecovery && (
              <span className="text-[10px] uppercase tracking-wide text-blue-600 dark:text-blue-400 font-semibold">
                Live · refreshes every 20s
              </span>
            )}
          </div>

          <ClaimStatusStrip
            claimNumber={claim.claimNumber}
            carrierId={claim.carrierId}
            status={claim.status}
            daysOutstanding={claim.daysOutstanding}
            outstandingAmount={claim.outstandingAmount}
            recoveryRoute={recovery?.recoveryRoute ?? claim.recoveryRoute}
            dollarsRecoveredSyncVerified={recovery?.dollarsRecoveredSyncVerified}
            hasOpenBlockingGate={recovery?.openActions?.some((a) => a.blocking) ?? false}
            paymentExpectedBy={recovery?.paymentExpectedBy ?? claim.paymentExpectedBy}
          />

          {/* ── Escalation banner ── */}
          {isEscalated && (
            <div className="rounded-2xl border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-5 space-y-4">
              <div className="flex items-start gap-3">
                <span className="text-amber-500 text-xl leading-none mt-0.5">⚠</span>
                <div>
                  <h2 className="text-sm font-bold text-amber-900 dark:text-amber-300">AI handed off, your call required</h2>
                  <p className="text-xs text-amber-800 dark:text-amber-400 mt-1 leading-relaxed">
                    The AI reached the carrier but hit a wall it can't cross, a supervisor, appeals department, or written
                    dispute is needed. Read the AI's call summary below, then call the carrier directly to resolve it.
                    Once resolved, mark it done here.
                  </p>
                </div>
              </div>

              {canResolveEscalations && (
                <div className="border-t border-amber-200 dark:border-amber-800 pt-4 space-y-3">
                  <p className="text-xs font-semibold text-amber-900 dark:text-amber-300 uppercase tracking-wide">
                    After your call
                  </p>
                  <Input
                    value={resolveNotes}
                    onChange={(e) => setResolveNotes(e.target.value)}
                    placeholder="Optional, outcome notes (e.g. 'Spoke with supervisor Jane, claim reprocessing in 5–7 days')"
                    className="text-sm"
                  />
                  <Button
                    size="sm"
                    onClick={() => void resolveEscalation()}
                    disabled={resolving}
                  >
                    {resolving ? 'Saving…' : '✓ Mark resolved, I called the carrier'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {actionMsg && (
            <p className="text-sm text-crx-600 dark:text-crx-400" role="status">{actionMsg}</p>
          )}

          <ClaimNextActionCard
            isEscalated={isEscalated}
            recovery={recovery}
            queueScheduledFor={claim.queueEntry?.scheduledFor ?? null}
            canClearGates={canClearGates}
            clearingGateId={clearingGateId}
            onClearGate={(actionId) => void clearRecoveryGate(actionId)}
          />

          <Card padding="none">
            <div className="p-5 pb-0">
              <CardHeader
                title="What happened"
                subtitle="Calls, recovery updates, and practice gates in chronological order"
              />
            </div>
            <div className="px-5 pb-5">
              <ClaimTimeline callAttempts={claim.callAttempts} recovery={recovery} />
            </div>
          </Card>

          {recoveryLoadError && !recovery && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
              Recovery loop status could not be loaded ({recoveryLoadError}). Carrier dispatch rules may still apply server-side.
            </div>
          )}

          {recovery && (
            <Card>
              <CardHeader
                title="Recovery details"
                subtitle="Route logic, queue status, and non-blocking actions"
              />
              <div className="px-4 pb-4 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge color={recoveryRouteBadgeColor(recovery.recoveryRoute)}>
                    {recovery.routeLabel}
                  </Badge>
                  {recovery.recoveryRoute && (
                    <span className="text-xs font-mono text-gray-400">{recovery.recoveryRoute}</span>
                  )}
                </div>

                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                  {recovery.routeDescription}
                </p>

                {routeExplanation && (
                  <div className="rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-900/40 px-3 py-3 space-y-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Why this route?
                    </p>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {routeExplanation.matchedRule}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{routeExplanation.notes}</p>
                    {routeExplanation.legacyOutcome && (
                      <p className="text-xs font-mono text-gray-400">
                        Legacy outcome code: {routeExplanation.legacyOutcome}
                      </p>
                    )}
                  </div>
                )}

                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
                    <dt className="text-xs text-gray-500 uppercase tracking-wide">Next carrier action</dt>
                    <dd className="font-medium mt-0.5">
                      {recovery.stopCalling
                        ? 'No automated call scheduled'
                        : recallDueLabelDetailed(recovery.scheduledRecallAt)}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
                    <dt className="text-xs text-gray-500 uppercase tracking-wide">Queue</dt>
                    <dd className="font-medium mt-0.5">
                      {recovery.queueStatus ?? 'N/A'}
                      {recovery.queueAttempts > 0 ? ` · ${recovery.queueAttempts} attempt(s)` : ''}
                    </dd>
                  </div>
                  {recovery.paymentExpectedBy && (
                    <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 sm:col-span-2">
                      <dt className="text-xs text-amber-700 dark:text-amber-400 uppercase tracking-wide">
                        Payment verification deadline
                      </dt>
                      <dd className="font-medium mt-0.5 text-amber-900 dark:text-amber-200">
                        Trace call if PMS still shows balance after{' '}
                        {new Date(recovery.paymentExpectedBy).toLocaleDateString()}
                      </dd>
                    </div>
                  )}
                </dl>

                {!recovery.canCallCarrier && recovery.dispatchBlockReason && (
                  <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                    Carrier call blocked: {recovery.dispatchBlockReason}
                  </p>
                )}

                {recovery.openActions.filter((a) => !a.blocking).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Other open actions
                    </p>
                    {recovery.openActions.filter((a) => !a.blocking).map((a) => (
                      <div
                        key={a.id}
                        className="rounded-xl border border-gray-100 dark:border-gray-800 p-3 space-y-1"
                      >
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{a.title}</p>
                        {a.detail && (
                          <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{a.detail}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Denial & documentation"
              subtitle="Staff attestations and carrier submission references — clinical files stay in your PMS"
            />
            <div className="px-4 pb-4 space-y-4">
              {evidenceItems.length === 0 ? (
                <p className="text-sm text-gray-500">No evidence checklist items yet.</p>
              ) : (
                <ul className="space-y-2">
                  {evidenceItems.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{item.evidenceType.replace(/_/g, ' ')}</p>
                        {item.note && <p className="text-xs text-gray-500">{item.note}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge>{item.status}</Badge>
                        {!isReadOnly && item.status !== 'ATTESTED' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={async () => {
                              await apiFetch(`/api/insurance/claims/${id}/evidence/${encodeURIComponent(item.evidenceType)}/attest`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ note: 'Attested in PMS' }),
                              })
                              load()
                            }}
                          >
                            Attest
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {!isReadOnly && (
                <div className="grid sm:grid-cols-3 gap-2 items-end">
                  <Input label="Submission method" value={submissionMethod} onChange={(e) => setSubmissionMethod(e.target.value)} placeholder="Portal / fax / mail" />
                  <Input label="Reference #" value={submissionRef} onChange={(e) => setSubmissionRef(e.target.value)} placeholder="Carrier reference" />
                  <Button
                    disabled={!submissionMethod.trim()}
                    onClick={async () => {
                      await apiFetch(`/api/insurance/claims/${id}/submissions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ method: submissionMethod, referenceNumber: submissionRef || undefined }),
                      })
                      setSubmissionMethod('')
                      setSubmissionRef('')
                      load()
                    }}
                  >
                    Log submission
                  </Button>
                </div>
              )}

              {submissions.length > 0 && (
                <div className="text-xs text-gray-600 space-y-1">
                  {submissions.map((s) => (
                    <p key={s.id}>
                      {s.method} · {s.referenceNumber ?? 'no ref'} · {new Date(s.submittedAt).toLocaleString()}
                    </p>
                  ))}
                </div>
              )}

              <Button
                variant="secondary"
                disabled={exportingPack}
                onClick={async () => {
                  setExportingPack(true)
                  try {
                    const res = await apiFetchJson<{ success: boolean; checksum: string }>(
                      `/api/insurance/claims/${id}/evidence-pack`,
                    )
                    setActionMsg(`Evidence pack exported (checksum ${res.checksum.slice(0, 12)}…)`)
                  } finally {
                    setExportingPack(false)
                  }
                }}
              >
                {exportingPack ? 'Exporting…' : 'Export evidence pack (JSON)'}
              </Button>
            </div>
          </Card>

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
                          {a.durationSeconds ? ` · ${fmtCallDuration(a.durationSeconds)}` : ''}
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

                      {/* Async validation verdict */}
                      {a.validationPassed === false && (
                        <div className="text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg px-3 py-2 leading-relaxed">
                          <strong>Validation escalated:</strong>{' '}
                          {a.validationResult?.escalationReason ?? 'The post-call validator flagged this call for manual review.'}
                        </div>
                      )}
                      {a.validationPassed === true && (
                        <p className="text-xs text-emerald-600 dark:text-emerald-400">
                          Post-call validation passed
                        </p>
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
                    <Link to="/insurance?tab=queue" className="text-crx-600 underline">Sync priority queue</Link> on Claims.
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
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void triggerCall()}
                          disabled={triggering || (recovery != null && !recovery.canCallCarrier)}
                          title={recovery?.dispatchBlockReason ?? undefined}
                        >
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
