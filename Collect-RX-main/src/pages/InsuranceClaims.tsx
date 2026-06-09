import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import { useRoleAccess } from '../lib/useRoleAccess'
import {
  mapTriggerCallError,
  recallDueLabel,
  recoveryRouteBadgeColor,
  RECOVERY_ROUTE_LABELS,
} from '../lib/recoveryDisplay'
import {
  Button, Select, DataState,
  TableContainer, Table, Thead, Tbody, Th, Tr, Td, TableEmpty, Badge,
} from '../components/ui'

interface InsuranceClaimRow {
  id: string
  claimNumber: string
  carrierId: string
  billedAmount: string | number
  outstandingAmount: string | number
  daysOutstanding: number
  status: string
  recoveryRoute?: string | null
  blockingGateTitle?: string | null
  scheduledRecallAt?: string | null
  canCallCarrier?: boolean
  dispatchBlockReason?: string | null
  _count?: { callAttempts: number }
}

const CARRIER_LABELS: Record<string, string> = {
  sun_life: 'Sun Life',
  canada_life: 'Canada Life',
  manulife: 'Manulife',
  green_shield: 'Green Shield',
  rbc: 'RBC Insurance',
  telus_adjudicare: 'TELUS AdjudiCare',
}

function fmtMoney(v: string | number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(v))
}

