import { useCallback, useEffect, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { api } from '../utils/api'
import type { OutreachEvent } from '../types'
import {
  Badge,
  Button,
  Breadcrumb,
  Card,
  CardDivider,
  ListItem,
  SkeletonListItem,
  EmptyState,
  useToast,
  type ToastVariant,
} from '../components/base'

type ResponseStatus = 'NONE' | 'PAY' | 'QUESTION' | 'DISPUTE'
type DeliveryStatus = 'SENT' | 'FAILED' | 'PENDING'

function deliveryVariant(s: string): 'success' | 'error' | 'neutral' {
  if (s === 'SENT')   return 'success'
  if (s === 'FAILED') return 'error'
  return 'neutral'
}

function responseVariant(s: string): 'success' | 'warning' | 'error' | 'neutral' {
  if (s === 'PAY')      return 'success'
  if (s === 'QUESTION') return 'warning'
  if (s === 'DISPUTE')  return 'error'
  return 'neutral'
}

function responseLabel(s: string) {
  const map: Record<string, string> = {
    NONE:     'No response',
    PAY:      'Will pay',
    QUESTION: 'Has question',
    DISPUTE:  'Disputed',
  }
  return map[s] ?? s
}

function channelIcon(channel: string) {
  if (channel === 'SMS') return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
    </svg>
  )
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}

function EventCard({ event, onRespond }: {
  event: OutreachEvent
  onRespond: (id: string, type: ResponseStatus) => Promise<void>
}) {
  const [responding, setResponding] = useState<ResponseStatus | null>(null)

  const handleRespond = async (type: ResponseStatus) => {
    setResponding(type)
    try {
      await onRespond(event.id, type)
    } finally {
      setResponding(null)
    }
  }

  const canRespond = event.responseStatus === 'NONE' && event.balance.status === 'OPEN'

  return (
    <Card padding="none" className="overflow-hidden">
      <ListItem
        title={
          <span className="font-semibold">
            {event.balance.patient.displayName}
            <span className="ml-2 text-xs font-normal text-gray-500 uppercase tracking-wide">
              {event.templateKey.replace(/_/g, ' ')}
            </span>
          </span>
        }
        subtitle={
          <span className="flex items-center gap-2 mt-0.5">
            <span className="flex items-center gap-1 text-gray-400">
              {channelIcon(event.channel)}
              <span>{event.channel}</span>
            </span>
            <span className="text-gray-300">&middot;</span>
            <span>{new Date(event.sentAt).toLocaleString()}</span>
          </span>
        }
        trailing={
          <div className="flex items-center gap-2">
            <Badge variant={deliveryVariant(event.deliveryStatus as DeliveryStatus)} size="sm">
              {event.deliveryStatus}
            </Badge>
            <Badge variant={responseVariant(event.responseStatus)} size="sm">
              {responseLabel(event.responseStatus)}
            </Badge>
          </div>
        }
      />

      <CardDivider />

      <div className="px-4 py-3 bg-gray-50 text-sm text-gray-700 font-mono whitespace-pre-wrap leading-relaxed text-xs">
        {event.messageBody}
      </div>

      {canRespond && (
        <>
          <CardDivider />
          <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500 mr-2">Simulate patient response:</span>
            <Button
              size="sm" variant="success"
              loading={responding === 'PAY'}
              disabled={!!responding}
              onClick={() => handleRespond('PAY')}
            >
              Pay Now
            </Button>
            <Button
              size="sm" variant="secondary"
              loading={responding === 'QUESTION'}
              disabled={!!responding}
              onClick={() => handleRespond('QUESTION')}
            >
              Has Question
            </Button>
            <Button
              size="sm" variant="danger"
              loading={responding === 'DISPUTE'}
              disabled={!!responding}
              onClick={() => handleRespond('DISPUTE')}
            >
              Dispute
            </Button>
          </div>
        </>
      )}
    </Card>
  )
}

function Outbox() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const { toast } = useToast()
  const showToast = (variant: ToastVariant, title: string) => toast({ variant, title })
  const [events, setEvents]   = useState<OutreachEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const fetchEvents = useCallback(async () => {
    if (!practiceId) return
    try {
      setLoading(true)
      setError(null)
      const data = await api.get<OutreachEvent[]>(`/api/outreach?practiceId=${practiceId}`)
      setEvents(Array.isArray(data) ? data : [])
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [practiceId])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  const handleRespond = async (eventId: string, responseType: ResponseStatus) => {
    try {
      await api.post(`/api/outreach/${eventId}/respond`, { responseType })
      showToast('success', `Patient response recorded: ${responseLabel(responseType)}`)
      const data = await api.get<OutreachEvent[]>(`/api/outreach?practiceId=${practiceId}`)
      setEvents(Array.isArray(data) ? data : [])
    } catch (err) {
      showToast('error', (err as Error).message || 'Failed to record response')
    }
  }

  // Summary counts
  const pending   = events.filter(e => e.responseStatus === 'NONE' && e.balance.status === 'OPEN').length
  const responded = events.filter(e => e.responseStatus !== 'NONE').length

  if (practiceLoading) return null

  return (
    <main className="px-4 py-6 md:px-6 pb-20 md:pb-6 max-w-4xl mx-auto space-y-4">
      <Breadcrumb items={[{ label: 'Dashboard', href: '/' }, { label: 'Outbox' }]} />

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Message Outbox</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            All messages sent to patients via SMS and email
          </p>
        </div>
        {!loading && events.length > 0 && (
          <div className="flex gap-3 text-center">
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <div className="text-lg font-bold text-amber-700 tabular-nums">{pending}</div>
              <div className="text-xs text-amber-600">Awaiting response</div>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <div className="text-lg font-bold text-emerald-700 tabular-nums">{responded}</div>
              <div className="text-xs text-emerald-600">Responded</div>
            </div>
          </div>
        )}
      </div>

      {error && !loading && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>Failed to load messages: {error}</span>
          <Button size="sm" variant="danger" onClick={fetchEvents}>Retry</Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} padding="none">
              <SkeletonListItem />
              <div className="h-16 bg-gray-50 border-t border-gray-100 animate-pulse" />
            </Card>
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          title="No messages sent yet"
          description="The rules engine will begin sending messages as patient balances age through their stages."
        />
      ) : (
        <div className="space-y-3" role="list" aria-label="Outreach messages">
          {events.map(event => (
            <div key={event.id} role="listitem">
              <EventCard event={event} onRespond={handleRespond} />
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

export default Outbox
