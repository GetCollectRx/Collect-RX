import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePracticePageGate } from '../hooks/usePracticePageGate'
import { apiFetchJson } from '../lib/apiFetch'
import { usePractice } from '../context/PracticeContext'
import { Badge, Button, Card, CardHeader, DataState, Table, Tbody, Td, Th, Thead, Tr } from '../components/ui'
import { CARRIER_LABELS, recoveryRouteBadgeColor } from '../lib/recoveryDisplay'

interface InboxItem {
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
}

interface ManagedRecoveryRow {
  id: string
  actionType: string
  title: string
  scheduledRecallAt: string | null
  claim: {
    id: string
    claimNumber: string
    carrierId: string
    outstandingAmount: string | number
    recoveryRoute: string | null
  }
}

export default function ArCommandCenter() {
  const gate = usePracticePageGate()
  const { practiceId } = usePractice()
  const [inbox, setInbox] = useState<InboxItem[]>([])
  const [managed, setManaged] = useState<ManagedRecoveryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!practiceId) return
    setLoading(true)
    Promise.all([
      apiFetchJson<{ success: boolean; data: InboxItem[] }>(`/api/desk/${practiceId}/ar-inbox`),
      apiFetchJson<{ success: boolean; data: ManagedRecoveryRow[] }>(`/api/desk/${practiceId}/managed-recovery`),
    ])
      .then(([inboxRes, managedRes]) => {
        setInbox(inboxRes.data ?? [])
        setManaged(managedRes.data ?? [])
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [practiceId])

  if (gate) return gate

  return (
    <div className="page-enter p-6 space-y-6 max-w-[1200px]">
      <div>
        <h1 className="text-xl font-bold">AR command center</h1>
        <p className="text-sm text-gray-500 mt-1">
          Unified next actions across denials, underpayments, managed carrier follow-up, and carrier blocks.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader title="Next-action inbox" />
        <DataState loading={loading} empty={!loading && inbox.length === 0} emptyMessage="No open AR actions.">
          <Table>
            <Thead>
              <Tr>
                <Th>Kind</Th>
                <Th>Title</Th>
                <Th>Claim</Th>
                <Th>Carrier</Th>
                <Th>At risk</Th>
                <Th>Due</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {inbox.map((item) => (
                <Tr key={item.id}>
                  <Td><Badge>{item.kind.replace(/_/g, ' ')}</Badge></Td>
                  <Td>
                    <div className="font-medium">{item.title}</div>
                    {item.detail && <div className="text-xs text-gray-500 truncate max-w-xs">{item.detail}</div>}
                  </Td>
                  <Td>{item.claimNumber ?? '—'}</Td>
                  <Td>{item.carrierId ? (CARRIER_LABELS[item.carrierId] ?? item.carrierId) : '—'}</Td>
                  <Td>${item.dollarsAtRisk.toFixed(2)}</Td>
                  <Td>{item.dueAt ? new Date(item.dueAt).toLocaleDateString() : '—'}</Td>
                  <Td>
                    {item.claimId && (
                      <Link to={`/insurance/claims/${item.claimId}`}>
                        <Button size="sm" variant="secondary">Open</Button>
                      </Link>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </DataState>
      </Card>

      <Card>
        <CardHeader title="Managed recovery queue" subtitle="Vapi carrier follow-up awaiting recall or CSV confirmation" />
        <DataState loading={loading} empty={!loading && managed.length === 0} emptyMessage="No managed recovery items.">
          <Table>
            <Thead>
              <Tr>
                <Th>Claim</Th>
                <Th>Action</Th>
                <Th>Route</Th>
                <Th>Recall</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {managed.map((row) => (
                <Tr key={row.id}>
                  <Td>{row.claim.claimNumber}</Td>
                  <Td>{row.title}</Td>
                  <Td>
                    {row.claim.recoveryRoute && (
                      <Badge className={recoveryRouteBadgeColor(row.claim.recoveryRoute)}>
                        {row.claim.recoveryRoute}
                      </Badge>
                    )}
                  </Td>
                  <Td>{row.scheduledRecallAt ? new Date(row.scheduledRecallAt).toLocaleString() : '—'}</Td>
                  <Td>
                    <Link to={`/insurance/claims/${row.claim.id}`}>
                      <Button size="sm" variant="secondary">View</Button>
                    </Link>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </DataState>
      </Card>
    </div>
  )
}
