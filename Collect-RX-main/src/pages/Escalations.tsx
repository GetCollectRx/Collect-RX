import { useCallback, useEffect, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { apiFetchJson } from '../lib/apiFetch'
import {
  Card, CardHeader, Badge, DataState, Button,
  TableContainer, Table, Thead, Tbody, Tr, Th, Td,
} from '../components/ui'
import { resolveIsReadOnly, resolveUserRole } from '../components/ProtectedRoute'
import type { EscalationDto, EscalationResolution } from '../types/practiceSettings'
import type { UserRole } from '../types/userRole'

function fmtMoney(cents: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)
}

export default function Escalations() {
  const ctx = usePractice()
  const { practiceId, loading: practiceLoading, isFrontDesk } = ctx
  const [items, setItems] = useState<EscalationDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<UserRole | null>(() => resolveUserRole(ctx))

  const isReadOnly = resolveIsReadOnly(ctx, userRole)
  const isOwner = userRole === 'practice_owner' || ctx.deskRole === 'owner'
  const canResolve = !isReadOnly && (isFrontDesk || isOwner || userRole === 'billing_ops_manager')

  useEffect(() => {
    const derived = resolveUserRole(ctx)
    if (derived) setUserRole(derived)
    else {
      void apiFetchJson<{ userRole?: UserRole }>('/api/auth/me').then((d) => setUserRole(d.userRole ?? null))
    }
  }, [ctx.isPlatformDev, ctx.isFrontDesk, ctx.deskRole])

  const load = useCallback(async () => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetchJson<{ success: boolean; data: EscalationDto[] }>(
        `/api/calls/${practiceId}/escalations?status=open`,
      )
      setItems(res.data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [practiceId])

  useEffect(() => {
    void load()
  }, [load])

  async function resolve(id: string, resolution: EscalationResolution, notes?: string) {
    if (!practiceId || !canResolve) return
    setBusyId(id)
    try {
      await apiFetchJson(`/api/calls/${practiceId}/escalations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution, notes }),
      })
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const busy = practiceLoading || (loading && items.length === 0)

  return (
    <DataState loading={busy} error={error} isEmpty={!busy && items.length === 0} emptyTitle="No open escalations">
      <div className="page-enter p-6 space-y-6 max-w-[1400px]">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Escalations</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
            Claims requiring staff action
          </p>
        </div>

        <Card padding="none">
          <div className="p-5 pb-0">
            <CardHeader title="Open escalations" subtitle={`${items.length} pending`} />
          </div>
          <TableContainer className="border-0 shadow-none rounded-none">
            <Table>
              <Thead>
                <Tr>
                  <Th>Claim</Th>
                  <Th>Carrier</Th>
                  <Th align="right">Amount</Th>
                  <Th>Reason</Th>
                  <Th>Created</Th>
                  <Th>Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {items.map((e) => (
                  <Tr key={e.id} highlight={e.status === 'open'}>
                    <Td bold>{e.claimRef}</Td>
                    <Td>{e.carrierId.replace(/_/g, ' ')}</Td>
                    <Td align="right">{fmtMoney(e.amountClaimedCents)}</Td>
                    <Td className="max-w-[240px] truncate">{e.reason}</Td>
                    <Td muted>{new Date(e.createdAt).toLocaleDateString('en-CA')}</Td>
                    <Td>
                      {e.status === 'open' && canResolve ? (
                        <div className="flex flex-wrap gap-1">
                          {(isFrontDesk && !isOwner
                            ? (['resolved'] as EscalationResolution[])
                            : (['resolved', 'appealing', 'written_off', 'paused_for_review'] as EscalationResolution[])
                          ).map((action) => (
                            <Button
                              key={action}
                              size="sm"
                              variant={action === 'resolved' ? 'primary' : 'secondary'}
                              disabled={busyId === e.id}
                              onClick={() => void resolve(e.id, action)}
                            >
                              {action.replace(/_/g, ' ')}
                            </Button>
                          ))}
                        </div>
                      ) : e.status === 'resolved' ? (
                        <Badge color="green">{e.resolution ?? 'resolved'}</Badge>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </TableContainer>
        </Card>
      </div>
    </DataState>
  )
}
