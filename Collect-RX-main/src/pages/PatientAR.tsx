import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/apiFetch'
import { parseApiJson } from '../lib/parseApiJson'
import { useRoleAccess } from '../lib/useRoleAccess'
import {
  StatTile, Badge, Button, Select, InlineToast, useToast,
  TableContainer, Table, Thead, Tbody, Th, Tr, Td, TableEmpty,
  DataState,
} from '../components/ui'

// ── Constants ─────────────────────────────────────────────────────────────
const PAYMENT_LABELS: Record<string, { label: string; color: 'red'|'amber'|'green'|'gray' }> = {
  outstanding: { label: 'Outstanding', color: 'red' },
  partial:     { label: 'Partial',     color: 'amber' },
  paid:        { label: 'Paid',        color: 'green' },
  written_off: { label: 'Written off', color: 'gray' },
}
const REMINDER_LABELS: Record<string, { label: string; color: 'gray'|'blue'|'indigo'|'purple' }> = {
  none:       { label: 'Not sent',   color: 'gray' },
  reminder_1: { label: 'Reminder 1', color: 'blue' },
  reminder_2: { label: 'Reminder 2', color: 'indigo' },
  reminder_3: { label: 'Reminder 3', color: 'purple' },
}

interface PatientBalance {
  id: string
  patientFirstName: string
  patientLastName: string
  procedureCode?: string
  procedureDescription?: string
  treatmentDate?: string
  amountBilled?: number
  insurancePaid?: number
  patientOwes: number
  daysSinceAdjudication?: number
  reminderStatus: string
  paymentStatus: string
  stripePaymentLink?: string
}

