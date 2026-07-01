import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePracticePageGate } from '../hooks/usePracticePageGate'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import { useRoleAccess } from '../lib/useRoleAccess'
import {
  Button,
  DataState,
  TableContainer,
  Table,
  Thead,
  Tbody,
  Th,
  Tr,
  Td,
  TableEmpty,
  Badge,
} from '../components/ui'

interface GateRow {
  id: string
  claimId: string
  claimNumber: string
  carrierId: string
  outstandingAmount: number
  actionType: string
  title: string
  detail: string | null
  createdAt: string
  recoveryRoute: string | null
}

const CARRIER_LABELS: Record<string, string> = {
  sun_life: 'Sun Life',
  canada_life: 'Canada Life',
  manulife: 'Manulife',
  green_shield: 'Green Shield',
  rbc: 'RBC Insurance',
  telus_adjudicare: 'TELUS AdjudiCare',
}

function fmtMoney(v: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v)
}

export default function RecoveryGatesInbox() {
  const { practiceId, canFetch, pageBusy, pageError } = usePracticePageGate()
  const { canClearGates } = useRoleAccess()
  const [gates, setGates] = useState<GateRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clearingId, setClearingId] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    apiFetchJson<{ success: boolean; data: GateRow[] }>('/api/insurance/recovery/gates')
      .then((res) => setGates(res.data ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [practiceId])

  useEffect(() => {
    if (!canFetch) return
    load()
  }, [canFetch, load])

  const clearGate = async (gate: GateRow) => {
    setClearingId(gate.id)
    setActionMsg(null)
    try {
      const r = await apiFetch(`/api/insurance/recovery/actions/${gate.id}/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId: gate.claimId }),
      })
      const j = await r.json().catch(() => ({})) as { error?: string; scheduledRecallAt?: string }
      if (!r.ok) throw new Error(j.error ?? 'Could not clear gate')
      setActionMsg(
        j.scheduledRecallAt
          ? `Gate cleared, follow-up call scheduled for ${new Date(j.scheduledRecallAt).toLocaleString()}`
          : 'Gate cleared',
      )
      load()
    } catch (e) {
      setActionMsg((e as Error).message)
    } finally {
      setClearingId(null)
    }
  }

  return (
    <DataState loading={pageBusy(loading)} error={pageError(error)}>
      <div className="page-enter">
        <div className="px-6 pt-6 pb-5 border-b border-gray-100 dark:border-gray-800/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="page-title">Practice gate inbox</h1>
            <p className="page-subtitle mt-0.5">
              Blocking recovery actions, complete in PMS, then mark ready to re-call.
            </p>
          </div>
          <div className="flex gap-2">
            <Link to="/insurance">
              <Button variant="ghost" size="sm">← Claims</Button>
            </Link>
            <Button variant="secondary" size="sm" onClick={() => load()}>
              Refresh
            </Button>
          </div>
        </div>

        <div className="p-6 space-y-4 max-w-5xl">
          {actionMsg && (
            <p className="text-sm text-crx-600 dark:text-crx-400" role="status">
              {actionMsg}
            </p>
          )}

          {gates.length > 0 && (
            <p className="text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-4 py-3">
              {gates.length} open gate{gates.length !== 1 ? 's' : ''} blocking carrier calls.
            </p>
          )}

          <TableContainer>
            <Table>
              <Thead>
                <Tr>
                  <Th>Claim</Th>
                  <Th>Carrier</Th>
                  <Th>Gate</Th>
                  <Th align="right">Outstanding</Th>
                  <Th>Opened</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {gates.length === 0 ? (
                  <TableEmpty
                    colSpan={6}
                    message="No open gates, carrier calls will proceed when dispatch rules allow."
                  />
                ) : (
                  gates.map((g) => (
                    <Tr key={g.id}>
                      <Td bold>
                        <Link to={`/insurance/${g.claimId}`} className="text-crx-600 dark:text-crx-400 underline font-mono text-xs">
                          {g.claimNumber}
                        </Link>
                      </Td>
                      <Td>{CARRIER_LABELS[g.carrierId] ?? g.carrierId}</Td>
                      <Td>
                        <div className="space-y-1">
                          <Badge color="amber">{g.actionType.replace(/_/g, ' ')}</Badge>
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{g.title}</p>
                          {g.detail && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md">{g.detail}</p>
                          )}
                        </div>
                      </Td>
                      <Td align="right" bold>{fmtMoney(g.outstandingAmount)}</Td>
                      <Td muted className="text-xs">
                        {new Date(g.createdAt).toLocaleDateString()}
                      </Td>
                      <Td className="space-x-1.5">
                        <Link to={`/insurance/${g.claimId}`}>
                          <Button variant="ghost" size="sm">Open claim</Button>
                        </Link>
                        {canClearGates && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={clearingId === g.id}
                            onClick={() => void clearGate(g)}
                          >
                            {clearingId === g.id ? '…' : 'Mark complete'}
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </Table>
          </TableContainer>
        </div>
      </div>
    </DataState>
  )
}
