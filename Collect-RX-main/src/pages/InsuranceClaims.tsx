import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { usePracticePageGate } from '../hooks/usePracticePageGate'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import { SubscriptionUsageCard } from '../components/SubscriptionUsageCard'
import { useRoleAccess } from '../lib/useRoleAccess'
import { workQueuePriorityLabel } from '../lib/workQueuePriority'
import {
  mapTriggerCallError,
  recallDueLabel,
  recoveryRouteBadgeColor,
  RECOVERY_ROUTE_LABELS,
  claimStatusLabel,
  lastOutcomeLine,
  CARRIER_LABELS,
} from '../lib/recoveryDisplay'
import {
  Button, Select, Input, DataState,
  TableContainer, Table, Thead, Tbody, Th, Tr, Td, TableEmpty, Badge,
} from '../components/ui'

type ClaimsTab = 'all' | 'queue' | 'blocked' | 'human'

const VALID_TABS = new Set<ClaimsTab>(['all', 'queue', 'blocked', 'human'])

const TAB_ITEMS: { id: ClaimsTab; label: string }[] = [
  { id: 'all', label: 'All claims' },
  { id: 'queue', label: 'Priority queue' },
  { id: 'blocked', label: 'Blocked gates' },
  { id: 'human', label: 'Needs human' },
]

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
  lastOutcome?: string | null
  lastOutcomeDetail?: string | null
  _count?: { callAttempts: number }
}

interface WorkItemRow {
  id: string
  itemType: string
  sourceType: string
  sourceId: string
  title: string | null
  dollarsAtRisk: string | number
  daysOutstanding: number
  carrierId: string | null
  assignedRep: string | null
  followUpAt: string | null
  notes: string | null
  rankScore: number
  recoveryRoute?: string | null
  blockingGateTitle?: string | null
  gateDueToday?: boolean
}

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

function fmtMoney(v: string | number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(v))
}

function parseTab(raw: string | null): ClaimsTab {
  if (raw && VALID_TABS.has(raw as ClaimsTab)) return raw as ClaimsTab
  return 'all'
}

