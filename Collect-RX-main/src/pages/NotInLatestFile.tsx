import { useCallback, useEffect, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { apiFetchJson } from '../lib/apiFetch'
import { carrierLabel } from '../lib/recoveryDisplay'
import {
  Badge, Button, Card, CardHeader, DataState, InlineToast, Modal,
  Table, TableContainer, Tbody, Td, Th, Thead, Tr, useToast,
} from '../components/ui'

interface AwaitingClaim {
  id: string
  claimNumber: string
  carrierId: string
  outstandingAmount: number
  daysOutstanding: number
  notInFileSince: string
}

type Decision = 'RESOLVED' | 'RESTORE'

function fmtMoney(amount: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount)
}

function fmtDate(value: string): string {
  return new Date(value).toLocaleDateString('en-CA', { dateStyle: 'medium' })
}

export default function NotInLatestFile() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const [items, setItems] = useState<AwaitingClaim[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<Decision | null>(null)
  const [saving, setSaving] = useState(false)
  const { toast, showToast } = useToast()

  const load = useCallback(async () => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetchJson<{ success: boolean; data: AwaitingClaim[] }>('/api/claims-not-in-latest-file')
      setItems(res.data)
      setSelected(new Set())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [practiceId])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allSelected = items.length > 0 && selected.size === items.length

  async function confirm() {
    if (!pending) return
    setSaving(true)
    try {
      const res = await apiFetchJson<{ success: boolean; decided: number; skipped: string[] }>(
        '/api/claims-not-in-latest-file/decision',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claimIds: [...selected], decision: pending }),
        },
      )
      const verb = pending === 'RESOLVED' ? 'Confirmed resolved' : 'Put back into follow-up'
      const note = res.skipped.length > 0 ? ` (${res.skipped.length} already handled)` : ''
      showToast('success', `${verb}: ${res.decided} claim${res.decided === 1 ? '' : 's'}${note}`)
      setPending(null)
      await load()
    } catch (e) {
      showToast('error', (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const busy = practiceLoading || (loading && items.length === 0)
  const count = selected.size

  return (
    <div className="page-enter p-6 space-y-6 max-w-[1100px]">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Not in latest file</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          These open claims were left out of a file you said listed all of your open insurance claims. CollectRx has
          paused calls on them. A claim missing from a file is not proof it was paid, so nothing is resolved or resumed
          until you decide. A claim that comes back in a later file with a balance resumes on its own.
        </p>
      </div>

      {toast && <InlineToast toast={toast} />}

      <DataState
        loading={busy}
        error={error}
        isEmpty={!busy && items.length === 0}
        emptyTitle="No claims are waiting for review"
        emptyDetail="Claims appear here when a full export leaves them out."
      >
        <Card padding="none">
          <div className="p-5 pb-0 flex flex-wrap items-start justify-between gap-3">
            <CardHeader title="Waiting for your decision" subtitle={`${items.length} claim${items.length === 1 ? '' : 's'}`} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={count === 0} onClick={() => setPending('RESTORE')}>
                Put back into follow-up{count > 0 ? ` (${count})` : ''}
              </Button>
              <Button size="sm" variant="primary" disabled={count === 0} onClick={() => setPending('RESOLVED')}>
                Confirm resolved{count > 0 ? ` (${count})` : ''}
              </Button>
            </div>
          </div>
          <TableContainer className="border-0 shadow-none rounded-none">
            <Table>
              <Thead>
                <Tr>
                  <Th>
                    <input
                      type="checkbox"
                      aria-label="Select all claims"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))}
                    />
                  </Th>
                  <Th>Claim</Th>
                  <Th>Carrier</Th>
                  <Th align="right">Outstanding</Th>
                  <Th className="hidden md:table-cell">Days out</Th>
                  <Th className="hidden md:table-cell">Left out of file</Th>
                </Tr>
              </Thead>
              <Tbody>
                {items.map((item) => (
                  <Tr key={item.id}>
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={`Select claim ${item.claimNumber}`}
                        checked={selected.has(item.id)}
                        onChange={() => toggle(item.id)}
                      />
                    </Td>
                    <Td bold>{item.claimNumber}</Td>
                    <Td><Badge color="gray">{carrierLabel(item.carrierId)}</Badge></Td>
                    <Td align="right">{fmtMoney(item.outstandingAmount)}</Td>
                    <Td muted className="hidden md:table-cell">{item.daysOutstanding}</Td>
                    <Td muted className="hidden md:table-cell">{fmtDate(item.notInFileSince)}</Td>
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
        title={pending === 'RESOLVED' ? 'Confirm these claims are resolved' : 'Put these claims back into follow-up'}
        footer={
          <>
            <Button variant="secondary" disabled={saving} onClick={() => setPending(null)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void confirm()}>
              {pending === 'RESOLVED' ? 'Confirm resolved' : 'Put back into follow-up'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {pending === 'RESOLVED'
            ? `${count} claim${count === 1 ? '' : 's'} will stay closed and CollectRx will not call about ${count === 1 ? 'it' : 'them'}. Your decision is recorded.`
            : `${count} claim${count === 1 ? '' : 's'} will go back to the follow-up they were in before, and calls can resume. Your decision is recorded.`}
        </p>
      </Modal>
    </div>
  )
}
