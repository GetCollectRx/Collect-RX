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
                    <Td><Badge>{c.status}</Badge></Td>
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