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

type ActivePause = {
  scope: 'system' | 'practice' | 'carrier'
  practiceId: string | null
  carrierId: string | null
  reason: string | null
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
  const [pauses, setPauses] = useState<ActivePause[]>([])
  const [carriers, setCarriers] = useState<string[]>([])
  const [pauseReason, setPauseReason] = useState('')
  const [pauseError, setPauseError] = useState<string | null>(null)
  const [pauseBusy, setPauseBusy] = useState<string | null>(null)

  const loadPauses = useCallback(() => {
    apiFetchJson<{ success: boolean; data: { pauses: ActivePause[]; carriers: string[] } }>('/api/admin/pauses')
      .then((res) => { setPauses(res.data.pauses); setCarriers(res.data.carriers) })
      .catch((e) => setPauseError((e as Error).message))
  }, [])

  async function setPause(key: string, path: string, paused: boolean) {
    if (paused && pauseReason.trim() === '') { setPauseError('Enter a short reason first (no patient information).'); return }
    setPauseBusy(key)
    setPauseError(null)
    try {
      const res = await apiFetch(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused, ...(paused ? { reason: pauseReason.trim() } : {}) }),
      })
      if (!res.ok) { const b = await res.json() as { error?: string }; throw new Error(b.error ?? 'Failed to update pause') }
      loadPauses()
    } catch (e) {
      setPauseError((e as Error).message)
    } finally {
      setPauseBusy(null)
    }
  }

  const isSystemPaused = pauses.some((p) => p.scope === 'system')
  const isPracticePaused = (id: string) => pauses.some((p) => p.scope === 'practice' && p.practiceId === id)
  const isCarrierPaused = (id: string) => pauses.some((p) => p.scope === 'carrier' && p.practiceId === null && p.carrierId === id)

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
    loadPauses()
  }, [loadFlags, loadPauses])

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

        <Card>
          <CardHeader title="Calling pause" subtitle="Stops new carrier calls within minutes. Calls already live are not cut off." />
          {pauseError && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{pauseError}</p>}
          <input
            type="text"
            maxLength={200}
            value={pauseReason}
            onChange={(e) => setPauseReason(e.target.value)}
            placeholder="Reason for pausing (no patient information)"
            className="w-full mb-3 rounded border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1 text-sm"
          />
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 py-1.5">
              <p className="text-sm text-gray-900 dark:text-gray-100">All calling, every practice</p>
              <div className="flex items-center gap-2">
                <Badge color={isSystemPaused ? 'red' : 'green'}>{isSystemPaused ? 'Paused' : 'Live'}</Badge>
                <Button size="sm" variant="secondary" disabled={pauseBusy === 'system'} onClick={() => void setPause('system', '/api/admin/pauses/system', !isSystemPaused)}>
                  {isSystemPaused ? 'Resume' : 'Pause'}
                </Button>
              </div>
            </div>
            {carriers.map((c) => (
              <div key={c} className="flex items-center justify-between gap-3 py-1.5">
                <p className="text-sm text-gray-900 dark:text-gray-100">Carrier {c}, every practice</p>
                <div className="flex items-center gap-2">
                  <Badge color={isCarrierPaused(c) ? 'red' : 'green'}>{isCarrierPaused(c) ? 'Paused' : 'Live'}</Badge>
                  <Button size="sm" variant="secondary" disabled={pauseBusy === `carrier:${c}`} onClick={() => void setPause(`carrier:${c}`, `/api/admin/pauses/carriers/${c}`, !isCarrierPaused(c))}>
                    {isCarrierPaused(c) ? 'Resume' : 'Pause'}
                  </Button>
                </div>
              </div>
            ))}
            {practices.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 py-1.5">
                <p className="text-sm text-gray-900 dark:text-gray-100">Practice {p.name}</p>
                <div className="flex items-center gap-2">
                  <Badge color={isPracticePaused(p.id) ? 'red' : 'green'}>{isPracticePaused(p.id) ? 'Paused' : 'Live'}</Badge>
                  <Button size="sm" variant="secondary" disabled={pauseBusy === `practice:${p.id}`} onClick={() => void setPause(`practice:${p.id}`, `/api/admin/pauses/practices/${p.id}`, !isPracticePaused(p.id))}>
                    {isPracticePaused(p.id) ? 'Resume' : 'Pause'}
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