function fmtCurrency(v: number | null | undefined) {
  return v != null
    ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v)
    : '—'
}
function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Component ─────────────────────────────────────────────────────────────
export default function PatientAR() {
  const [balances, setBalances]     = useState<PatientBalance[]>([])
  const [loading, setLoading]       = useState(true)
  const [paymentFilter, setFilter]  = useState('')
  const [sendingId, setSendingId]   = useState<string | null>(null)
  const [writingOffId, setWriteOff] = useState<string | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const { toast, showToast }        = useToast()
  const { canSendReminders, isReadOnly } = useRoleAccess()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (paymentFilter) params.set('payment_status', paymentFilter)
      const res = await apiFetch(`/api/patients/balances?${params}`)
      const data = await parseApiJson<{ balances?: PatientBalance[]; error?: string }>(res)
      if (!res.ok) throw new Error(data.error || 'Failed to load patient AR')
      setBalances(data.balances ?? [])
    } catch (err) {
      setError((err as Error).message)
      setBalances([])
    } finally {
      setLoading(false)
    }
  }, [paymentFilter])

  useEffect(() => { load() }, [load])

  async function handleSendReminder(id: string) {
    setSendingId(id)
    try {
      const res  = await apiFetch(`/api/patients/balances/${id}/send-reminder`, { method: 'POST' })
      const data = await parseApiJson<{ error?: string; emailSent?: boolean; smsSent?: boolean }>(res)
      if (!res.ok) throw new Error(data.error || 'Request failed')
      showToast('ok', `Reminder sent — email: ${data.emailSent ? 'yes' : 'no'}, SMS: ${data.smsSent ? 'yes' : 'no'}`)
      await load()
    } catch (err) { showToast('err', (err as Error).message) }
    finally { setSendingId(null) }
  }

  async function handleWriteOff(id: string, name: string) {
    if (!window.confirm(`Write off the balance for ${name}? This cannot be undone.`)) return
    setWriteOff(id)
    try {
      const res = await apiFetch(`/api/patients/balances/${id}/write-off`, { method: 'POST' })
      const d = await parseApiJson<{ error?: string }>(res)
      if (!res.ok) throw new Error(d.error || 'Write-off failed')
      showToast('ok', 'Balance written off')
      await load()
    } catch (err) { showToast('err', (err as Error).message) }
    finally { setWriteOff(null) }
  }

  const outstanding = balances.filter(b => b.paymentStatus === 'outstanding' || b.paymentStatus === 'partial')
  const totalOwed   = outstanding.reduce((s, b) => s + (b.patientOwes ?? 0), 0)
  const neverCalled = balances.filter(b => b.reminderStatus === 'none' && b.paymentStatus === 'outstanding').length

  return (
    <DataState loading={loading && balances.length === 0 && !error} error={error} isEmpty={false}>
    <div className="page-enter p-6 space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Patient AR</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Post-insurance balances — synced from your practice management system</p>
        </div>
        <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatTile label="Total outstanding" value={fmtCurrency(totalOwed)} sub={`${outstanding.length} balance${outstanding.length !== 1 ? 's' : ''}`} accent="red" />
        <StatTile label="Never contacted"   value={String(neverCalled)}   sub="no reminder sent" accent="amber" />
        <StatTile label="Total balances"    value={String(balances.length)} sub="all statuses" />
      </div>

      {/* Toast */}
      {toast && <InlineToast toast={toast} />}

      {/* Filter bar */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-4 py-3 flex items-end gap-3">
        <Select
          label="Payment status"
          value={paymentFilter}
          onChange={e => setFilter(e.target.value)}
          className="w-44"
        >
          <option value="">All statuses</option>
          <option value="outstanding">Outstanding</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
          <option value="written_off">Written off</option>
        </Select>
        <Button variant="ghost" size="sm" onClick={() => setFilter('')}>Clear</Button>
        <span className="ml-auto text-xs text-gray-400 self-end pb-0.5">
          {balances.length} patient{balances.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      {loading && balances.length > 0 ? (
        <p className="text-sm text-gray-500">Refreshing…</p>
      ) : null}
        <TableContainer>
          <Table>
            <Thead>
              <tr>
                <Th>Patient</Th>
                <Th>Procedure</Th>
                <Th>Tx date</Th>
                <Th align="right">Billed</Th>
                <Th align="right">Ins. paid</Th>
                <Th align="right">Patient owes</Th>
                <Th align="right">Days</Th>
                <Th>Reminder</Th>
                <Th>Payment</Th>
                <Th>Actions</Th>
              </tr>
            </Thead>
            <Tbody>
              {balances.length === 0 ? (
                <TableEmpty message="No patient balances found. Balances sync from your PMS export or connector." colSpan={10} />
              ) : (
                balances.map(b => {
                  const fullName   = `${b.patientFirstName} ${b.patientLastName}`
                  const canRemind  = !isReadOnly && canSendReminders && (b.paymentStatus === 'outstanding' || b.paymentStatus === 'partial') && b.reminderStatus !== 'reminder_3'
                  const canWriteOff = !isReadOnly && (b.paymentStatus !== 'paid' && b.paymentStatus !== 'written_off')
                  const days       = b.daysSinceAdjudication ?? 0
                  const pStatus    = PAYMENT_LABELS[b.paymentStatus]  ?? { label: b.paymentStatus, color: 'gray' as const }
                  const rStatus    = REMINDER_LABELS[b.reminderStatus] ?? { label: b.reminderStatus, color: 'gray' as const }

                  return (
                    <Tr key={b.id}>
                      <Td bold>{fullName}</Td>
                      <Td muted>
                        <span title={b.procedureDescription ?? ''}>{b.procedureCode ?? '—'}</span>
                      </Td>
                      <Td muted>{fmtDate(b.treatmentDate)}</Td>
                      <Td align="right" muted>{fmtCurrency(b.amountBilled)}</Td>
                      <Td align="right" muted>{fmtCurrency(b.insurancePaid)}</Td>
                      <Td align="right" bold>{fmtCurrency(b.patientOwes)}</Td>
                      <Td align="right">
                        <Badge color={days >= 45 ? 'red' : days >= 21 ? 'amber' : 'gray'}>
                          {b.daysSinceAdjudication ?? '—'}
                        </Badge>
                      </Td>
                      <Td><Badge color={rStatus.color}>{rStatus.label}</Badge></Td>
                      <Td><Badge color={pStatus.color}>{pStatus.label}</Badge></Td>
                      <Td>
                        <div className="flex items-center gap-1.5">
                          {canRemind && (
                            <Button
                              size="xs"
                              variant="primary"
                              loading={sendingId === b.id}
                              onClick={() => handleSendReminder(b.id)}
                            >
                              Remind
                            </Button>
                          )}
                          {b.stripePaymentLink && (
                            <a
                              href={b.stripePaymentLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center text-xs px-2 py-1 rounded-md border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                            >
                              Pay link
                            </a>
                          )}
                          {canWriteOff && (
                            <Button
                              size="xs"
                              variant="ghost"
                              loading={writingOffId === b.id}
                              onClick={() => handleWriteOff(b.id, fullName)}
                              className="text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                            >
                              Write off
                            </Button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  )
                })
              )}
            </Tbody>
          </Table>
        </TableContainer>
    </div>
    </DataState>
  )
}
