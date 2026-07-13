import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePracticePageGate } from '../hooks/usePracticePageGate'
import { apiFetchJson } from '../lib/apiFetch'
import { Badge, Button, Card, CardHeader, DataState, Table, Tbody, Td, Th, Thead, Tr } from '../components/ui'
import { NeedsYouInbox } from '../components/NeedsYouInbox'
import { recoveryRouteBadgeColor } from '../lib/recoveryDisplay'

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
  const { practiceId, canFetch, pageBusy, pageError } = usePracticePageGate()
  const [inbox, setInbox] = useState<InboxItem[]>([])
  const [managed, setManaged] = useState<ManagedRecoveryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canFetch || !practiceId) return
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
  }, [canFetch, practiceId])

  return (
    <DataState loading={pageBusy(loading)} error={pageError(error)}>
      <div className="page-enter max-w-[1200px]">
        <div className="px-6 pt-6 pb-5 border-b border-gray-100 dark:border-gray-800/60">
          <h1 className="page-title">AR command center</h1>
          <p className="page-subtitle mt-0.5">
            Unified next actions across denials, underpayments, managed carrier follow-up, and carrier blocks.
          </p>
        </div>

        <div className="p-6 space-y-6">
          <NeedsYouInbox
            items={inbox}
            loading={loading}
            emptyAction={
              <Link to="/import" className="crx-btn-primary inline-flex text-sm">
                Import claims CSV
              </Link>
            }
          />

        <Card>
          <CardHeader title="Managed recovery queue" subtitle="Vapi carrier follow-up awaiting recall or CSV confirmation" />
          <DataState
            loading={loading}
            error={null}
            isEmpty={!loading && managed.length === 0}
            emptyTitle="No managed recovery items."
            emptyDetail="CollectRx schedules carrier follow-up automatically when claims need recall or payment trace."
          >
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
                        <Badge color={recoveryRouteBadgeColor(row.claim.recoveryRoute)}>
                          {row.claim.recoveryRoute}
                        </Badge>
                      )}
                    </Td>
                    <Td>{row.scheduledRecallAt ? new Date(row.scheduledRecallAt).toLocaleString() : '—'}</Td>
                    <Td>
                      <Link to={`/insurance/${row.claim.id}`}>
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
      </div>
    </DataState>
  )
}
