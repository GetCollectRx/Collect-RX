import { useCallback, useEffect, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { apiFetchJson } from '../lib/apiFetch'
import { carrierLabel } from '../lib/recoveryDisplay'
import {
  Badge, Button, Card, CardHeader, DataState, InlineToast, Modal,
  Table, TableContainer, Tbody, Td, Th, Thead, Tr, useToast,
} from '../components/ui'

type CheckpointStatus = 'PENDING' | 'APPROVED' | 'REVOKED'

interface Checkpoint {
  id: string
  carrierId: string
  status: CheckpointStatus
  requestedAt: string
  decidedAt: string | null
  notes: string | null
  queuedClaims: number
}

interface Pending {
  checkpoint: Checkpoint
  decision: 'APPROVED' | 'REVOKED'
}

const STATUS_LABEL: Record<CheckpointStatus, string> = {
  PENDING: 'Waiting for your approval',
  APPROVED: 'Approved',
  REVOKED: 'Calling stopped',
}

const STATUS_COLOR: Record<CheckpointStatus, 'amber' | 'green' | 'red'> = {
  PENDING: 'amber',
  APPROVED: 'green',
  REVOKED: 'red',
}

function fmtDate(value: string | null): string {
  if (!value) return ''
  return new Date(value).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })
}

function ActionButton({ item, onOpen }: { item: Checkpoint; onOpen: (c: Checkpoint, d: Pending['decision']) => void }) {
  return item.status === 'APPROVED' ? (
    <Button size="sm" variant="secondary" className="whitespace-nowrap" onClick={() => onOpen(item, 'REVOKED')}>
      Stop calling
    </Button>
  ) : (
    <Button size="sm" variant="primary" className="whitespace-nowrap" onClick={() => onOpen(item, 'APPROVED')}>
      Approve
    </Button>
  )
}

export default function CarrierApprovals() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const [items, setItems] = useState<Checkpoint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const { toast, showToast } = useToast()

  const load = useCallback(async () => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetchJson<{ success: boolean; data: Checkpoint[] }>(
        `/api/dispatch-checkpoints?practiceId=${encodeURIComponent(practiceId)}`,
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

  function open(checkpoint: Checkpoint, decision: Pending['decision']) {
    setNotes('')
    setPending({ checkpoint, decision })
  }

  async function confirm() {
    if (!pending) return
    setSaving(true)
    try {
      await apiFetchJson(`/api/dispatch-checkpoints/${encodeURIComponent(pending.checkpoint.id)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: pending.decision, notes: notes.trim() || undefined }),
      })
      const name = carrierLabel(pending.checkpoint.carrierId)
      showToast('success', pending.decision === 'APPROVED' ? `${name} approved. Calls can start.` : `Calls to ${name} stopped.`)
      setPending(null)
      await load()
    } catch (e) {
      showToast('error', (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const busy = practiceLoading || (loading && items.length === 0)
  const waiting = items.filter((i) => i.status === 'PENDING').length
  const pendingName = pending ? carrierLabel(pending.checkpoint.carrierId) : ''

  return (
    <div className="page-enter p-6 space-y-6 max-w-[1100px]">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Carrier approvals</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Before CollectRx places its first automated call to a carrier for your practice, you approve that carrier here
          once. Nothing is called until you do. You can stop calling a carrier at any time.
        </p>
      </div>

      {toast && <InlineToast toast={toast} />}

      <DataState
        loading={busy}
        error={error}
        isEmpty={!busy && items.length === 0}
        emptyTitle="No carrier is waiting for approval"
        emptyDetail="When carrier approval is switched on for your practice, each carrier appears here the first time a call to it is ready."
      >
        <Card padding="none">
          <div className="p-5 pb-0">
            <CardHeader
              title="Carriers"
              subtitle={waiting > 0 ? `${waiting} waiting for your approval` : 'No carrier is waiting for approval'}
            />
          </div>
          <TableContainer className="border-0 shadow-none rounded-none">
            <Table>
              <Thead>
                <Tr>
                  <Th>Carrier</Th>
                  <Th>Status</Th>
                  <Th className="hidden md:table-cell">Last update</Th>
                  <Th className="hidden md:table-cell">Action</Th>
                </Tr>
              </Thead>
              <Tbody>
                {items.map((item) => (
                  <Tr key={item.id}>
                    <Td bold>
                      {carrierLabel(item.carrierId)}
                      <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">
                        {item.queuedClaims} claim{item.queuedClaims === 1 ? '' : 's'} waiting to be called
                      </span>
                      <span className="mt-2 block md:hidden">
                        <ActionButton item={item} onOpen={open} />
                      </span>
                    </Td>
                    <Td>
                      <Badge color={STATUS_COLOR[item.status]} dot>{STATUS_LABEL[item.status]}</Badge>
                    </Td>
                    <Td className="hidden md:table-cell">
                      <span className="block text-gray-500 dark:text-gray-400">
                        {fmtDate(item.decidedAt ?? item.requestedAt)}
                      </span>
                      {item.notes && <span className="block max-w-[260px] truncate">{item.notes}</span>}
                    </Td>
                    <Td className="hidden md:table-cell">
                      <ActionButton item={item} onOpen={open} />
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </TableContainer>
        </Card>
      </DataState>

      <Modal
        open={pending !== null}
        onClose={() => (saving ? undefined : setPending(null))}
        title={pending?.decision === 'APPROVED' ? `Approve calls to ${pendingName}` : `Stop calls to ${pendingName}`}
        footer={
          <>
            <Button variant="secondary" disabled={saving} onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void confirm()}>
              {pending?.decision === 'APPROVED' ? 'Approve and start calling' : 'Stop calling'}
            </Button>
          </>
        }
      >
        {pending && (
          <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
            {pending.decision === 'APPROVED' ? (
              <p>
                CollectRx will place automated calls to {pendingName} for your practice
                {pending.checkpoint.queuedClaims > 0
                  ? `, starting with the ${pending.checkpoint.queuedClaims} claim${pending.checkpoint.queuedClaims === 1 ? '' : 's'} now waiting`
                  : ''}
                . Your decision is recorded with your name and the time.
              </p>
            ) : (
              <p>
                No new calls to {pendingName} will start for your practice. A call already in progress is not cut off.
                Your decision is recorded with your name and the time.
              </p>
            )}
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Note (optional)</span>
              <textarea
                className="w-full rounded-lg border border-gray-200 bg-white text-sm text-gray-900 px-3 py-2 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
                rows={3}
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Do not enter patient names or health card numbers"
              />
            </label>
          </div>
        )}
      </Modal>
    </div>
  )
}
