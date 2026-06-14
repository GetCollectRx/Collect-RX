import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { apiFetch } from '../lib/apiFetch'
import { parseApiJson } from '../lib/parseApiJson'
import { Card, CardHeader, StageBadge, Badge, Button, DataState } from '../components/ui'

function fmtCurrency(v: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v)
}
function fmtDt(s: string) {
  return new Date(s).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-gray-50 dark:border-gray-700/50 last:border-0">
      <span className="text-sm text-gray-500 dark:text-gray-400 w-40 flex-shrink-0">{label}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100 text-right">{value}</span>
    </div>
  )
}

function TimelineItem({ icon, title, time, children }: {
  icon: string; title: string; time: string; children?: React.ReactNode
}) {
  return (
    <div className="flex gap-4">
      {/* Rail */}
      <div className="flex flex-col items-center flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-base" aria-hidden="true">
          {icon}
        </div>
        <div className="flex-1 w-px bg-gray-100 dark:bg-gray-700 mt-1" />
      </div>
      {/* Content */}
      <div className="pb-5 min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{time}</p>
        {children && <div className="mt-2">{children}</div>}
      </div>
    </div>
  )
}

export default function BalanceDetail() {
  const { id } = useParams()
  const [balance, setBalance] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setError(null)
    apiFetch(`/api/balances/${id}`)
      .then(async (r) => {
        if (r.status === 404) { setBalance(null); return null }
        if (!r.ok) throw new Error('Failed to load')
        return parseApiJson(r)
      })
      .then(data => { if (data) setBalance(data) })
      .catch((e) => { setError((e as Error).message) })
      .finally(() => setLoading(false))
  }, [id])

  return (
    <DataState
      loading={loading}
      error={error}
      isEmpty={!loading && !error && !balance}
      emptyTitle="Balance not found"
      emptyDetail="It may have been removed or you may not have access."
    >
    {balance && (
    <div className="page-enter p-6 space-y-6 max-w-5xl">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <Link to="/balances">
          <Button variant="ghost" size="sm">← Back</Button>
        </Link>
        <div className="flex-1">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {balance.practice?.name ?? 'Practice'}
          </p>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {balance.patient?.displayName}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <StageBadge stage={balance.currentStage ?? balance.status} />
            <span className="text-sm text-gray-400 dark:text-gray-500">
              {balance.daysOutstanding} days outstanding
            </span>
          </div>
        </div>
        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {fmtCurrency(balance.amount)}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Visit & procedure, full width on large screens (PMS / Abeldent path is Patient A/R + connector) */}
        <Card className="lg:col-span-2">
          <CardHeader title="Visit & procedure" subtitle="Tied to your practice management system" />
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            The legacy balance view is amount-only until the PMS connector fills procedure and visit detail.
            On the <strong>Patient A/R</strong> path, AbelDent (and similar) sync can supply procedure code,
            description, treatment date, and an external patient id for reconciliation. See{' '}
            <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">docs/product/PMS-INTEGRATION-PLAN.md</code> in the repo.
          </p>
          <InfoRow label="Source" value={balance.source ?? 'N/A'} />
          <InfoRow label="Procedure / line detail" value="N/A (add via PMS or CSV with extended fields in a future release)" />
        </Card>

        {/* Patient info */}
        <Card>
          <CardHeader title="Patient Information" />
          <InfoRow label="Name"              value={balance.patient?.displayName} />
          <InfoRow label="Email"             value={balance.patient?.emailFake ?? 'N/A'} />
          <InfoRow label="Phone"             value={balance.patient?.phoneFake ?? 'N/A'} />
          <InfoRow label="Preferred channel" value={balance.patient?.preferredChannel ?? 'N/A'} />
        </Card>

        {/* Balance info */}
        <Card>
          <CardHeader title="Claim Information" />
          <InfoRow label="Amount"           value={<span className="font-bold">{fmtCurrency(balance.amount)}</span>} />
          <InfoRow label="Status"           value={<StageBadge stage={balance.currentStage ?? balance.status} />} />
          <InfoRow label="Days outstanding" value={
            <Badge color={balance.daysOutstanding > 60 ? 'red' : balance.daysOutstanding > 30 ? 'amber' : 'green'}>
              {balance.daysOutstanding} days
            </Badge>
          } />
          <InfoRow label="Created"          value={fmtDt(balance.createdAt)} />
          <InfoRow label="Due date"         value={fmtDt(balance.dueDate)} />
        </Card>
      </div>

      {/* Timeline */}
      <Card>
        <CardHeader title="Activity Timeline" subtitle="All stage changes, messages, and payments" />
        <div className="mt-1">
          {/* Stage transitions */}
          {balance.states?.map((s: any) => (
            <TimelineItem key={s.id} icon="🔄" title={`Stage → ${s.stage}`} time={fmtDt(s.stageAt)} />
          ))}
          {/* Outreach events */}
          {balance.outreachEvents?.map((e: any) => (
            <TimelineItem key={e.id} icon="💬" title={`Message sent: ${e.templateKey}`} time={`${fmtDt(e.sentAt)} via ${e.channel}`}>
              <div className="flex items-center gap-2 mb-2">
                <Badge color={e.deliveryStatus === 'SENT' ? 'blue' : 'red'}>{e.deliveryStatus}</Badge>
                <Badge color={e.responseStatus === 'PAY' ? 'green' : e.responseStatus === 'NONE' ? 'gray' : 'amber'}>
                  Response: {e.responseStatus}
                </Badge>
              </div>
              <pre className="text-xs bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-lg p-3 whitespace-pre-wrap font-mono text-gray-700 dark:text-gray-300 leading-relaxed">
                {e.messageBody}
              </pre>
            </TimelineItem>
          ))}
          {/* Payments */}
          {balance.paymentEvents?.map((p: any) => (
            <TimelineItem key={p.id} icon="💰" title="Payment received" time={fmtDt(p.paidAt)}>
              <div className="text-sm text-gray-700 dark:text-gray-300 space-y-0.5">
                <p><span className="text-gray-500">Amount:</span> <strong>{fmtCurrency(p.amountCents / 100)}</strong></p>
                <p><span className="text-gray-500">Method:</span> {p.method}</p>
                <p><span className="text-gray-500">Result:</span> <Badge color={p.result === 'succeeded' ? 'green' : 'red'}>{p.result}</Badge></p>
              </div>
            </TimelineItem>
          ))}
        </div>
      </Card>
    </div>
    )}
    </DataState>
  )
}
