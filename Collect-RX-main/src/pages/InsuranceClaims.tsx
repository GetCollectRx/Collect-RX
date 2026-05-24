import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { apiFetchJson } from '../lib/apiFetch'
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
  const [claims, setClaims] = useState<InsuranceClaimRow[]>([])
  const [escalated, setEscalated] = useState<InsuranceClaimRow[]>([])
  const [denied, setDenied] = useState<InsuranceClaimRow[]>([])
  const [blockedCarriers, setBlockedCarriers] = useState<{ code: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState({ carrier: '', status: '', aging: '' })
  const [denialSummary, setDenialSummary] = useState<{ carrierId: string; denialRate: number }[]>([])

  useEffect(() => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ limit: '100' })
    if (filters.carrier) params.set('carrier', filters.carrier)
    if (filters.status) params.set('status', filters.status)
    if (filters.aging) params.set('aging', filters.aging)

    Promise.all([
      apiFetchJson<{ success: boolean; data: InsuranceClaimRow[] }>(`/api/insurance/claims?${params}`),
      apiFetchJson<{ success: boolean; data: InsuranceClaimRow[] }>(`/api/insurance/claims?limit=50&status=ESCALATED`),
      apiFetchJson<{ success: boolean; data: InsuranceClaimRow[] }>(`/api/insurance/claims?limit=50&status=DENIED`),
      apiFetchJson<{ success: boolean; data: { byCarrier: { carrierId: string; denialRate: number }[] } }>(
        '/api/insurance/analytics/denials',
      ),
      apiFetchJson<{ totalOpenAR: number; operationalAlerts?: { blockedCarriers: { code: string; name: string }[] } }>(
        `/api/dashboard/stats?practiceId=${practiceId}`,
      ),
    ])
      .then(([listRes, escalatedRes, deniedRes, denialRes, dashRes]) => {
        setClaims(listRes.data ?? [])
        setEscalated(escalatedRes.data ?? [])
        setDenied(deniedRes.data ?? [])
        setDenialSummary(denialRes.data?.byCarrier?.slice(0, 5) ?? [])
        setBlockedCarriers(dashRes.operationalAlerts?.blockedCarriers ?? [])
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [practiceId, filters])

  return (
    <DataState loading={practiceLoading || loading} error={error}>
      <div className="page-enter p-6 space-y-6 max-w-6xl">
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="page-title">Insurance AR</h1>
            <p className="page-subtitle">Carrier claims, call outcomes, and denial analytics (live API).</p>
          </div>
          <Link to="/work-queue">
            <Button variant="secondary" size="sm">Unified work queue</Button>
          </Link>
        </header>

        {/* ── Carrier block alert — highest severity ── */}
        {blockedCarriers.length > 0 && (
          <div className="rounded-2xl border-2 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-red-500 font-bold text-lg leading-none">🚨</span>
              <h2 className="text-sm font-bold text-red-900 dark:text-red-300">
                Carrier block active — AI calls suspended
              </h2>
            </div>
            <p className="text-xs text-red-800 dark:text-red-400 leading-relaxed">
              One or more carriers detected automation on a recent call. All AI calls to these carriers are suspended
              until manually reviewed and unblocked in Admin → Carriers.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {blockedCarriers.map((c) => (
                <span key={c.code} className="text-xs font-semibold px-2 py-1 rounded-full bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800">
                  {c.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Escalation queue — needs human call ── */}
        {escalated.length > 0 && (
          <div className="rounded-2xl border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <h2 className="text-sm font-bold text-amber-900 dark:text-amber-300">
                {escalated.length} claim{escalated.length !== 1 ? 's' : ''} need{escalated.length === 1 ? 's' : ''} your call
              </h2>
            </div>
            <p className="text-xs text-amber-800 dark:text-amber-400 leading-relaxed">
              The AI reached the carrier but couldn't resolve these — a supervisor, appeals department, or written dispute is required.
              Open each claim to read the AI's call summary, then call the carrier directly to close it.
            </p>
            <div className="space-y-2">
              {escalated.map((c) => (
                <div key={c.id} className="flex items-center justify-between bg-white dark:bg-gray-900 rounded-xl border border-amber-200 dark:border-amber-800 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white font-mono">{c.claimNumber}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {CARRIER_LABELS[c.carrierId] ?? c.carrierId} · {fmtMoney(c.outstandingAmount)} outstanding · {c.daysOutstanding}d
                    </p>
                  </div>
                  <Link to={`/insurance/${c.id}`}>
                    <Button size="sm" variant="secondary">View call summary →</Button>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Denied claims — need appeal/write-off decision ── */}
        {denied.length > 0 && (
          <div className="rounded-2xl border-2 border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <h2 className="text-sm font-bold text-red-900 dark:text-red-300">
                {denied.length} denied claim{denied.length !== 1 ? 's' : ''} — decision required
              </h2>
            </div>
            <p className="text-xs text-red-800 dark:text-red-400 leading-relaxed">
              These claims were denied by the carrier. Each one needs a decision: appeal, resubmit with corrections, or write off.
              Open the claim to read the denial reason from the AI's call, then take action.
            </p>
            <div className="space-y-2">
              {denied.map((c) => (
                <div key={c.id} className="flex items-center justify-between bg-white dark:bg-gray-900 rounded-xl border border-red-200 dark:border-red-800 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white font-mono">{c.claimNumber}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {CARRIER_LABELS[c.carrierId] ?? c.carrierId} · {fmtMoney(c.outstandingAmount)} · {c.daysOutstanding}d
                    </p>
                  </div>
                  <Link to={`/insurance/${c.id}`}>
                    <Button size="sm" variant="secondary">Review denial →</Button>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {denialSummary.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {denialSummary.map((d) => (
              <div key={d.carrierId} className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
                <p className="text-2xs text-gray-500 uppercase">{CARRIER_LABELS[d.carrierId] ?? d.carrierId}</p>
                <p className="text-lg font-semibold">{d.denialRate}%</p>
                <p className="text-2xs text-gray-400">denial rate</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Select value={filters.carrier} onChange={(e) => setFilters((f) => ({ ...f, carrier: e.target.value }))} aria-label="Carrier">
            <option value="">All carriers</option>
            {Object.entries(CARRIER_LABELS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </Select>
          <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} aria-label="Status">
            <option value="">All statuses</option>
            {['PENDING', 'IN_QUEUE', 'CALLING', 'DENIED', 'ESCALATED', 'RESOLVED'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <Select value={filters.aging} onChange={(e) => setFilters((f) => ({ ...f, aging: e.target.value }))} aria-label="Aging">
            <option value="">All aging</option>
            <option value="30-60">30–60 days</option>
            <option value="60-90">60–90 days</option>
            <option value="90+">90+ days</option>
          </Select>
        </div>

        <TableContainer>
          <Table>
            <Thead>
              <Tr>
                <Th>Carrier</Th>
                <Th>Claim #</Th>
                <Th>Billed</Th>
                <Th>Outstanding</Th>
                <Th>Days</Th>
                <Th>Status</Th>
                <Th>Calls</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {claims.length === 0 ? (
                <TableEmpty colSpan={8} message="No claims match these filters." />
              ) : (
                claims.map((c) => (
                  <Tr key={c.id}>
                    <Td>{CARRIER_LABELS[c.carrierId] ?? c.carrierId}</Td>
                    <Td className="font-mono text-xs">{c.claimNumber}</Td>
                    <Td>{fmtMoney(c.billedAmount)}</Td>
                    <Td>{fmtMoney(c.outstandingAmount)}</Td>
                    <Td>
                      <Badge color={c.daysOutstanding > 90 ? 'red' : c.daysOutstanding > 60 ? 'amber' : 'green'}>
                        {c.daysOutstanding}d
                      </Badge>
                    </Td>
                    <Td>
                      <Badge color={c.status === 'ESCALATED' ? 'amber' : undefined}>
                        {c.status}
                      </Badge>
                    </Td>
                    <Td>{c._count?.callAttempts ?? 0}</Td>
                    <Td>
                      <Link to={`/insurance/${c.id}`}>
                        <Button variant="ghost" size="sm">Open</Button>
                      </Link>
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </Table>
        </TableContainer>
      </div>
    </DataState>
  )
}
