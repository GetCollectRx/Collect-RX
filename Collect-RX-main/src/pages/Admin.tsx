import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { apiFetch } from '../lib/apiFetch'
import { parseApiJson } from '../lib/parseApiJson'
import {
  Card, CardHeader, Button, Input, Badge, InlineToast, useToast,
} from '../components/ui'
import { OnboardingProgress, type SetupStatus } from '../components/OnboardingProgress'

const CARRIER_ROWS = [
  { id: 'sun_life',         name: 'Sun Life Financial' },
  { id: 'canada_life',      name: 'Canada Life' },
  { id: 'manulife',         name: 'Manulife' },
  { id: 'green_shield',     name: 'Green Shield Canada' },
  { id: 'rbc_insurance',    name: 'RBC Insurance' },
  { id: 'telus_adjudicare', name: 'TELUS AdjudiCare' },
] as const

type CarrierFlags = { active: boolean; block: boolean }
const defaultFlags = (): Record<string, CarrierFlags> => {
  const o: Record<string, CarrierFlags> = {}
  for (const c of CARRIER_ROWS) o[c.id] = { active: true, block: false }
  return o
}

type IntegrationsPayload = {
  sendgrid: { apiKey: boolean; fromEmail: boolean; eventWebhookVerifyKey: boolean }
  twilio: { apiAndFrom: boolean; inboundUrlForSignature: boolean }
  escalation: { staffPhone: boolean; immediateStaffNotify: boolean; voiceRing: string }
  stripe: { secretKey: boolean; testMode: boolean }
  vapi: { webhookSecret: boolean }
  email: { unsubscribeHmac: boolean; publicApiBase: string }
}

type AuditEntry = {
  id: string
  createdAt: string
  action: string
  subjectType: string | null
  subjectId: string | null
  details: unknown
  requestIp: string | null
}

