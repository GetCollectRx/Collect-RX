import { Link } from 'react-router-dom'
import { Badge, Button } from '../ui'
import {
  OUTCOME_LABELS,
  RECOVERY_ROUTE_LABELS,
  buildNextActionSummary,
  fmtCallDuration,
  fmtRecoveryEventType,
  isDemoVapiCall,
  outcomeColor,
  recoveryRouteBadgeColor,
  type NextActionSummary,
} from '../../lib/recoveryDisplay'
import { SimulatedCallBadge } from './SimulatedCallBadge'

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

interface RecoverySummaryLite {
  recoveryRoute: string | null
  routeLabel: string
  routeDescription: string
  paymentExpectedBy: string | null
  scheduledRecallAt: string | null
  stopCalling: boolean
  dispatchBlockReason: string | null
  openActions: RecoveryActionView[]
  recentEvents: RecoveryEventView[]
  dollarsRecoveredSyncVerified: number
  cdcpCaseId: string | null
  cdcpCaseStatus: string | null
}

type TimelineKind = 'call' | 'event' | 'gate'

interface TimelineItem {
  id: string
  kind: TimelineKind
  at: string
  call?: CallAttempt
  callIndex?: number
  event?: RecoveryEventView
  gate?: RecoveryActionView
}

function buildTimelineItems(
  callAttempts: CallAttempt[],
  events: RecoveryEventView[],
  gates: RecoveryActionView[],
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...callAttempts.map((call, i) => ({
      id: `call-${call.id}`,
      kind: 'call' as const,
      at: call.initiatedAt,
      call,
      callIndex: i,
    })),
    ...events.map((event) => ({
      id: `event-${event.id}`,
      kind: 'event' as const,
      at: event.createdAt,
      event,
    })),
    ...gates.map((gate) => ({
      id: `gate-${gate.id}`,
      kind: 'gate' as const,
      at: gate.createdAt,
      gate,
    })),
  ]
  return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

const NEXT_ACTION_VARIANTS: Record<NextActionSummary['variant'], string> = {
  default: 'border-crx-200 dark:border-crx-800 bg-crx-50/60 dark:bg-crx-900/20',
  warning: 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20',
  success: 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20',
  blocked: 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20',
}

