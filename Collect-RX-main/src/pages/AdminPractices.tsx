import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch, apiFetchJson } from '../lib/apiFetch'
import {
  Card, CardHeader, Badge, Button, DataState,
  TableContainer, Table, Thead, Tbody, Tr, Th, Td,
} from '../components/ui'

type FeatureFlagState = {
  feature: string
  paused: boolean
  pauseReason: string | null
  pausedAt: string | null
}

const FEATURE_LABELS: Record<string, string> = {
  'csv_ar.denial_hub': 'Denial hub',
  'csv_ar.eob_reconciliation': 'EOB reconciliation',
  'csv_ar.previsit_csv': 'Pre-visit CSV import',
  'csv_ar.carrier_intelligence': 'Carrier intelligence',
  'csv_ar.ar_command_center': 'AR command center',
  'csv_ar.dso_console': 'DSO console',
  'csv_ar.compliance_workspace': 'Compliance workspace',
}

type AdminPractice = {
  id: string
  name: string
  voiceAgentEnabled: boolean
  openEscalations: number
  lastCallAt: string | null
  billingTier: string
  tierName: string
  subscriptionStatus: string | null
  callsPaused: boolean
  callsPausedReason: string | null
  minutesConsumed: number
  minutesIncluded: number
  minutesRemaining: number
}

export default function AdminPractices() {
  const [practices, setPractices] = useState<AdminPractice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [flags, setFlags] = useState<FeatureFlagState[]>([])
  const [flagsError, setFlagsError] = useState<string | null>(null)
  const [flagBusy, setFlagBusy] = useState<string | null>(null)

  const loadFlags = useCallback(() => {
    apiFetchJson<{ success: boolean; data: FeatureFlagState[] }>('/api/admin/feature-flags')
      .then((res) => setFlags(res.data))
      .catch((e) => setFlagsError((e as Error).message))
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    apiFetchJson<{ success: boolean; data: AdminPractice[] }>('/api/admin/practices')
      .then((res) => setPractices(res.data))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
    loadFlags()
  }, [loadFlags])

  async function toggleFlag(feature: string, nextPaused: boolean) {
    setFlagBusy(feature)
    setFlagsError(null)
    try {
      const res = await apiFetch(`/api/admin/feature-flags/${feature}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: nextPaused }),
      })
      if (!res.ok) { const b = await res.json() as { error?: string }; throw new Error(b.error ?? 'Failed to update flag') }
      loadFlags()
    } catch (e) {
      setFlagsError((e as Error).message)
    } finally {
      setFlagBusy(null)
    }
  }

  return (
    <DataState loading={loading} error={error} isEmpty={!loading && practices.length === 0} emptyTitle="No practices">
      <div className="page-enter p-6 space-y-6 max-w-[1400px]">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Platform Admin</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
            All practices, voice agent status and activity
          </p>
        </div>

        <Card>
          <CardHeader title="Staged rollout flags" subtitle="Platform-wide kill switch for CSV-AR features" />
          {flagsError && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{flagsError}</p>}
          <div className="space-y-2">
            {flags.map((f) => (
              <div key={f.feature} className="flex items-center justify-between gap-3 py-1.5">
                <div>
                  <p className="text-sm text-gray-900 dark:text-gray-100">{FEATURE_LABELS[f.feature] ?? f.feature}</p>
                  {f.paused && f.pauseReason && (
                    <p className="text-2xs text-gray-400 dark:text-gray-500">{f.pauseReason}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge color={f.paused ? 'red' : 'green'}>{f.paused ? 'Paused' : 'Live'}</Badge>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={flagBusy === f.feature}
                    onClick={() => void toggleFlag(f.feature, !f.paused)}
                  >
                    {f.paused ? 'Resume' : 'Pause'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card padding="none">
          <div className="p-5 pb-0">
            <CardHeader title="Practices" subtitle={`${practices.length} registered`} />
          </div>
          <TableContainer className="border-0 shadow-none rounded-none">
            <Table>
              <Thead>
                <Tr>
                  <Th>Practice</Th>
                  <Th>Voice agent</Th>
                  <Th>Plan</Th>
                  <Th align="right">Minutes used</Th>
                  <Th>Calling</Th>
                  <Th align="right">Open escalations</Th>
                  <Th>Last call</Th>
                  <Th>Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {practices.map((p) => (
                  <Tr key={p.id}>
                    <Td bold>{p.name}</Td>
                    <Td>
                      <Badge color={p.voiceAgentEnabled ? 'green' : 'gray'}>
                        {p.voiceAgentEnabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </Td>
                    <Td>
                      <span className="text-sm">{p.tierName}</span>
                      {p.subscriptionStatus && p.subscriptionStatus !== 'active' && (
                        <span className="block text-2xs text-gray-400">{p.subscriptionStatus}</span>
                      )}
                    </Td>
                    <Td align="right">
                      {p.minutesConsumed} / {p.minutesIncluded}
                      <span className="block text-2xs text-gray-400">{p.minutesRemaining} left</span>
                    </Td>
                    <Td>
                      <Badge color={p.callsPaused ? 'red' : 'green'}>
                        {p.callsPaused ? `Paused${p.callsPausedReason ? ` — ${p.callsPausedReason}` : ''}` : 'Active'}
                      </Badge>
                    </Td>
                    <Td align="right">{p.openEscalations}</Td>
                    <Td muted>
                      {p.lastCallAt
                        ? new Date(p.lastCallAt).toLocaleString('en-CA')
                        : 'Never'}
                    </Td>
                    <Td>
                      <Link to={`/admin/health?practice=${p.id}`} className="text-xs text-crx-600 hover:underline dark:text-crx-400">
                        View health
                      </Link>
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
