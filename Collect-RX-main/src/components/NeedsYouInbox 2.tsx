import { Link } from 'react-router-dom'
import { Badge, Button, Card, CardHeader, Table, Tbody, Td, Th, Thead, Tr } from './ui'
import { CARRIER_LABELS, recoveryRouteBadgeColor } from '../lib/recoveryDisplay'

export type NeedsYouItem = {
  id: string
  kind: string
  title: string
  detail: string | null
  claimId: string | null
  claimNumber: string | null
  carrierId: string | null
  dollarsAtRisk: number
  dueAt: string | null
  route: string | null
  href?: string
}

function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    recovery_gate: 'Gate',
    denial: 'Denial',
    underpayment: 'Underpayment',
    managed_recovery: 'Follow-up',
    carrier_block: 'Carrier block',
    blocking_gate: 'Blocking gate',
    payment_trace_due: 'Payment trace',
  }
  return map[kind] ?? kind.replace(/_/g, ' ')
}

function kindColor(kind: string): 'red' | 'amber' | 'green' | 'blue' | undefined {
  if (kind === 'carrier_block' || kind === 'blocking_gate') return 'red'
  if (kind === 'denial' || kind === 'underpayment') return 'amber'
  if (kind === 'managed_recovery' || kind === 'payment_trace_due') return 'blue'
  return undefined
}

function itemHref(item: NeedsYouItem): string | null {
  if (item.href) return item.href
  if (item.kind === 'carrier_block') return '/settings'
  if (item.claimId) return `/insurance/${item.claimId}`
  return null
}

type NeedsYouInboxProps = {
  items: NeedsYouItem[]
  loading?: boolean
  compact?: boolean
  title?: string
  subtitle?: string
  emptyTitle?: string
  emptyDetail?: string
  emptyAction?: React.ReactNode
}

export function NeedsYouInbox({
  items,
  loading,
  compact,
  title = 'Needs you',
  subtitle = 'Prioritized actions that require staff — gates, denials, underpayments, and carrier blocks.',
  emptyTitle = "You're caught up",
  emptyDetail = 'No open gates or staff actions. CollectRx continues carrier follow-up automatically.',
  emptyAction,
}: NeedsYouInboxProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader title={title} subtitle={subtitle} />
        <p className="text-sm text-gray-500 px-4 pb-4">Loading actions…</p>
      </Card>
    )
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardHeader title={title} subtitle={subtitle} />
        <div className="px-4 pb-5 text-center">
          <p className="text-sm font-medium">{emptyTitle}</p>
          <p className="text-sm text-gray-500 mt-1">{emptyDetail}</p>
          {emptyAction && <div className="mt-4">{emptyAction}</div>}
        </div>
      </Card>
    )
  }

  const shown = compact ? items.slice(0, 8) : items

  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={subtitle}
        action={
          compact ? (
            <Link to="/ar-command-center" className="text-xs font-medium underline" style={{ color: 'var(--crx-green)' }}>
              View all
            </Link>
          ) : undefined
        }
      />
      <Table>
        <Thead>
          <Tr>
            <Th>Priority</Th>
            <Th>Action</Th>
            {!compact && <Th>Claim</Th>}
            <Th>At risk</Th>
            <Th>Due</Th>
            <Th />
          </Tr>
        </Thead>
        <Tbody>
          {shown.map((item) => {
            const href = itemHref(item)
            return (
              <Tr key={item.id}>
                <Td>
                  <Badge color={kindColor(item.kind)}>{kindLabel(item.kind)}</Badge>
                </Td>
                <Td>
                  <div className="font-medium text-sm">{item.title}</div>
                  {item.detail && !compact && (
                    <div className="text-xs text-gray-500 truncate max-w-xs">{item.detail}</div>
                  )}
                  {compact && item.claimNumber && (
                    <div className="text-xs text-gray-500 font-mono">{item.claimNumber}</div>
                  )}
                </Td>
                {!compact && (
                  <Td className="font-mono text-xs">{item.claimNumber ?? '—'}</Td>
                )}
                <Td className="tabular-nums">
                  {item.dollarsAtRisk > 0 ? `$${item.dollarsAtRisk.toFixed(2)}` : '—'}
                </Td>
                <Td className="text-xs whitespace-nowrap">
                  {item.dueAt ? new Date(item.dueAt).toLocaleDateString() : '—'}
                </Td>
                <Td>
                  {href && (
                    <Link to={href}>
                      <Button size="sm" variant="secondary">
                        {item.kind === 'carrier_block' ? 'Settings' : 'Open'}
                      </Button>
                    </Link>
                  )}
                  {item.route && !compact && (
                    <Badge color={recoveryRouteBadgeColor(item.route)} className="ml-1">
                      {item.route}
                    </Badge>
                  )}
                  {item.carrierId && compact && (
                    <span className="text-2xs text-gray-500 block">
                      {CARRIER_LABELS[item.carrierId] ?? item.carrierId}
                    </span>
                  )}
                </Td>
              </Tr>
            )
          })}
        </Tbody>
      </Table>
      {compact && items.length > 8 && (
        <p className="text-xs text-gray-500 px-4 py-3 border-t border-gray-100">
          +{items.length - 8} more in{' '}
          <Link to="/ar-command-center" className="underline">AR command center</Link>
        </p>
      )}
    </Card>
  )
}