export function ClaimNextActionCard({
  isEscalated,
  recovery,
  queueScheduledFor,
  isReadOnly,
  clearingGateId,
  onClearGate,
}: {
  isEscalated: boolean
  recovery: RecoverySummaryLite | null
  queueScheduledFor: string | null
  isReadOnly: boolean
  clearingGateId: string | null
  onClearGate: (actionId: string) => void
}) {
  const summary = buildNextActionSummary({ isEscalated, recovery, queueScheduledFor })
  const blockingGates = recovery?.openActions.filter((a) => a.blocking) ?? []

  return (
    <div className={`rounded-2xl border-2 p-5 space-y-4 ${NEXT_ACTION_VARIANTS[summary.variant]}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2 min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            What&apos;s next
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {recovery?.recoveryRoute && (
              <Badge color={recoveryRouteBadgeColor(recovery.recoveryRoute)}>
                {recovery.routeLabel || RECOVERY_ROUTE_LABELS[recovery.recoveryRoute] || recovery.recoveryRoute}
              </Badge>
            )}
            {recovery && recovery.dollarsRecoveredSyncVerified > 0 && (
              <Badge color="green">
                ${recovery.dollarsRecoveredSyncVerified.toFixed(2)} verified by sync
              </Badge>
            )}
          </div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 leading-snug">
            {summary.headline}
          </h2>
          {summary.detail && (
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{summary.detail}</p>
          )}
        </div>
      </div>

      {recovery?.cdcpCaseId && (
        <p className="text-sm">
          <Link
            to={`/cdcp?case=${recovery.cdcpCaseId}`}
            className="text-crx-600 dark:text-crx-400 underline font-medium"
          >
            Open CDCP reconsideration ({recovery.cdcpCaseStatus ?? 'open'}) →
          </Link>
        </p>
      )}

      {blockingGates.length > 0 && (
        <div className="space-y-2 border-t border-amber-200/80 dark:border-amber-800/80 pt-4">
          {blockingGates.map((gate) => (
            <div key={gate.id} className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-amber-900 dark:text-amber-200">
                Gate opened {new Date(gate.createdAt).toLocaleString()}
              </p>
              {!isReadOnly && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={clearingGateId === gate.id}
                  onClick={() => onClearGate(gate.id)}
                >
                  {clearingGateId === gate.id ? 'Saving…' : 'Mark complete, ready to re-call'}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TimelineDot({ kind }: { kind: TimelineKind }) {
  const colors: Record<TimelineKind, string> = {
    call: 'bg-blue-500 ring-blue-100 dark:ring-blue-900',
    event: 'bg-green-500 ring-green-100 dark:ring-green-900',
    gate: 'bg-amber-500 ring-amber-100 dark:ring-amber-900',
  }
  return (
    <span
      className={`absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ring-4 ${colors[kind]}`}
      aria-hidden
    />
  )
}

function CallTimelineEntry({ call, index }: { call: CallAttempt; index: number }) {
  const isEscalated = call.outcome === 'ESCALATED'
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-gray-400">Call {index + 1}</span>
        <span className={`text-sm font-semibold ${outcomeColor(call.outcome)}`}>
          {OUTCOME_LABELS[call.outcome ?? ''] ?? call.outcome ?? 'In progress'}
        </span>
        {call.durationSeconds != null && (
          <span className="text-xs text-gray-400">{fmtCallDuration(call.durationSeconds)}</span>
        )}
        {isDemoVapiCall(call.vapiCallId) && <SimulatedCallBadge />}
      </div>
      {!call.completedAt && call.vapiCallId?.startsWith('demo-in-progress') && (
        <p className="text-xs text-gray-500 italic leading-relaxed">
          Agent: &ldquo;Checking status on claim {call.referenceNumber ?? '…'} — rep confirms file is with adjudication.&rdquo;
        </p>
      )}
      {isEscalated && (
        <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
          {call.outcomeDetail ??
            'The carrier required a supervisor or appeals department that CollectRx could not access.'}
        </p>
      )}
      {!isEscalated && call.outcomeDetail && (
        <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{call.outcomeDetail}</p>
      )}
      {(call.repName || call.referenceNumber) && (
        <p className="text-xs text-gray-500">
          {call.repName && <>Rep: {call.repName}</>}
          {call.repName && call.referenceNumber && ' · '}
          {call.referenceNumber && <>Ref #{call.referenceNumber}</>}
        </p>
      )}
      {call.transcriptUrl && (
        <a
          href={call.transcriptUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-crx-500 hover:text-crx-600 dark:hover:text-crx-400"
        >
          View transcript →
        </a>
      )}
    </div>
  )
}

function EventTimelineEntry({ event }: { event: RecoveryEventView }) {
  const routeMeta = event.eventType === 'ROUTE_ASSIGNED' ? event.metadata?.route : null
  const routeLabel =
    routeMeta != null
      ? RECOVERY_ROUTE_LABELS[String(routeMeta)] ?? String(routeMeta)
      : null

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
        {fmtRecoveryEventType(event.eventType)}
        {event.eventType === 'PAYMENT_VERIFIED_SYNC' && event.amountRecoveredCents != null && (
          <span className="text-green-700 dark:text-green-400">
            {' '}
            · ${(event.amountRecoveredCents / 100).toFixed(2)}
          </span>
        )}
      </p>
      {routeLabel && (
        <p className="text-xs text-gray-500">Route set to {routeLabel}</p>
      )}
      {event.newOutstanding != null && event.eventType.includes('PAYMENT') && (
        <p className="text-xs text-gray-500">
          Outstanding updated to ${event.newOutstanding.toFixed(2)}
        </p>
      )}
    </div>
  )
}

function GateTimelineEntry({ gate }: { gate: RecoveryActionView }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{gate.title}</p>
        {gate.blocking && (
          <Badge color="amber">Blocking</Badge>
        )}
        {!gate.blocking && gate.status !== 'OPEN' && (
          <Badge>{gate.status.replace(/_/g, ' ').toLowerCase()}</Badge>
        )}
      </div>
      {gate.detail && (
        <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{gate.detail}</p>
      )}
    </div>
  )
}

export function ClaimTimeline({
  callAttempts,
  recovery,
}: {
  callAttempts: CallAttempt[]
  recovery: RecoverySummaryLite | null
}) {
  const items = buildTimelineItems(
    callAttempts,
    recovery?.recentEvents ?? [],
    recovery?.openActions ?? [],
  )

  if (items.length === 0) {
    return (
      <p className="text-sm text-gray-500 px-1">
        No activity yet. CollectRx will add call outcomes and recovery updates here.
      </p>
    )
  }

  return (
    <ol className="relative border-l border-gray-200 dark:border-gray-700 ml-1.5 space-y-6 pl-6">
      {items.map((item) => (
        <li key={item.id} className="relative">
          <TimelineDot kind={item.kind} />
          <time
            dateTime={item.at}
            className="block text-[11px] text-gray-400 mb-1.5 tabular-nums"
          >
            {new Date(item.at).toLocaleString()}
          </time>
          {item.kind === 'call' && item.call && item.callIndex != null && (
            <CallTimelineEntry call={item.call} index={item.callIndex} />
          )}
          {item.kind === 'event' && item.event && <EventTimelineEntry event={item.event} />}
          {item.kind === 'gate' && item.gate && <GateTimelineEntry gate={item.gate} />}
        </li>
      ))}
    </ol>
  )
}
