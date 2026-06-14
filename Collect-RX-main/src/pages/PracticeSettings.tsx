import { useCallback, useEffect, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { apiFetchJson } from '../lib/apiFetch'
import {
  Card, CardHeader, DataState, Button, Input, Select,
  TableContainer, Table, Thead, Tbody, Tr, Th, Td,
} from '../components/ui'
import { resolveIsReadOnly, resolveUserRole } from '../components/ProtectedRoute'
import type { PracticeSettings, CarrierConfig } from '../types/practiceSettings'
import type { PracticePmsInfo, PmsVendorCatalogEntry, PmsVendorId } from '../types/pms'
import type { UserRole } from '../types/userRole'

type SettingsResponse = {
  success: boolean
  data: {
    practice: { id: string; name: string; timezone: string } | null
    settings: PracticeSettings
    pms?: PracticePmsInfo
  }
}

export default function PracticeSettings() {
  const ctx = usePractice()
  const { practiceId, loading: practiceLoading } = ctx
  const [settings, setSettings] = useState<PracticeSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<UserRole | null>(() => resolveUserRole(ctx))
  const [telusKey, setTelusKey] = useState('')
  const [telusValue, setTelusValue] = useState('')
  const [pmsInfo, setPmsInfo] = useState<PracticePmsInfo | null>(null)
  const [pmsCatalog, setPmsCatalog] = useState<PmsVendorCatalogEntry[]>([])

  const isReadOnly = resolveIsReadOnly(ctx, userRole)

  useEffect(() => {
    const derived = resolveUserRole(ctx)
    if (derived) setUserRole(derived)
    else {
      void apiFetchJson<{ userRole?: UserRole }>('/api/auth/me').then((d) => setUserRole(d.userRole ?? null))
    }
  }, [ctx.isPlatformDev, ctx.isFrontDesk, ctx.deskRole])

  const load = useCallback(async () => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetchJson<SettingsResponse>(`/api/practices/${practiceId}/settings`)
      setSettings(res.data.settings)
      setPmsInfo(res.data.pms ?? null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [practiceId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void apiFetchJson<{ vendors: PmsVendorCatalogEntry[] }>('/api/pms/catalog')
      .then((d) => setPmsCatalog(d.vendors ?? []))
      .catch(() => setPmsCatalog([]))
  }, [])

  async function save(partial: Partial<PracticeSettings>) {
    if (!practiceId || isReadOnly) return
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      const res = await apiFetchJson<{ success: boolean; data: PracticeSettings }>(
        `/api/practices/${practiceId}/settings`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(partial) },
      )
      setSettings(res.data)
      setMessage('Settings saved')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function updateCarrier(idx: number, patch: Partial<CarrierConfig>) {
    if (!settings) return
    const carrierConfigs = settings.carrierConfigs.map((c, i) => (i === idx ? { ...c, ...patch } : c))
    setSettings({ ...settings, carrierConfigs })
  }

  function addTelusMapping() {
    if (!settings || !telusKey.trim()) return
    const telusTpaMappings = { ...settings.telusTpaMappings, [telusKey.trim()]: telusValue.trim() }
    setSettings({ ...settings, telusTpaMappings })
    setTelusKey('')
    setTelusValue('')
  }

  function removeTelusMapping(key: string) {
    if (!settings) return
    const telusTpaMappings = { ...settings.telusTpaMappings }
    delete telusTpaMappings[key]
    setSettings({ ...settings, telusTpaMappings })
  }

  const busy = practiceLoading || (loading && !settings)

  return (
    <DataState loading={busy} error={error} isEmpty={!busy && !settings} emptyTitle="No settings">
      {settings && (
        <div className="page-enter p-6 space-y-6 max-w-[1400px]">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Practice Settings</h1>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
                Voice agent, call window, and carrier configuration
              </p>
            </div>
            {!isReadOnly && (
              <Button
                variant="primary"
                size="sm"
                disabled={saving}
                onClick={() => void save(settings)}
              >
                {saving ? 'Saving…' : 'Save all'}
              </Button>
            )}
          </div>

          {message && <p className="text-xs text-crx-600 dark:text-crx-400" role="status">{message}</p>}
          {isReadOnly && (
            <p className="text-xs text-amber-600 dark:text-amber-400">Read-only view, changes are disabled.</p>
          )}

          <Card>
            <CardHeader
              title="Practice management system"
              subtitle="Controls how we read claim exports. Carrier call rules are the same for every PMS."
            />
            <div className="space-y-3 max-w-md">
              <Select
                label="PMS vendor"
                value={settings.pmsVendor ?? pmsInfo?.vendorId ?? 'abeldent'}
                disabled={isReadOnly}
                onChange={(e) =>
                  setSettings({ ...settings, pmsVendor: e.target.value as PmsVendorId })
                }
              >
                {(pmsCatalog.length > 0
                  ? pmsCatalog
                  : [{ id: 'abeldent' as PmsVendorId, displayName: 'AbelDent' }]
                ).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.displayName}
                  </option>
                ))}
              </Select>
              {pmsInfo?.inferredFromLastImport && !settings.pmsVendor && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Inferred from your latest import ({pmsInfo.displayName}). Save to lock this in.
                </p>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Phone decisions use profile <code className="text-2xs">{pmsInfo?.phoneDecisionProfile ?? 'carrier_recovery_v1'}</code>
                {' '}(not PMS-specific logic).
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Voice agent" subtitle="Automation toggles" />
            <div className="space-y-3">
              {(
                [
                  ['voiceAgentEnabled', 'Voice agent enabled'],
                  ['automationEnabled', 'Automation enabled'],
                  ['emailsEnabled', 'Emails enabled'],
                  ['sendFromPracticeEmail', 'Send from practice email'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={settings[key]}
                    disabled={isReadOnly}
                    onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}
                    className="rounded border-gray-300 text-crx-600 focus:ring-crx-500"
                  />
                  {label}
                </label>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Call window" subtitle="Practice-wide calling hours (ET)" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input
                label="Start"
                value={settings.callWindowStart}
                disabled={isReadOnly}
                onChange={(e) => setSettings({ ...settings, callWindowStart: e.target.value })}
              />
              <Input
                label="End"
                value={settings.callWindowEnd}
                disabled={isReadOnly}
                onChange={(e) => setSettings({ ...settings, callWindowEnd: e.target.value })}
              />
              <Input
                label="Escalation phone (E.164)"
                value={settings.escalationPhoneNumber}
                disabled={isReadOnly}
                onChange={(e) => setSettings({ ...settings, escalationPhoneNumber: e.target.value })}
              />
            </div>
          </Card>

          <Card padding="none">
            <div className="p-5 pb-0">
              <CardHeader title="Carrier configuration" />
            </div>
            <TableContainer className="border-0 shadow-none rounded-none">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Carrier</Th>
                    <Th align="center">Enabled</Th>
                    <Th align="right">Min age (days)</Th>
                    <Th align="right">Max attempts</Th>
                    <Th>Window</Th>
                    <Th>Notes</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {settings.carrierConfigs.map((c, idx) => (
                    <Tr key={c.carrierId}>
                      <Td bold>{c.carrierId.replace(/_/g, ' ')}</Td>
                      <Td align="center">
                        <input
                          type="checkbox"
                          checked={c.enabled}
                          disabled={isReadOnly}
                          onChange={(e) => updateCarrier(idx, { enabled: e.target.checked })}
                        />
                      </Td>
                      <Td align="right">
                        <input
                          type="number"
                          className="w-16 text-right text-sm border rounded px-2 py-1 dark:bg-gray-800 dark:border-gray-600"
                          value={c.minimumClaimAgeDays}
                          disabled={isReadOnly}
                          onChange={(e) => updateCarrier(idx, { minimumClaimAgeDays: Number(e.target.value) })}
                        />
                      </Td>
                      <Td align="right">
                        <input
                          type="number"
                          className="w-16 text-right text-sm border rounded px-2 py-1 dark:bg-gray-800 dark:border-gray-600"
                          value={c.maxAttempts}
                          disabled={isReadOnly}
                          onChange={(e) => updateCarrier(idx, { maxAttempts: Number(e.target.value) })}
                        />
                      </Td>
                      <Td>
                        <span className="text-xs text-gray-500">
                          {c.callWindowStart} – {c.callWindowEnd}
                        </span>
                      </Td>
                      <Td>
                        <input
                          type="text"
                          className="w-full text-sm border rounded px-2 py-1 dark:bg-gray-800 dark:border-gray-600"
                          value={c.notes}
                          disabled={isReadOnly}
                          onChange={(e) => updateCarrier(idx, { notes: e.target.value })}
                        />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </TableContainer>
          </Card>

          <Card>
            <CardHeader title="TELUS TPA mappings" subtitle="Third-party administrator codes" />
            <div className="space-y-3">
              {Object.entries(settings.telusTpaMappings).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-gray-700 dark:text-gray-300">{k}</span>
                  <span className="text-gray-400">→</span>
                  <span className="text-gray-600 dark:text-gray-400">{v}</span>
                  {!isReadOnly && (
                    <Button variant="ghost" size="sm" onClick={() => removeTelusMapping(k)}>
                      Remove
                    </Button>
                  )}
                </div>
              ))}
              {!isReadOnly && (
                <div className="flex flex-wrap items-end gap-2 pt-2">
                  <Input label="TPA code" value={telusKey} onChange={(e) => setTelusKey(e.target.value)} />
                  <Input label="Mapping" value={telusValue} onChange={(e) => setTelusValue(e.target.value)} />
                  <Button variant="secondary" size="sm" onClick={addTelusMapping}>
                    Add mapping
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </DataState>
  )
}
