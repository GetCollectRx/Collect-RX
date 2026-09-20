import { useCallback, useEffect, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { apiFetchJson } from '../lib/apiFetch'
import { useRoleAccess } from '../lib/useRoleAccess'
import {
  Card, CardHeader, Badge, DataState, Button, InlineToast, useToast,
  TableContainer, Table, Thead, Tbody, Tr, Th, Td,
} from '../components/ui'

interface PendingApprovalItem {
  callQueueId: string
  claimId: string
  patientName: string
  claimNumber: string
  carrierId: string
  outstandingAmount: number
  daysOutstanding: number
  flagReason: string
  queuedSince: string
}

function fmtMoney(amount: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount)
}

export default function DispatchApprovals() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const { canApproveDispatchBatch } = useRoleAccess()
  const [items, setItems] = useState<PendingApprovalItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | 'ALL' | null>(null)
  const { toast, showToast } = useToast()

  const load = useCallback(async () => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetchJson<{ success: boolean; data: PendingApprovalItem[] }>(
        `/api/dispatch-approvals?practiceId=${practiceId}`,
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

  async function decide(decisions: { claimId: string; decision: 'APPROVED' | 'SKIPPED' }[], busyKey: string) {
    if (!practiceId || !canApproveDispatchBatch || decisions.length === 0) return
    setBusyId(busyKey)
    try {
      const res = await apiFetchJson<{ success: boolean; decided: number; skipped: string[] }>(
        `/api/dispatch-approvals/decide?practiceId=${practiceId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decisions }),
        },
      )
      const verb = decisions[0]?.decision === 'APPROVED' ? 'Approved' : 'Skipped'
      const skippedNote = res.skipped.length > 0 ? ` (${res.skipped.length} already handled by someone else)` : ''
      showToast('success', `${verb} ${res.decided} claim${res.decided === 1 ? '' : 's'}${skippedNote}`)
      await load()
    } catch (e) {
      showToast('error', (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const busy = practiceLoading || (loading && items.length === 0)

  return (
    <div className="page-enter p-6 space-y-6 max-w-[1400px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Dispatch approvals</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
            Claims flagged for carrier follow-up wait here until a staff member approves them —
            nothing is auto-dialed before that.
          </p>
        </div>
        {items.length > 0 && canApproveDispatchBatch && (
          <Button
            variant="primary"
            disabled={busyId !== null}
            onClick={() =>
              void decide(
                items.map((i) => ({ claimId: i.claimId, decision: 'APPROVED' as const })),
                'ALL',
              )
            }
          >
            Approve all ({items.length})
          </Button>
        )}
      </div>

      {toast && <InlineToast toast={toast} />}

      <DataState
        loading={busy}
        error={error}
        isEmpty={!busy && items.length === 0}
        emptyTitle="Nothing waiting on approval"
      >
        <Card padding="none">
          <div className="p-5 pb-0">
            <CardHeader title="Pending review" subtitle={`${items.length} claim${items.length === 1 ? '' : 's'} awaiting approval`} />
          </div>
          <TableContainer className="border-0 shadow-none rounded-none">
            <Table>
              <Thead>
                <Tr>
                  <Th>Patient</Th>
                  <Th>Claim</Th>
                  <Th>Carrier</Th>
                  <Th align="right">Outstanding</Th>
                  <Th>Days out</Th>
                  <Th>Flag reason</Th>
                  <Th>Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {items.map((item) => (
                  <Tr key={item.callQueueId}>
                    <Td bold>{item.patientName}</Td>
                    <Td muted>{item.claimNumber}</Td>
                    <Td>
                      <Badge color="gray">{item.carrierId.replace(/_/g, ' ')}</Badge>
                    </Td>
                    <Td align="right">{fmtMoney(item.outstandingAmount)}</Td>
                    <Td muted>{item.daysOutstanding}</Td>
                    <Td className="max-w-[280px] truncate">{item.flagReason}</Td>
                    <Td>
                      {canApproveDispatchBatch ? (
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={busyId !== null}
                            onClick={() => void decide([{ claimId: item.claimId, decision: 'APPROVED' }], item.claimId)}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busyId !== null}
                            onClick={() => void decide([{ claimId: item.claimId, decision: 'SKIPPED' }], item.claimId)}
                          >
                            Skip
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">View only</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </TableContainer>
        </Card>
      </DataState>
    </div>
  )
}