export default function InsuranceClaims() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const { isReadOnly, canInitiateCalls } = useRoleAccess()
  const [claims, setClaims] = useState<InsuranceClaimRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState({ carrier: '', status: '', aging: '', recoveryRoute: '' })
  const [denialSummary, setDenialSummary] = useState<{ carrierId: string; denialRate: number }[]>([])
  const [triggeringId, setTriggeringId] = useState<string | null>(null)
  const [callError, setCallError] = useState<string | null>(null)

  const load = () => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ limit: '100' })
    if (filters.carrier) params.set('carrier', filters.carrier)
    if (filters.status) params.set('status', filters.status)
    if (filters.aging) params.set('aging', filters.aging)
    if (filters.recoveryRoute) params.set('recoveryRoute', filters.recoveryRoute)

    Promise.all([
      apiFetchJson<{ success: boolean; data: InsuranceClaimRow[] }>(`/api/insurance/claims?${params}`),
      apiFetchJson<{ success: boolean; data: { byCarrier: { carrierId: string; denialRate: number }[] } }>(
        '/api/insurance/analytics/denials',
      ),
    ])
      .then(([listRes, denialRes]) => {
        setClaims(listRes.data ?? [])
        setDenialSummary(denialRes.data?.byCarrier?.slice(0, 5) ?? [])
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [practiceId, filters])

  const triggerCall = async (claim: InsuranceClaimRow) => {
    if (claim.canCallCarrier === false) return
    setTriggeringId(claim.id)
    setCallError(null)
    try {
      const r = await apiFetch(`/api/insurance/queue/trigger/${claim.id}`, { method: 'POST' })
      const j = await r.json().catch(() => ({})) as { error?: string }
      if (!r.ok) throw new Error(mapTriggerCallError(j.error ?? 'Could not queue call'))
      load()
    } catch (e) {
      setCallError((e as Error).message)
    } finally {
      setTriggeringId(null)
    }
  }

  const statusColor = (s: string): 'green' | 'blue' | 'amber' | 'red' | 'gray' => {
    if (s === 'RESOLVED') return 'green'
    if (s === 'CALLING' || s === 'IN_QUEUE') return 'blue'
    if (s === 'DENIED') return 'red'
    if (s === 'ESCALATED' || s === 'ON_HOLD') return 'amber'
    return 'gray'
  }

  const openGateCount = claims.filter((c) => c.blockingGateTitle).length

  return (
    <DataState loading={practiceLoading || loading} error={error}>
      <div className="page-enter">
        <div className="px-6 pt-6 pb-5 border-b border-gray-100 dark:border-gray-800/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="page-title">Insurance AR</h1>
            <p className="page-subtitle mt-0.5">Carrier claims, recovery routes, and call outcomes.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/insurance/gates">
              <Button variant="secondary" size="sm">
                Gate inbox{openGateCount > 0 ? ` (${openGateCount})` : ''}
              </Button>
            </Link>
            <Link to="/work-queue">
              <Button variant="secondary" size="sm">Work queue</Button>
            </Link>
          </div>
        </div>

        <div className="p-6 space-y-5 max-w-6xl">
          {callError && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">{callError}</p>
          )}

          {denialSummary.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
              {denialSummary.map((d) => (
                <div
                  key={d.carrierId}
                  className="relative bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-3.5 overflow-hidden"
                >
                  <div className={`absolute top-0 left-0 right-0 h-[2.5px] ${d.denialRate > 20 ? 'bg-red-400' : d.denialRate > 10 ? 'bg-amber-400' : 'bg-crx-500'}`} />
                  <p className="text-2xs font-semibold text-gray-400 dark:text-gray-600 uppercase tracking-wide mb-1.5">
                    {CARRIER_LABELS[d.carrierId] ?? d.carrierId}
                  </p>
                  <p className={`text-xl font-bold tabular-nums leading-none ${d.denialRate > 20 ? 'text-red-600 dark:text-red-400' : d.denialRate > 10 ? 'text-amber-600 dark:text-amber-400' : 'text-crx-600 dark:text-crx-400'}`}>
                    {d.denialRate}%
                  </p>
                  <p className="text-2xs text-gray-400 dark:text-gray-600 mt-1">denial rate</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2.5">
            <Select value={filters.carrier} onChange={(e) => setFilters((f) => ({ ...f, carrier: e.target.value }))} aria-label="Carrier">
              <option value="">All carriers</option>
              {Object.entries(CARRIER_LABELS).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </Select>
            <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} aria-label="Status">
              <option value="">All statuses</option>
              {['PENDING', 'IN_QUEUE', 'CALLING', 'ON_HOLD', 'DENIED', 'ESCALATED', 'RESOLVED'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
            <Select value={filters.recoveryRoute} onChange={(e) => setFilters((f) => ({ ...f, recoveryRoute: e.target.value }))} aria-label="Recovery route">
              <option value="">All routes</option>
              {['CALL_CARRIER', 'WAIT_SYNC', 'PRACTICE_GATE', 'OPEN_CDCP', 'STOP'].map((r) => (
                <option key={r} value={r}>{RECOVERY_ROUTE_LABELS[r] ?? r}</option>
              ))}
            </Select>
            <Select value={filters.aging} onChange={(e) => setFilters((f) => ({ ...f, aging: e.target.value }))} aria-label="Aging">
              <option value="">All aging</option>
              <option value="30-60">30–60 days</option>
              <option value="60-90">60–90 days</option>
              <option value="90+">90+ days</option>
            </Select>
            {claims.length > 0 && (
              <span className="ml-auto self-center text-xs text-gray-400 dark:text-gray-600 font-medium">
                {claims.length} claim{claims.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <TableContainer>
            <Table>
              <Thead>
                <Tr>
                  <Th>Carrier</Th>
                  <Th>Claim #</Th>
                  <Th align="right">Outstanding</Th>
                  <Th>Age</Th>
                  <Th>Route</Th>
                  <Th>Recall</Th>
                  <Th>Status</Th>
                  <Th>Calls</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {claims.length === 0 ? (
                  <TableEmpty colSpan={9} message="No claims match these filters." />
                ) : (
                  claims.map((c) => (
                    <Tr key={c.id} highlight={c.daysOutstanding > 90}>
                      <Td bold>{CARRIER_LABELS[c.carrierId] ?? c.carrierId}</Td>
                      <Td muted className="font-mono text-xs">{c.claimNumber}</Td>
                      <Td align="right" bold>{fmtMoney(c.outstandingAmount)}</Td>
                      <Td>
                        <Badge color={c.daysOutstanding > 90 ? 'red' : c.daysOutstanding > 60 ? 'amber' : 'green'} dot>
                          {c.daysOutstanding}d
                        </Badge>
                      </Td>
                      <Td>
                        {c.recoveryRoute ? (
                          <Badge color={recoveryRouteBadgeColor(c.recoveryRoute)}>
                            {RECOVERY_ROUTE_LABELS[c.recoveryRoute] ?? c.recoveryRoute}
                          </Badge>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                        {c.blockingGateTitle && (
                          <span className="block text-[10px] text-amber-700 dark:text-amber-400 mt-0.5" title={c.blockingGateTitle}>
                            ⚠ gate
                          </span>
                        )}
                      </Td>
                      <Td muted className="text-xs">{recallDueLabel(c.scheduledRecallAt)}</Td>
                      <Td>
                        <Badge color={statusColor(c.status)} dot>{c.status}</Badge>
                      </Td>
                      <Td muted>{c._count?.callAttempts ?? 0}</Td>
                      <Td className="space-x-1.5">
                        <Link to={`/insurance/${c.id}`}>
                          <Button variant="ghost" size="sm">Open</Button>
                        </Link>
                        {c.status !== 'RESOLVED' && canInitiateCalls && !isReadOnly && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={triggeringId === c.id || c.canCallCarrier === false}
                            title={c.dispatchBlockReason ?? undefined}
                            onClick={() => void triggerCall(c)}
                          >
                            {triggeringId === c.id ? '…' : 'Call'}
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