function ClaimsTabBar({ tab, onTab }: { tab: ClaimsTab; onTab: (t: ClaimsTab) => void }) {
  return (
    <div className="flex flex-wrap gap-2 px-6 pt-4">
      {TAB_ITEMS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onTab(t.id)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
            tab === t.id
              ? 'bg-crx-600 text-white border-crx-600'
              : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-crx-300'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export default function InsuranceClaims() {
  const { practiceId, canFetch, pageBusy, pageError } = usePracticePageGate()
  const { isReadOnly, canInitiateCalls, canClearGates } = useRoleAccess()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = parseTab(searchParams.get('tab'))

  const [claims, setClaims] = useState<InsuranceClaimRow[]>([])
  const [queueItems, setQueueItems] = useState<WorkItemRow[]>([])
  const [gates, setGates] = useState<GateRow[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState({ carrier: '', status: '', aging: '', recoveryRoute: '' })
  const [queueFilters, setQueueFilters] = useState({ aging: '', gatesDueToday: false })
  const [denialSummary, setDenialSummary] = useState<{ carrierId: string; denialRate: number }[]>([])
  const [triggeringId, setTriggeringId] = useState<string | null>(null)
  const [callError, setCallError] = useState<string | null>(null)
  const [clearingId, setClearingId] = useState<string | null>(null)
  const [gateActionMsg, setGateActionMsg] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingRepId, setEditingRepId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [rep, setRep] = useState('')

  const setTab = (next: ClaimsTab) => {
    if (next === 'all') {
      setSearchParams({})
    } else {
      setSearchParams({ tab: next })
    }
  }

  // Shared-axis slide: content enters from the side you're moving toward.
  // Direction is captured as state at the moment the tab changes (adjust-
  // during-render pattern) so it survives the loading unmount/remount.
  const [slide, setSlide] = useState<{ tab: ClaimsTab; dir: 'fwd' | 'back' }>({ tab, dir: 'fwd' })
  if (slide.tab !== tab) {
    const prevIndex = TAB_ITEMS.findIndex((t) => t.id === slide.tab)
    const nextIndex = TAB_ITEMS.findIndex((t) => t.id === tab)
    setSlide({ tab, dir: nextIndex >= prevIndex ? 'fwd' : 'back' })
  }
  const slideDir = slide.dir

  const loadClaims = useCallback(() => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ limit: '100' })
    if (filters.carrier) params.set('carrier', filters.carrier)
    if (tab === 'human') {
      params.set('status', 'ESCALATED')
    } else if (filters.status) {
      params.set('status', filters.status)
    }
    if (filters.aging) params.set('aging', filters.aging)
    if (filters.recoveryRoute) params.set('recoveryRoute', filters.recoveryRoute)

    const requests: Promise<void>[] = [
      apiFetchJson<{ success: boolean; data: InsuranceClaimRow[] }>(`/api/insurance/claims?${params}`)
        .then((listRes) => setClaims(listRes.data ?? [])),
    ]
    if (tab === 'all') {
      requests.push(
        apiFetchJson<{ success: boolean; data: { byCarrier: { carrierId: string; denialRate: number }[] } }>(
          '/api/insurance/analytics/denials',
        ).then((denialRes) => setDenialSummary(denialRes.data?.byCarrier?.slice(0, 5) ?? [])),
      )
    }

    Promise.all(requests)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [practiceId, filters, tab])

  const loadQueue = useCallback(() => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ limit: '100' })
    if (queueFilters.aging) params.set('aging', queueFilters.aging)
    if (queueFilters.gatesDueToday) params.set('gatesDueToday', 'true')
    apiFetchJson<{ success: boolean; items: WorkItemRow[] }>(`/api/work-queue?${params}`)
      .then((res) => setQueueItems(res.items ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [practiceId, queueFilters])

  const loadGates = useCallback(() => {
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
    if (tab === 'queue') loadQueue()
    else if (tab === 'blocked') loadGates()
    else loadClaims()
  }, [canFetch, tab, loadClaims, loadQueue, loadGates])

  const syncQueue = async () => {
    setSyncing(true)
    try {
      await apiFetch('/api/work-queue/sync', { method: 'POST' })
      loadQueue()
    } finally {
      setSyncing(false)
    }
  }

  const triggerCall = async (claim: InsuranceClaimRow) => {
    if (claim.canCallCarrier === false) return
    setTriggeringId(claim.id)
    setCallError(null)
    try {
      const r = await apiFetch(`/api/insurance/queue/trigger/${claim.id}`, { method: 'POST' })
      const j = await r.json().catch(() => ({})) as { error?: string }
      if (!r.ok) throw new Error(mapTriggerCallError(j.error ?? 'Could not queue call'))
      loadClaims()
    } catch (e) {
      setCallError((e as Error).message)
    } finally {
      setTriggeringId(null)
    }
  }

  const saveNotes = async (id: string) => {
    await apiFetch(`/api/work-queue/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    })
    setEditingId(null)
    loadQueue()
  }

  const saveRep = async (id: string) => {
    await apiFetch(`/api/work-queue/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedRep: rep || null }),
    })
    setEditingRepId(null)
    loadQueue()
  }

  const clearGate = async (gate: GateRow) => {
    setClearingId(gate.id)
    setGateActionMsg(null)
    try {
      const r = await apiFetch(`/api/insurance/recovery/actions/${gate.id}/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId: gate.claimId }),
      })
      const j = await r.json().catch(() => ({})) as { error?: string; scheduledRecallAt?: string }
      if (!r.ok) throw new Error(j.error ?? 'Could not clear gate')
      setGateActionMsg(
        j.scheduledRecallAt
          ? `Gate cleared, follow-up call scheduled for ${new Date(j.scheduledRecallAt).toLocaleString()}`
          : 'Gate cleared',
      )
      loadGates()
    } catch (e) {
      setGateActionMsg((e as Error).message)
    } finally {
      setClearingId(null)
    }
  }

  const statusColor = (s: string): 'green' | 'blue' | 'amber' | 'red' | 'gray' => {
    if (s === 'RESOLVED') return 'green'
    if (s === 'CALLING' || s === 'IN_QUEUE') return 'blue'
    if (s === 'DENIED') return 'red'
    if (s === 'ESCALATED' || s === 'ON_HOLD') return 'amber'
    return 'gray'
  }

  const subtitle =
    tab === 'queue'
      ? 'Open claims ranked by dollars at risk, aging, and carrier denial risk.'
      : tab === 'blocked'
        ? 'Practice gates blocking carrier calls — complete in PMS, then mark ready.'
        : tab === 'human'
          ? 'Claims escalated for staff review before the next carrier call.'
          : 'Open carrier claims, recovery routes, and call outcomes — ranked by priority.'

  return (
    <DataState loading={pageBusy(loading)} error={pageError(error)}>
      <div className="page-enter">
        <div className="px-6 pt-6 pb-5 border-b border-gray-100 dark:border-gray-800/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="page-title">Claims</h1>
            <p className="page-subtitle mt-0.5">{subtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {tab === 'queue' && (
              <Button size="sm" onClick={() => void syncQueue()} disabled={syncing}>
                {syncing ? 'Syncing…' : 'Refresh from sources'}
              </Button>
            )}
            {tab === 'blocked' && (
              <Button variant="secondary" size="sm" onClick={() => loadGates()}>
                Refresh
              </Button>
            )}
            {tab === 'all' && (
              <Link to="/reports/carriers">
                <Button variant="ghost" size="sm">Carrier stats</Button>
              </Link>
            )}
          </div>
        </div>

        <ClaimsTabBar tab={tab} onTab={setTab} />

        <div className="p-6 space-y-5 max-w-6xl">
          <SubscriptionUsageCard compact />
          <div key={tab} className={`crx-tab-panel crx-tab-panel--${slideDir} space-y-5`}>
          {callError && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">{callError}</p>
          )}
          {gateActionMsg && tab === 'blocked' && (
            <p className="text-sm text-crx-600 dark:text-crx-400" role="status">{gateActionMsg}</p>
          )}

          {tab === 'all' && denialSummary.length > 0 && (
            <details className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30 px-4 py-3">
              <summary className="text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
                Carrier denial intel (monthly){' '}
                <Link to="/reports/carriers" className="text-crx-600 dark:text-crx-400 underline ml-1">
                  full report →
                </Link>
              </summary>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {denialSummary.map((d) => (
                  <span key={d.carrierId} className="text-gray-700 dark:text-gray-300">
                    <span className="font-medium">{CARRIER_LABELS[d.carrierId] ?? d.carrierId}</span>
                    {' '}
                    <span
                      className={
                        d.denialRate > 20
                          ? 'text-red-600 dark:text-red-400 font-semibold tabular-nums'
                          : d.denialRate > 10
                            ? 'text-amber-600 dark:text-amber-400 font-semibold tabular-nums'
                            : 'text-gray-600 dark:text-gray-400 tabular-nums'
                      }
                    >
                      {d.denialRate}%
                    </span>
                  </span>
                ))}
              </div>
            </details>
          )}

          {(tab === 'all' || tab === 'human') && (
            <>
              <div className="flex flex-wrap gap-2.5">
                {tab === 'all' && (
                  <>
                    <Select value={filters.carrier} onChange={(e) => setFilters((f) => ({ ...f, carrier: e.target.value }))} aria-label="Carrier">
                      <option value="">All carriers</option>
                      {Object.entries(CARRIER_LABELS).map(([id, label]) => (
                        <option key={id} value={id}>{label}</option>
                      ))}
                    </Select>
                    <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} aria-label="Status">
                      <option value="">All statuses</option>
                      {['PENDING', 'IN_QUEUE', 'CALLING', 'ON_HOLD', 'DENIED', 'ESCALATED', 'RESOLVED'].map((s) => (
                        <option key={s} value={s}>{claimStatusLabel(s)}</option>
                      ))}
                    </Select>
                    <Select value={filters.recoveryRoute} onChange={(e) => setFilters((f) => ({ ...f, recoveryRoute: e.target.value }))} aria-label="Recovery route">
                      <option value="">All routes</option>
                      {['CALL_CARRIER', 'WAIT_SYNC', 'PRACTICE_GATE', 'OPEN_CDCP', 'STOP'].map((r) => (
                        <option key={r} value={r}>{RECOVERY_ROUTE_LABELS[r] ?? r}</option>
                      ))}
                    </Select>
                  </>
                )}
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
                      <Th>Last outcome</Th>
                      <Th>Calls</Th>
                      <Th />
                    </Tr>
                  </Thead>
                  <Tbody>
                    {claims.length === 0 ? (
                      <TableEmpty colSpan={10} message={tab === 'human' ? 'No escalated claims right now.' : 'No claims match these filters.'} />
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
                              <span className="text-xs text-gray-400">N/A</span>
                            )}
                            {c.blockingGateTitle && (
                              <span className="block text-[10px] text-amber-700 dark:text-amber-400 mt-0.5" title={c.blockingGateTitle}>
                                ⚠ gate
                              </span>
                            )}
                          </Td>
                          <Td muted className="text-xs">{recallDueLabel(c.scheduledRecallAt)}</Td>
                          <Td>
                            <Badge color={statusColor(c.status)} dot>{claimStatusLabel(c.status)}</Badge>
                          </Td>
                          <Td muted className="text-xs max-w-[200px] truncate" title={lastOutcomeLine(c.lastOutcome, c.lastOutcomeDetail)}>
                            {lastOutcomeLine(c.lastOutcome, c.lastOutcomeDetail)}
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
            </>
          )}

          {tab === 'queue' && (
            <>
              <div className="flex flex-wrap gap-2.5 items-center">
                <Select value={queueFilters.aging} onChange={(e) => setQueueFilters((f) => ({ ...f, aging: e.target.value }))} aria-label="Aging">
                  <option value="">All aging</option>
                  <option value="30">30–59 days</option>
                  <option value="60">60–89 days</option>
                  <option value="90">90–119 days</option>
                  <option value="120+">120+ days</option>
                </Select>
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={queueFilters.gatesDueToday}
                    onChange={(e) => setQueueFilters((f) => ({ ...f, gatesDueToday: e.target.checked }))}
                  />
                  Gates due today
                </label>
                {queueItems.length > 0 && (
                  <span className="ml-auto text-xs text-gray-400 dark:text-gray-600 font-medium">
                    {queueItems.length} item{queueItems.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              <TableContainer>
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Priority</Th>
                      <Th>Item</Th>
                      <Th>Recovery</Th>
                      <Th align="right">At Risk</Th>
                      <Th>Age</Th>
                      <Th>Rep</Th>
                      <Th>Notes</Th>
                      <Th />
                    </Tr>
                  </Thead>
                  <Tbody>
                    {queueItems.length === 0 ? (
                      <TableEmpty colSpan={8} message="Queue is empty — run Refresh from sources after a PMS import." />
                    ) : (
                      queueItems.map((row) => {
                        const { label, color } = workQueuePriorityLabel(row.rankScore)
                        return (
                          <Tr key={row.id} highlight={row.gateDueToday || row.daysOutstanding > 90}>
                            <Td>
                              <span className={`inline-flex px-1.5 py-0.5 rounded text-2xs font-bold ${color}`}>
                                {label}
                              </span>
                              {row.gateDueToday && (
                                <Badge color="amber" className="ml-1">Gate</Badge>
                              )}
                            </Td>
                            <Td bold>{row.title ?? row.sourceId.slice(0, 8)}</Td>
                            <Td className="text-xs max-w-[140px]">
                              {row.recoveryRoute ? (
                                <span className="font-mono text-gray-500">{row.recoveryRoute}</span>
                              ) : (
                                'N/A'
                              )}
                              {row.blockingGateTitle && (
                                <p className="text-amber-700 dark:text-amber-400 truncate mt-0.5" title={row.blockingGateTitle}>
                                  {row.blockingGateTitle}
                                </p>
                              )}
                            </Td>
                            <Td align="right" bold>
                              ${Number(row.dollarsAtRisk).toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </Td>
                            <Td>
                              <Badge color={row.daysOutstanding > 90 ? 'red' : row.daysOutstanding > 60 ? 'amber' : 'gray'}>
                                {row.daysOutstanding}d
                              </Badge>
                            </Td>
                            <Td muted className="text-xs max-w-[120px]">
                              {editingRepId === row.id ? (
                                <Input value={rep} onChange={(e) => setRep(e.target.value)} className="text-xs" />
                              ) : (
                                row.assignedRep ?? <span className="text-gray-300 dark:text-gray-700">N/A</span>
                              )}
                            </Td>
                            <Td className="max-w-xs">
                              {editingId === row.id ? (
                                <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="text-xs" />
                              ) : (
                                <span className="text-xs text-gray-400 dark:text-gray-600 truncate block max-w-[160px]">
                                  {row.notes ?? <span className="text-gray-300 dark:text-gray-700">No notes</span>}
                                </span>
                              )}
                            </Td>
                            <Td className="space-x-1">
                              <Link to={`/insurance/${row.sourceId}`}><Button variant="ghost" size="sm">Open</Button></Link>
                              {editingId === row.id ? (
                                <Button variant="secondary" size="sm" onClick={() => void saveNotes(row.id)}>Save</Button>
                              ) : editingRepId === row.id ? (
                                <Button variant="secondary" size="sm" onClick={() => void saveRep(row.id)}>Save</Button>
                              ) : (
                                <>
                                  <Button variant="ghost" size="sm" onClick={() => { setEditingId(row.id); setNotes(row.notes ?? '') }}>Note</Button>
                                  <Button variant="ghost" size="sm" onClick={() => { setEditingRepId(row.id); setRep(row.assignedRep ?? '') }}>Rep</Button>
                                </>
                              )}
                            </Td>
                          </Tr>
                        )
                      })
                    )}
                  </Tbody>
                </Table>
              </TableContainer>
            </>
          )}

          {tab === 'blocked' && (
            <>
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
                        message="No open gates — carrier calls will proceed when dispatch rules allow."
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
            </>
          )}
          </div>
        </div>
      </div>
    </DataState>
  )
}