export default function Admin() {
  const { practiceId } = usePractice()
  const [savingCarriers, setSavingCarriers] = useState(false)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [carriers, setCarriers] = useState<Record<string, CarrierFlags>>(defaultFlags)
  const [integrations, setIntegrations] = useState<IntegrationsPayload | null>(null)
  const [integrationsLoading, setIntegrationsLoading] = useState(true)
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(true)
  const [engineRunning, setEngineRunning] = useState<boolean | null>(null)
  const [auditTick, setAuditTick] = useState(0)
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null)
  const { toast, showToast }            = useToast()

  // ── Practice Identity (direct Practice model fields, not settings JSON) ──────
  const [identity, setIdentity] = useState({
    billingPhone: '',
    faxNumber: '',
    practiceAddress: '',
    npi: '',
    taxId: '',
  })
  const [identityLoading, setIdentityLoading] = useState(true)
  const [identitySaving, setIdentitySaving] = useState(false)

  useEffect(() => {
    if (!practiceId) { setIdentityLoading(false); return }
    setIdentityLoading(true)
    apiFetch('/api/admin/practice-identity')
      .then(async (r) =>
        r.ok
          ? parseApiJson<typeof identity>(r)
          : { billingPhone: '', faxNumber: '', practiceAddress: '', npi: '', taxId: '' },
      )
      .then((d) => setIdentity(d))
      .catch(() => showToast('err', 'Could not load practice identity'))
      .finally(() => setIdentityLoading(false))
  }, [practiceId])

  const saveIdentity = async () => {
    if (!practiceId) return
    setIdentitySaving(true)
    try {
      const res = await apiFetch('/api/admin/practice-identity', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(identity),
      })
      const data = await parseApiJson<{ ok?: boolean; error?: string }>(res)
      if (res.ok) showToast('ok', 'Practice identity saved.')
      else showToast('err', data.error || 'Save failed')
    } catch {
      showToast('err', 'Save failed')
    } finally {
      setIdentitySaving(false)
    }
  }

  useEffect(() => {
    if (!practiceId) { setSettingsLoading(false); return }
    setSettingsLoading(true)
    apiFetch('/api/admin/settings')
      .then(async (r) =>
        r.ok ? parseApiJson<{ settings?: { carriers?: Record<string, CarrierFlags> } | null }>(r) : { settings: null },
      )
      .then((d) => {
        if (d.settings?.carriers) {
          setCarriers((prev) => {
            const next = { ...prev }
            for (const [k, v] of Object.entries(d.settings!.carriers!)) {
              if (v && typeof v === 'object') {
                next[k] = { active: !!v.active, block: !!v.block }
              }
            }
            return next
          })
        } else {
          setCarriers(defaultFlags())
        }
      })
      .catch(() => {
        showToast('err', 'Could not load carrier settings — showing defaults, not saved values')
        setCarriers(defaultFlags())
      })
      .finally(() => setSettingsLoading(false))
  }, [practiceId])

  useEffect(() => {
    if (!practiceId) { setEngineRunning(null); return }
    apiFetch(`/api/practices/${practiceId}/reports/queue`)
      .then(async (r) => (r.ok ? parseApiJson<{ success: boolean; data: { isPaused: boolean } }>(r) : null))
      .then((d) => setEngineRunning(d ? !d.data.isPaused : null))
      .catch(() => {
        showToast('err', 'Could not load recovery engine status')
        setEngineRunning(null)
      })
  }, [practiceId])

  useEffect(() => {
    if (!practiceId) { setSetupStatus(null); return }
    apiFetch('/api/dashboard/setup-status')
      .then(async (r) => (r.ok ? parseApiJson<{ success: boolean; data: SetupStatus | null }>(r) : null))
      .then((d) => setSetupStatus(d?.data ?? null))
      .catch(() => setSetupStatus(null))
  }, [practiceId])

  useEffect(() => {
    if (!practiceId) {
      setIntegrationsLoading(false)
      return
    }
    setIntegrationsLoading(true)
    apiFetch('/api/admin/integrations')
      .then(async (r) => (r.ok ? parseApiJson<IntegrationsPayload>(r) : null))
      .then((d) => setIntegrations(d))
      .catch(() => {
        showToast('err', 'Could not load integration status')
        setIntegrations(null)
      })
      .finally(() => setIntegrationsLoading(false))
  }, [practiceId])

  useEffect(() => {
    if (!practiceId) {
      setAuditLoading(false)
      return
    }
    setAuditLoading(true)
    apiFetch('/api/admin/audit-log?limit=30')
      .then(async (r) => (r.ok ? parseApiJson<{ entries?: AuditEntry[] }>(r) : { entries: [] }))
      .then((d) => setAuditEntries(d.entries ?? []))
      .catch(() => setAuditEntries([]))
      .finally(() => setAuditLoading(false))
  }, [practiceId, auditTick])

  const refreshAudit = () => setAuditTick((n) => n + 1)

  const saveCarrierSettings = async () => {
    if (!practiceId) return
    setSavingCarriers(true)
    try {
      const res = await apiFetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { carriers } }),
      })
      const data = await parseApiJson(res)
      if (res.ok) showToast('ok', 'Carrier preferences saved for this practice.')
      else         showToast('err', (data as { error?: string }).error || 'Save failed')
    } catch {
      showToast('err', 'Save failed')
    } finally {
      setSavingCarriers(false)
    }
  }

  return (
    <div className="page-enter p-6 space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Admin</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Practice settings, carrier configuration, and test data tools.{' '}
          <Link to="/import" className="text-crx-600 hover:underline">Import CSV →</Link>
          {' · '}
          <Link to="/admin/sync" className="text-crx-600 hover:underline">PMS sync ops →</Link>
        </p>
      </div>

      {toast && <InlineToast toast={toast} />}

      <OnboardingProgress status={setupStatus} />

      {/* Practice Identity — fields read by the voice agent during carrier calls */}
      <Card>
        <CardHeader
          title="Practice Identity"
          subtitle="Used by the voice agent during carrier calls for identity verification. All fields are non-PHI."
        />
        {identityLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Billing phone (E.164)"
                placeholder="+16135550100"
                value={identity.billingPhone}
                onChange={(e) => setIdentity((prev) => ({ ...prev, billingPhone: e.target.value }))}
                hint="CRTC disclosure number — read aloud at call start. Distinct from escalation line."
              />
              <Input
                label="Fax number (E.164)"
                placeholder="+16135550101"
                value={identity.faxNumber}
                onChange={(e) => setIdentity((prev) => ({ ...prev, faxNumber: e.target.value }))}
                hint="Required by some carriers for appeal / documentation submissions."
              />
            </div>
            <Input
              label="Practice address"
              placeholder="123 Main St, Ottawa ON K1A 0A1"
              value={identity.practiceAddress}
              onChange={(e) => setIdentity((prev) => ({ ...prev, practiceAddress: e.target.value }))}
              hint="Carriers may ask for this during identity verification. Max 200 characters."
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="NPI / billing number"
                placeholder="123456789"
                value={identity.npi}
                onChange={(e) => setIdentity((prev) => ({ ...prev, npi: e.target.value }))}
                hint="Provincial college registration / billing number (Canadian NPI equivalent)."
              />
              <Input
                label="Tax ID (HST/GST)"
                placeholder="123456789RT0001"
                value={identity.taxId}
                onChange={(e) => setIdentity((prev) => ({ ...prev, taxId: e.target.value }))}
                hint="HST/GST business registration number — some carriers require for payment processing."
              />
            </div>
            <div className="pt-1">
              <Button
                variant="primary"
                size="sm"
                onClick={saveIdentity}
                disabled={!practiceId || identitySaving}
                loading={identitySaving}
              >
                Save identity
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* P4, go-live integration health (no secrets shown) */}
      <Card>
        <CardHeader
          title="Integrations (go-live)"
          subtitle="Confirms env for this practice. Set keys in your host (e.g. fly secrets), not in git. Stripe Billing is the practice SaaS subscription only."
        />
        {integrationsLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : integrations ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-gray-100 dark:border-gray-700 p-3 space-y-1.5">
              <p className="font-medium text-gray-800 dark:text-gray-200">SendGrid (P4-01)</p>
              <ul className="text-gray-600 dark:text-gray-300 list-disc list-inside space-y-0.5">
                <li>API key: {integrations.sendgrid.apiKey ? 'set' : 'missing'}</li>
                <li>From email: {integrations.sendgrid.fromEmail ? 'set' : 'missing'}</li>
                <li>Event Webhook verify key: {integrations.sendgrid.eventWebhookVerifyKey ? 'set' : 'missing (set for production)'}</li>
              </ul>
            </div>
            <div className="rounded-lg border border-gray-100 dark:border-gray-700 p-3 space-y-1.5">
              <p className="font-medium text-gray-800 dark:text-gray-200">Twilio (P4-03)</p>
              <ul className="text-gray-600 dark:text-gray-300 list-disc list-inside space-y-0.5">
                <li>Account + from number: {integrations.twilio.apiAndFrom ? 'set' : 'missing'}</li>
                <li>Inbound webhook URL (signature): {integrations.twilio.inboundUrlForSignature ? 'set' : 'missing'}</li>
              </ul>
            </div>
            <div className="rounded-lg border border-gray-100 dark:border-gray-700 p-3 space-y-1.5">
              <p className="font-medium text-gray-800 dark:text-gray-200">Front-desk escalation (SMS + optional call)</p>
              <ul className="text-gray-600 dark:text-gray-300 list-disc list-inside space-y-0.5">
                <li className={integrations.escalation.immediateStaffNotify ? 'text-crx-700 dark:text-crx-400' : ''}>
                  Instant notify (Twilio + ESCALATION_STAFF_PHONE):{' '}
                  {integrations.escalation.immediateStaffNotify ? 'ready' : 'not configured'}
                </li>
                <li>
                  Staff number(s) in env: {integrations.escalation.staffPhone ? 'set' : 'missing, add ESCALATION_STAFF_PHONE'}
                </li>
                <li>
                  Voice ring mode: <code className="text-xs">{integrations.escalation.voiceRing}</code> (urgent | all |
                  never). Rings the desk line on urgent escalations by default.
                </li>
              </ul>
            </div>
            <div className="rounded-lg border border-gray-100 dark:border-gray-700 p-3 space-y-1.5">
              <p className="font-medium text-gray-800 dark:text-gray-200">Stripe Billing (practice plan)</p>
              <ul className="text-gray-600 dark:text-gray-300 list-disc list-inside space-y-0.5">
                <li>Secret key: {integrations.stripe.secretKey ? 'set' : 'missing'}</li>
                <li>Mode: {integrations.stripe.testMode ? 'test (sk_test_…)' : integrations.stripe.secretKey ? 'live' : 'N/A'}</li>
              </ul>
            </div>
            <div className="rounded-lg border border-gray-100 dark:border-gray-700 p-3 space-y-1.5">
              <p className="font-medium text-gray-800 dark:text-gray-200">Vapi (P4-05)</p>
              <p className="text-gray-600 dark:text-gray-300">Webhook secret: {integrations.vapi.webhookSecret ? 'set' : 'missing'}</p>
            </div>
            <div className="rounded-lg border border-gray-100 dark:border-gray-700 p-3 space-y-1.5">
              <p className="font-medium text-gray-800 dark:text-gray-200">Email unsubscribe (P4-02)</p>
              <p className="text-gray-600 dark:text-gray-300">
                HMAC secret: {integrations.email.unsubscribeHmac ? 'set' : 'missing'}
              </p>
              <p className="text-xs text-gray-500 break-all">Public API base for links: {integrations.email.publicApiBase}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-red-600">Could not load integration status.</p>
        )}
      </Card>

      <Card>
        <CardHeader
          title="What your team sees when something fails"
          subtitle="Share this with the front desk: not engineering jargon."
        />
        <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-3 list-disc list-inside">
          <li>
            <strong className="text-gray-800 dark:text-gray-200">Stripe / plan billing:</strong> Staff see checkout or
            portal errors for the practice SaaS subscription. Check the Stripe Billing rows above.
          </li>
          <li>
            <strong className="text-gray-800 dark:text-gray-200">Sync / stale claims:</strong> The{' '}
            <Link to="/" className="text-crx-600 dark:text-crx-400 underline">Dashboard</Link> PMS banner shows your
            last import time; tray icon errors mean claim data may not match your PMS — note the message and contact support.
          </li>
          <li>
            <strong className="text-gray-800 dark:text-gray-200">Carrier block:</strong> The{' '}
            <Link to="/" className="text-crx-600 dark:text-crx-400 underline">Dashboard</Link> shows a banner naming
            carriers on hold; calls to those insurers stop until support reviews. Full wording:{' '}
            <Link to="/guide" className="text-crx-600 dark:text-crx-400 underline">How it works</Link>.
          </li>
          <li>
            <strong className="text-gray-800 dark:text-gray-200">AI escalations:</strong> When the system needs the
            office (blocked carrier, missing x-rays, stuck calls, etc.), configured staff numbers get an SMS immediately,
            and urgent cases can also trigger a short voice call to the desk line so nothing waits on Slack alone.
          </li>
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="Audit log (P5-04)"
          subtitle="Recent staff-originated changes; append-only. Does not log every data read. See docs/compliance/DATA-CLASSIFICATION.md."
        />
        <div className="flex justify-end mb-2">
          <Button type="button" variant="secondary" size="sm" onClick={refreshAudit} disabled={!practiceId || auditLoading}>
            Refresh
          </Button>
        </div>
        {auditLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : auditEntries.length === 0 ? (
          <p className="text-sm text-gray-500">No entries yet.</p>
        ) : (
          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-600 text-gray-500">
                  <th className="py-1.5 pr-2">Time (UTC)</th>
                  <th className="py-1.5 pr-2">Action</th>
                  <th className="py-1.5 pr-2">Subject</th>
                  <th className="py-1.5">Details</th>
                </tr>
              </thead>
              <tbody>
                {auditEntries.map((row) => (
                  <tr key={row.id} className="border-b border-gray-50 dark:border-gray-800/80">
                    <td className="py-1.5 pr-2 align-top text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {new Date(row.createdAt).toISOString().replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="py-1.5 pr-2 align-top font-mono text-crx-700 dark:text-crx-400">{row.action}</td>
                    <td className="py-1.5 pr-2 align-top text-gray-600 dark:text-gray-300">
                      {row.subjectType && row.subjectId ? `${row.subjectType} ${row.subjectId.slice(0, 8)}…` : 'N/A'}
                    </td>
                    <td className="py-1.5 align-top text-gray-500 max-w-xs truncate" title={JSON.stringify(row.details ?? {})}>
                      {row.details != null ? JSON.stringify(row.details) : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Insurance recovery engine status */}
      <Card>
        <CardHeader title="Insurance recovery engine" subtitle="Call queue, payment trace, and work-queue sync every 60 seconds" />
        <div className="flex items-center gap-2 mb-4">
          <span
            className={`w-2 h-2 rounded-full ${engineRunning ? 'bg-crx-500 animate-pulse' : engineRunning === false ? 'bg-amber-500' : 'bg-gray-400'}`}
            aria-hidden="true"
          />
          <span className={`text-sm font-medium ${engineRunning ? 'text-crx-600 dark:text-crx-400' : engineRunning === false ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}>
            {engineRunning === null ? 'Status unavailable' : engineRunning ? 'Running' : 'Paused'}
          </span>
        </div>

        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-sm text-gray-700 dark:text-gray-300 space-y-2">
          <p className="font-semibold text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Active loops</p>
          {[
            'Priority sync — ranks open claims for the next carrier call batch',
            'Payment trace — recalls carriers when approved claims await PMS balance drop',
            'Practice gates — blocks re-call until resubmit, docs, or verify is cleared',
            'Work queue — mirrors open insurance claims by dollars at risk and aging',
          ].map((rule) => (
            <div key={rule} className="flex items-start gap-2">
              <span className="text-crx-500 flex-shrink-0 mt-0.5">→</span>
              <span>{rule}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Carrier configuration */}
      <Card>
        <CardHeader title="Carrier Configuration" subtitle="Per-practice display preferences (call order uses Queue settings)" />
        {settingsLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
        <div className="space-y-3">
          {CARRIER_ROWS.map(c => {
            const f = carriers[c.id] || { active: true, block: false }
            return (
            <div
              key={c.id}
              className="flex items-center justify-between py-2.5 border-b border-gray-50 dark:border-gray-700/50 last:border-0"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{c.name}</span>
                {f.block && <Badge color="red" dot>Blocked</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-xs text-crx-600 dark:text-crx-400 font-medium"
                  onClick={() => setCarriers(prev => ({ ...prev, [c.id]: { ...f, active: !f.active } }))}
                >
                  {f.active ? 'Active' : 'Paused'}
                </button>
                <button
                  type="button"
                  className="text-xs text-gray-500 hover:text-red-500"
                  onClick={() => setCarriers(prev => ({ ...prev, [c.id]: { ...f, block: !f.block } }))}
                >
                  {f.block ? 'Unblock' : 'Block'}
                </button>
              </div>
            </div>
          )})}
        </div>
        )}
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
          Call windows: Mon–Fri 8am–5pm Eastern. Max 3 attempts per claim.
        </p>
        <div className="mt-4">
          <Button variant="primary" size="sm" onClick={saveCarrierSettings} disabled={!practiceId || savingCarriers} loading={savingCarriers}>
            Save carrier settings
          </Button>
        </div>
      </Card>

      {/* Go-live checklist (derived from integration status + docs) */}
      <Card>
        <CardHeader
          title="Go-live checklist"
          subtitle="Use with docs/operations/PHASE4-GO-LIVE.md. PMS/connector scope: docs/product/PMS-INTEGRATION-PLAN.md (program decision)."
        />
        <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
          {integrations && (
            <ul className="list-disc list-inside space-y-1">
              <li className={integrations.sendgrid.apiKey && integrations.sendgrid.fromEmail ? 'text-crx-700 dark:text-crx-400' : ''}>
                SendGrid: API key + from address; Event Webhook → /api/webhooks/sendgrid with verify key
              </li>
              <li className={integrations.twilio.apiAndFrom && integrations.twilio.inboundUrlForSignature ? 'text-crx-700 dark:text-crx-400' : ''}>
                Twilio: credentials + TWILIO_SMS_INBOUND_URL matches public URL (signature)
              </li>
              <li
                className={
                  integrations.escalation.immediateStaffNotify ? 'text-crx-700 dark:text-crx-400' : ''
                }
              >
                Escalations: set ESCALATION_STAFF_PHONE (front desk, E.164) so Twilio SMS + optional voice fire before
                Slack; see .env.example
              </li>
              <li className={integrations.stripe.secretKey && !integrations.stripe.testMode ? 'text-crx-700 dark:text-crx-400' : ''}>
                Stripe Billing live: sk_live_… for practice SaaS subscription (use test mode until ready)
              </li>
              <li className={integrations.vapi.webhookSecret ? 'text-crx-700 dark:text-crx-400' : ''}>
                Vapi: webhook secret + URL /api/webhooks/vapi
              </li>
              <li>DNS: SPF/DKIM/DMARC for your from-domain (SendGrid)</li>
              <li>Secrets: host variables only; rotation runbook in docs/operations/SECRETS-GO-LIVE.md</li>
            </ul>
          )}
          {!integrations && !integrationsLoading && <p>Load failed, refresh the page.</p>}
        </div>
      </Card>
    </div>
  )
}
