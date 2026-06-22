import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import {
  Badge, Button, Card, CardHeader, DataState, Select,
} from '../components/ui'
import { STAGE_LABELS } from '../types/partnerships'

type Activity = {
  id: string
  type: string
  summary: string
  metadata: Record<string, unknown> | null
  createdAt: string
}

type EmailPreview = {
  step: number
  subject: string
  html: string
  text: string
}

type ProspectDetail = {
  id: string
  practiceName: string
  contactName: string | null
  email: string | null
  phone: string | null
  city: string | null
  province: string | null
  score: number
  stage: keyof typeof STAGE_LABELS
  sequenceStep: number
  sequenceCompleted: boolean
  sequencePausedUntil: string | null
  optOutAt: string | null
  demoScheduledAt: string | null
  preDemoEmailSentAt: string | null
  dnclCheckedAt: string | null
  dnclListed: boolean | null
  linkedPracticeId: string | null
  hubspotDealId: string | null
  callSummary: string | null
  replyIntent: string | null
  suggestedReply: string | null
  painPoints: unknown
  activities: Activity[]
}

function metaStr(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

export default function ProspectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [prospect, setProspect] = useState<ProspectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [previewStep, setPreviewStep] = useState(1)
  const [preview, setPreview] = useState<EmailPreview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [postDemoOutcome, setPostDemoOutcome] = useState<'interested' | 'thinking' | 'not_fit'>('interested')
  const [postDemoConcern, setPostDemoConcern] = useState('')
  const [postDemoConcernResponse, setPostDemoConcernResponse] = useState('')
  const [postDemoAgreementDay, setPostDemoAgreementDay] = useState('Friday')

  const load = useCallback(() => {
    if (!id) return
    setLoading(true)
    apiFetchJson<{ success: boolean; data: ProspectDetail }>(`/api/admin/partnerships/prospects/${id}`)
      .then((res) => {
        setProspect(res.data)
        setPreviewStep(Math.min(4, res.data.sequenceStep + 1))
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { load() }, [load])

  const patchStage = async (stage: string) => {
    if (!id) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await apiFetch(`/api/admin/partnerships/prospects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      })
      const body = await res.json() as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Update failed')
      load()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const startCall = async () => {
    if (!id) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await apiFetch(`/api/admin/partnerships/prospects/${id}/call`, { method: 'POST' })
      const body = await res.json() as { error?: string; data?: { vapiCallId: string } }
      if (!res.ok) throw new Error(body.error || 'Call failed')
      setMsg(`Call queued (${body.data?.vapiCallId})`)
      load()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pauseSequence = async (days: number) => {
    if (!id) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await apiFetch(`/api/admin/partnerships/prospects/${id}/pause-sequence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      })
      const body = await res.json() as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Pause failed')
      setMsg(`Cadence paused ${days} days`)
      load()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const resumeSequence = async () => {
    if (!id) return
    setBusy(true)
    try {
      const res = await apiFetch(`/api/admin/partnerships/prospects/${id}/resume-sequence`, { method: 'POST' })
      const body = await res.json() as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Resume failed')
      setMsg('Cadence resumed')
      load()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const optOut = async () => {
    if (!id || !window.confirm('Opt this prospect out of all outreach?')) return
    setBusy(true)
    try {
      const res = await apiFetch(`/api/admin/partnerships/prospects/${id}/opt-out`, { method: 'POST' })
      const body = await res.json() as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Opt-out failed')
      setMsg('Prospect opted out')
      load()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const loadPreview = async (step: number) => {
    if (!id) return
    setPreviewBusy(true)
    try {
      const res = await apiFetchJson<{ success: boolean; data: EmailPreview }>(
        `/api/admin/partnerships/prospects/${id}/email-preview?step=${step}`,
      )
      setPreview(res.data)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setPreviewBusy(false)
    }
  }

  const copySuggestedReply = async () => {
    if (!prospect?.suggestedReply) return
    try {
      await navigator.clipboard.writeText(prospect.suggestedReply)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setMsg('Could not copy to clipboard')
    }
  }

  const sendSuggestedReply = async () => {
    if (!id || !prospect?.suggestedReply) return
    if (!window.confirm('Send the suggested reply via SendGrid from khalid@collectrx.ca?')) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await apiFetch(`/api/admin/partnerships/prospects/${id}/send-suggested-reply`, {
        method: 'POST',
      })
      const body = await res.json() as { error?: string; data?: { sent: boolean } }
      if (!res.ok) throw new Error(body.error || 'Send failed')
      setMsg(body.data?.sent ? 'Reply sent via SendGrid' : 'Send logged (SendGrid not configured)')
      load()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const sendPostDemoFollowUp = async (send: boolean) => {
    if (!id) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await apiFetch(`/api/admin/partnerships/prospects/${id}/post-demo-follow-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: postDemoOutcome,
          concern: postDemoConcern.trim() || undefined,
          concernResponse: postDemoConcernResponse.trim() || undefined,
          agreementSendDay: postDemoAgreementDay.trim() || undefined,
          send,
        }),
      })
      const body = await res.json() as { error?: string; data?: { sent: boolean; draftOnly: boolean } }
      if (!res.ok) throw new Error(body.error || 'Post-demo action failed')
      if (body.data?.draftOnly) {
        setMsg('Draft saved to suggested reply — review and send when ready')
      } else {
        setMsg(body.data?.sent ? 'Post-demo follow-up sent' : 'Post-demo follow-up logged')
      }
      load()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (id && prospect) void loadPreview(previewStep)
  }, [id, prospect?.id, previewStep])

  return (
    <DataState loading={loading} error={error}>
      {!prospect ? null : (
        <div className="page-enter p-6 space-y-6 max-w-3xl">
          <div className="flex items-center gap-3">
            <Link to="/admin/partnerships"><Button variant="ghost" size="sm">← Pipeline</Button></Link>
            <div>
              <h1 className="page-title">{prospect.practiceName}</h1>
              <p className="page-subtitle">
                {prospect.email || 'No email'} · score {prospect.score}
                · cadence step {prospect.sequenceStep + 1}/4
                {prospect.sequenceCompleted ? ' (complete)' : ''}
              </p>
            </div>
          </div>

          {msg && <p className="text-sm text-amber-700 dark:text-amber-300">{msg}</p>}

          <Card>
            <CardHeader title="Partnership status" />
            <div className="px-4 pb-4 space-y-2 text-sm text-gray-600 dark:text-gray-400">
              {prospect.demoScheduledAt && (
                <p>
                  Demo: {new Date(prospect.demoScheduledAt).toLocaleString('en-CA')}
                  {prospect.preDemoEmailSentAt ? ' · reminder sent' : ' · reminder pending'}
                </p>
              )}
              {prospect.dnclCheckedAt && (
                <p>
                  DNCL: {prospect.dnclListed ? 'listed (calls blocked)' : 'clear'}
                  {' · checked '}
                  {new Date(prospect.dnclCheckedAt).toLocaleString('en-CA')}
                </p>
              )}
              {prospect.linkedPracticeId && (
                <p>Linked practice: <code className="text-xs">{prospect.linkedPracticeId}</code></p>
              )}
              {prospect.hubspotDealId && (
                <p>HubSpot deal: <code className="text-xs">{prospect.hubspotDealId}</code></p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Actions" />
            <div className="px-4 pb-4 space-y-3">
              <div className="flex flex-wrap gap-3 items-end">
                <Select
                  label="Stage"
                  value={prospect.stage}
                  disabled={busy}
                  onChange={(e) => void patchStage(e.target.value)}
                >
                  {Object.entries(STAGE_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </Select>
                <Button disabled={busy || !prospect.phone} onClick={() => void startCall()}>
                  Call (sales qualifier)
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void pauseSequence(14)}>
                  Pause cadence 14d
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void resumeSequence()}>
                  Resume cadence
                </Button>
                <Button variant="ghost" size="sm" disabled={busy || Boolean(prospect.optOutAt)} onClick={() => void optOut()}>
                  Opt out
                </Button>
              </div>
              {prospect.sequencePausedUntil && (
                <p className="text-xs text-gray-500">
                  Cadence paused until {new Date(prospect.sequencePausedUntil).toLocaleString('en-CA')}
                </p>
              )}
              {prospect.optOutAt && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Opted out {new Date(prospect.optOutAt).toLocaleString('en-CA')}
                </p>
              )}
              {prospect.stage === 'closed_won' && (
                <p className="text-xs text-gray-500">
                  Referral sequence runs at day 14 and 30 after closed won (via cadence tick).
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Email preview" subtitle="Next cadence message (not sent from here)" />
            <div className="px-4 pb-4 space-y-3">
              <Select
                label="Cadence step"
                value={String(previewStep)}
                onChange={(e) => setPreviewStep(Number(e.target.value))}
              >
                {[1, 2, 3, 4].map((s) => (
                  <option key={s} value={s}>Email {s}</option>
                ))}
              </Select>
              {previewBusy && <p className="text-sm text-gray-500">Loading preview…</p>}
              {preview && !previewBusy && (
                <div className="space-y-2 text-sm">
                  <p><span className="font-semibold">Subject:</span> {preview.subject}</p>
                  <pre className="p-3 rounded bg-gray-50 dark:bg-gray-900 whitespace-pre-wrap text-xs max-h-64 overflow-auto">
                    {preview.text}
                  </pre>
                </div>
              )}
            </div>
          </Card>

          {(prospect.callSummary || prospect.replyIntent) && (
            <Card>
              <CardHeader title="Inbound intelligence" />
              <div className="px-4 pb-4 space-y-3 text-sm">
                {prospect.callSummary && (
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-gray-200">Call summary</p>
                    <p className="text-gray-600 dark:text-gray-400 mt-1">{prospect.callSummary}</p>
                  </div>
                )}
                {prospect.replyIntent && (
                  <div>
                    <p className="font-semibold">Reply intent: <Badge>{prospect.replyIntent}</Badge></p>
                    {prospect.suggestedReply && (
                      <>
                        <p className="mt-2 p-3 rounded bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                          {prospect.suggestedReply}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-2">
                          <Button variant="ghost" size="sm" onClick={() => void copySuggestedReply()}>
                            {copied ? 'Copied' : 'Copy'}
                          </Button>
                          <Button
                            size="sm"
                            disabled={busy || Boolean(prospect.optOutAt)}
                            onClick={() => void sendSuggestedReply()}
                          >
                            Send via SendGrid
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {Array.isArray(prospect.painPoints) && prospect.painPoints.length > 0 && (
                  <ul className="list-disc list-inside text-gray-600 dark:text-gray-400">
                    {(prospect.painPoints as string[]).map((p) => <li key={p}>{p}</li>)}
                  </ul>
                )}
              </div>
            </Card>
          )}

          {(prospect.demoScheduledAt || prospect.stage === 'demo_booked' || prospect.stage === 'qualified') && (
            <Card>
              <CardHeader
                title="Post-demo follow-up"
                subtitle="Template 5A/5B/5C — sends from khalid@collectrx.ca when SendGrid is configured"
              />
              <div className="px-4 pb-4 space-y-3 text-sm">
                <Select
                  label="Call outcome"
                  value={postDemoOutcome}
                  disabled={busy}
                  onChange={(e) => setPostDemoOutcome(e.target.value as typeof postDemoOutcome)}
                >
                  <option value="interested">Interested — send 5A (trial agreement next)</option>
                  <option value="thinking">Thinking it over — 5B (needs concern)</option>
                  <option value="not_fit">Not the right fit — 5C</option>
                </Select>
                {postDemoOutcome === 'interested' && (
                  <label className="block">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Agreement send day</span>
                    <input
                      className="mt-1 w-full rounded border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
                      value={postDemoAgreementDay}
                      disabled={busy}
                      onChange={(e) => setPostDemoAgreementDay(e.target.value)}
                      placeholder="Friday"
                    />
                  </label>
                )}
                {postDemoOutcome === 'thinking' && (
                  <>
                    <label className="block">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Their concern (required to send)</span>
                      <textarea
                        className="mt-1 w-full rounded border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm min-h-[72px]"
                        value={postDemoConcern}
                        disabled={busy}
                        onChange={(e) => setPostDemoConcern(e.target.value)}
                        placeholder="e.g. worried about patient data"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Your response</span>
                      <textarea
                        className="mt-1 w-full rounded border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm min-h-[72px]"
                        value={postDemoConcernResponse}
                        disabled={busy}
                        onChange={(e) => setPostDemoConcernResponse(e.target.value)}
                        placeholder="Honest answer to their specific concern"
                      />
                    </label>
                  </>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy || Boolean(prospect.optOutAt)}
                    onClick={() => void sendPostDemoFollowUp(true)}
                  >
                    Send follow-up email
                  </Button>
                  {postDemoOutcome === 'thinking' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void sendPostDemoFollowUp(false)}
                    >
                      Save draft only
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          )}

          <Card padding="none">
            <div className="p-5 pb-0">
              <CardHeader title="Activity timeline" />
            </div>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {prospect.activities.length === 0 ? (
                <li className="p-4 text-sm text-gray-500">No activity yet.</li>
              ) : (
                prospect.activities.map((ev) => (
                  <li key={ev.id} className="p-4 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{ev.summary}</span>
                      <span className="text-xs text-gray-500 shrink-0">
                        {new Date(ev.createdAt).toLocaleString('en-CA')}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{ev.type}</div>
                    {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                      <details className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                        <summary className="cursor-pointer">Details</summary>
                        <pre className="mt-1 whitespace-pre-wrap">
                          {Object.entries(ev.metadata)
                            .map(([k, v]) => `${k}: ${metaStr(v)}`)
                            .join('\n')}
                        </pre>
                      </details>
                    )}
                  </li>
                ))
              )}
            </ul>
          </Card>
        </div>
      )}
    </DataState>
  )
}
