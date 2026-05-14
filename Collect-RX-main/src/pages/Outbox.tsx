import { useEffect, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import { parseApiJson } from '../lib/parseApiJson'
import {
  Card, Badge, Button, InlineToast, useToast, DataState,
} from '../components/ui'

function fmtDt(s: string) {
  return new Date(s).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })
}

interface OutreachEvent {
  id: string
  templateKey: string
  channel: string
  sentAt: string
  deliveryStatus: string
  responseStatus: string
  messageBody: string
  balance: {
    status: string
    patient: { displayName: string }
  }
}

const RESPONSE_COLOR: Record<string, 'green'|'amber'|'red'|'gray'|'blue'> = {
  NONE: 'gray', PAY: 'green', QUESTION: 'amber', DISPUTE: 'red',
}
const RESPONSE_LABEL: Record<string, string> = {
  NONE: 'No response', PAY: 'Paid', QUESTION: 'Question', DISPUTE: 'Dispute',
}

export default function Outbox() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const [events,   setEvents]  = useState<OutreachEvent[]>([])
  const [loading,  setLoading] = useState(true)
  const [error,    setError]   = useState<string | null>(null)
  const { toast, showToast }   = useToast()

  const fetchEvents = () => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    apiFetchJson<OutreachEvent[]>(`/api/outreach?practiceId=${practiceId}`)
      .then(data => setEvents(Array.isArray(data) ? data : []))
      .catch((e) => { setError((e as Error).message) })
      .finally(() => setLoading(false))
  }

  useEffect(fetchEvents, [practiceId])

  const handleResponse = async (id: string, type: string) => {
    try {
      const res = await apiFetch(`/api/outreach/${id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responseType: type }),
      })
      const body = await parseApiJson<Record<string, unknown>>(res)
      if (!res.ok) throw new Error((body as { error?: string }).error || 'API error')
      showToast('ok', `Patient response simulated: ${type}`)
      fetchEvents()
    } catch (err) {
      showToast('err', (err as Error).message)
    }
  }

  const pending = events.filter(e => e.responseStatus === 'NONE' && e.balance.status === 'OPEN').length
  const dataBusy = practiceLoading || loading

  return (
    <DataState loading={dataBusy} error={error}>
    <div className="page-enter p-6 space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Message Outbox</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">All messages sent to patients — simulate patient responses below</p>
        </div>
        <div className="flex items-center gap-2">
          {pending > 0 && <Badge color="amber" dot>{pending} awaiting response</Badge>}
          <Button variant="secondary" size="sm" onClick={fetchEvents} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {toast && <InlineToast toast={toast} />}

      {!dataBusy && !error && (events.length === 0 ? (
        <Card className="text-center py-12">
          <p className="text-4xl mb-3" aria-hidden="true">📭</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No messages sent yet. The rules engine sends messages automatically as balances age.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {events.map(event => (
            <Card key={event.id}>
              {/* Event header */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {event.balance.patient.displayName}
                    </p>
                    <Badge color="blue">{event.templateKey}</Badge>
                    <Badge color={event.deliveryStatus === 'SENT' ? 'green' : 'red'}>
                      {event.deliveryStatus}
                    </Badge>
                    <Badge color={RESPONSE_COLOR[event.responseStatus] ?? 'gray'}>
                      {RESPONSE_LABEL[event.responseStatus] ?? event.responseStatus}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    {fmtDt(event.sentAt)} · via {event.channel}
                  </p>
                </div>

                {/* Simulate response buttons */}
                {event.responseStatus === 'NONE' && event.balance.status === 'OPEN' && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="success"
                      size="xs"
                      onClick={() => handleResponse(event.id, 'PAY')}
                    >
                      Pay
                    </Button>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => handleResponse(event.id, 'QUESTION')}
                    >
                      Question
                    </Button>
                    <Button
                      variant="danger"
                      size="xs"
                      onClick={() => handleResponse(event.id, 'DISPUTE')}
                    >
                      Dispute
                    </Button>
                  </div>
                )}
              </div>

              {/* Message body */}
              <pre className="mt-3 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-lg p-4 whitespace-pre-wrap font-mono text-gray-700 dark:text-gray-300 leading-relaxed overflow-x-auto">
                {event.messageBody}
              </pre>
            </Card>
          ))}
        </div>
      ))}
    </div>
    </DataState>
  )
}
