import { useCallback, useEffect, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { apiFetch } from '../lib/apiFetch'
import {
  Card,
  CardHeader,
  Button,
  Input,
  DataState,
  StatTile,
  useToast,
  InlineToast,
  TableContainer,
  Table,
  Thead,
  Tbody,
  Th,
  Tr,
  Td,
  TableEmpty,
} from '../components/ui'

type ReconsiderationRow = {
  id: string
  claimRef: string
  patientToken: string
  procedureCode: string | null
  denialDate: string
  status: string
  exclusionReason: string | null
  daysRemaining: number
  windowExpired: boolean
  reconsiderationExpiresAt: string
}

type DimensionStatus = 'ok' | 'watch' | 'risk'
type DimensionMetric = {
  id: number
  key: string
  name: string
  value: number | null
  unit: 'pct' | 'count' | 'cad' | 'days'
  status: DimensionStatus
  detail: string
}

type ItransStatus = {
  readiness: string
  itrans2Live: boolean
  daysUntilItrans1Retires: number
  retirementDate: string
  config: Record<string, boolean>
  nextAction: string
}

type Phase2Analytics = {
  reconsiderationCasesTotal: number
  reconsiderationPipelineActive: number
  reconsiderationWindowAttention: number
  pmsWritebacksLast7Days: number
  pmsWritebacksPending: number
  itrans2: ItransStatus
  eightDimensions: DimensionMetric[]
  eightDimensionLabels: Array<{ id: number; name: string }>
}

type WritebackEntry = {
  id: string
  source: string
  claimRef: string
  abeldentPatientId: string | null
  payload: unknown
  processedAt: string | null
  processError: string | null
  createdAt: string
}

const STATUS_COLORS: Record<DimensionStatus, string> = {
  ok: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300',
  watch: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
  risk: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300',
}

function formatDimensionValue(d: DimensionMetric): string {
  if (d.value == null) return 'N/A'
  if (d.unit === 'pct') return `${d.value}%`
  if (d.unit === 'cad') return `CA$${d.value.toLocaleString('en-CA')}`
  if (d.unit === 'days') return `${d.value}d`
  return String(d.value)
}

const PROVINCES = [
  { value: 'ON', label: 'Ontario' },
  { value: 'BC', label: 'British Columbia' },
  { value: 'AB', label: 'Alberta' },
] as const

export default function CanadianExpansion() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const { toast, showToast } = useToast()

  const [metrics, setMetrics] = useState<Phase2Analytics | null>(null)
  const [cases, setCases] = useState<ReconsiderationRow[]>([])
  const [writebacks, setWritebacks] = useState<WritebackEntry[]>([])
  const [compliance, setCompliance] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [form, setForm] = useState({
    patientToken: '',
    claimRef: '',
    procedureCode: '',
    denialDate: '',
    clinicalNotes: '',
  })

  const [gapProvince, setGapProvince] = useState<'ON' | 'BC' | 'AB'>('ON')
  const [gapRows, setGapRows] = useState([{ cdt_code: 'D0120', office_fee_cad: '46' }])
  const [gapResult, setGapResult] = useState<Record<string, unknown> | null>(null)

  const [wbForm, setWbForm] = useState({
    source: 'resolution_closer' as 'resolution_closer' | 'escalation_closer',
    claimRef: '',
    abeldentPatientId: '',
    payloadJson: '{"paymentRef":"CHQ-0000","pmsStatus":"paid"}',
  })

  const refresh = useCallback(async () => {
    if (!practiceId) return
    setBusy(true)
    setErr(null)
    try {
      const [m, c, w, d] = await Promise.all([
        apiFetch('/api/analytics/canadian-phase2'),
        apiFetch('/api/canadian/cdcp/reconsiderations'),
        apiFetch('/api/canadian/pms/writeback-log?limit=15'),
        apiFetch('/api/canadian/compliance/disclosures'),
      ])
      for (const r of [m, c, w, d]) {
        if (!r.ok) {
          const b = await r.json().catch(() => ({}))
          throw new Error((b as { error?: string }).error || 'Request failed')
        }
      }
      const [mj, cj, wj, dj] = await Promise.all([m.json(), c.json(), w.json(), d.json()])
      setMetrics(mj)
      setCases((cj.cases || []) as ReconsiderationRow[])
      setWritebacks((wj.entries || []) as WritebackEntry[])
      setCompliance(dj)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [practiceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const submitReconsideration = async () => {
    try {
      const res = await apiFetch('/api/canadian/cdcp/reconsiderations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_token: form.patientToken.trim(),
          claim_ref: form.claimRef.trim(),
          procedure_code: form.procedureCode.trim() || undefined,
          denial_date: form.denialDate || undefined,
          clinical_evidence_summary: form.clinicalNotes.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Save failed')
      showToast('ok', 'Reconsideration case saved.')
      setForm((f) => ({ ...f, claimRef: '', clinicalNotes: '' }))
      void refresh()
    } catch (e) {
      showToast('err', (e as Error).message)
    }
  }

  const submitGap = async () => {
    try {
      const procedures = gapRows
        .filter((r) => r.cdt_code.trim())
        .map((r) => ({
          cdt_code: r.cdt_code.trim(),
          office_fee_cad: parseFloat(r.office_fee_cad) || 0,
        }))
      const res = await apiFetch('/api/canadian/gap-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ province: gapProvince, procedures }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Gap estimate failed')
      setGapResult(data as Record<string, unknown>)
      showToast('ok', 'Gap estimate calculated.')
    } catch (e) {
      showToast('err', (e as Error).message)
    }
  }

  const submitWriteback = async () => {
    try {
      let payload: Record<string, unknown> = {}
      try {
        payload = JSON.parse(wbForm.payloadJson) as Record<string, unknown>
      } catch {
        throw new Error('Payload must be valid JSON')
      }
      const res = await apiFetch('/api/canadian/pms/writeback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: wbForm.source,
          claim_ref: wbForm.claimRef.trim(),
          abeldent_patient_id: wbForm.abeldentPatientId.trim() || undefined,
          payload,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Write-back failed')
      showToast('ok', 'Write-back logged for PMS reconciliation.')
      void refresh()
    } catch (e) {
      showToast('err', (e as Error).message)
    }
  }

  const dataBusy = practiceLoading || busy

  return (
    <DataState loading={dataBusy} error={err} isEmpty={false}>
      <div className="page-enter p-6 space-y-6 max-w-[1200px]">
        <InlineToast toast={toast} />
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            Canadian expansion (2026)
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            CDCP reconsideration window, precision gap estimates, Quebec readiness disclosures, and PMS write-back
            coordination, CollectRx Phase 2 roadmap modules MOD-01–MOD-05.
          </p>
        </div>

        {metrics && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatTile
              label="CDCP reconsiderations"
              value={String(metrics.reconsiderationCasesTotal)}
              sub="total cases tracked"
              icon="📋"
              accent="green"
            />
            <StatTile
              label="Active pipeline"
              value={String(metrics.reconsiderationPipelineActive)}
              sub="open / submitted"
              icon="⏳"
              accent="green"
            />
            <StatTile
              label="60-day attention"
              value={String(metrics.reconsiderationWindowAttention)}
              sub="recent denials"
              icon="⏱"
              accent="amber"
            />
            <StatTile
              label="Write-backs (7d)"
              value={String(metrics.pmsWritebacksLast7Days)}
              sub="logged for AbelDent sync"
              icon="🔁"
              accent="green"
            />
          </div>
        )}

        <Card>
          <CardHeader title="MOD-01: CDCP reconsideration (60-day window)" subtitle="Track denied pre-auths; exclusions mirror Appendix E–style categories." />
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label="Patient token"
                value={form.patientToken}
                onChange={(e) => setForm((f) => ({ ...f, patientToken: e.target.value }))}
              />
              <Input
                label="Claim / predetermination ref"
                value={form.claimRef}
                onChange={(e) => setForm((f) => ({ ...f, claimRef: e.target.value }))}
              />
              <Input
                label="Procedure code (CDT)"
                value={form.procedureCode}
                onChange={(e) => setForm((f) => ({ ...f, procedureCode: e.target.value }))}
              />
              <Input
                label="Denial date"
                type="date"
                value={form.denialDate}
                onChange={(e) => setForm((f) => ({ ...f, denialDate: e.target.value }))}
              />
            </div>
            <Input
              label="Clinical evidence summary (non-PHI shorthand)"
              value={form.clinicalNotes}
              onChange={(e) => setForm((f) => ({ ...f, clinicalNotes: e.target.value }))}
            />
            <Button type="button" variant="primary" onClick={() => void submitReconsideration()}>
              Save case
            </Button>

            <TableContainer>
              <Table>
                <Thead>
                  <Tr>
                    <Th>Claim</Th>
                    <Th>Proc</Th>
                    <Th>Status</Th>
                    <Th>Days left</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {cases.map((row) => (
                    <Tr key={row.id}>
                      <Td className="font-mono text-xs">{row.claimRef}</Td>
                      <Td>{row.procedureCode ?? 'N/A'}</Td>
                      <Td>{row.status}</Td>
                      <Td>
                        {row.windowExpired ? (
                          <span className="text-red-600 dark:text-red-400">Expired</span>
                        ) : (
                          <span className="tabular-nums">{row.daysRemaining}d</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                  {cases.length === 0 && (
                    <TableEmpty
                      colSpan={4}
                      message="No cases yet, add a denied CDCP predetermination to start the countdown."
                    />
                  )}
                </Tbody>
              </Table>
            </TableContainer>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="MOD-03: 2026 precision gap estimator"
            subtitle="Office fee vs bundled CDCP schedule & provincial illustrative fees (expand JSON dataset for production)."
          />
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="min-w-[160px]">
                <label htmlFor="gap-province" className="block text-2xs font-semibold text-gray-500 uppercase mb-1">Province</label>
                <select
                  id="gap-province"
                  className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800"
                  value={gapProvince}
                  onChange={(e) => setGapProvince(e.target.value as 'ON' | 'BC' | 'AB')}
                >
                  {PROVINCES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="button" variant="secondary" onClick={() => setGapRows((r) => [...r, { cdt_code: '', office_fee_cad: '' }])}>
                Add procedure row
              </Button>
              <Button type="button" variant="primary" onClick={() => void submitGap()}>
                Calculate gap
              </Button>
            </div>
            {gapRows.map((row, i) => (
              <div key={i} className="flex flex-wrap gap-2 items-center">
                <Input
                  label={i === 0 ? 'CDT code' : ''}
                  className="max-w-[140px]"
                  value={row.cdt_code}
                  onChange={(e) => {
                    const next = [...gapRows]
                    next[i] = { ...next[i], cdt_code: e.target.value }
                    setGapRows(next)
                  }}
                />
                <Input
                  label={i === 0 ? 'Office fee (CAD)' : ''}
                  className="max-w-[140px]"
                  type="number"
                  step="0.01"
                  value={row.office_fee_cad}
                  onChange={(e) => {
                    const next = [...gapRows]
                    next[i] = { ...next[i], office_fee_cad: e.target.value }
                    setGapRows(next)
                  }}
                />
              </div>
            ))}
            {gapResult && (
              <pre className="text-xs bg-gray-50 dark:bg-gray-900/80 rounded-lg p-3 overflow-x-auto text-gray-800 dark:text-gray-200">
                {JSON.stringify(gapResult, null, 2)}
              </pre>
            )}
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader title="MOD-02: Compliance disclosures" subtitle="Law 25 / voluntary AI transparency blocks for carriers & Quebec readiness." />
            <div className="p-4 text-sm text-gray-700 dark:text-gray-300 space-y-3 max-h-[420px] overflow-y-auto">
              {compliance ? (
                <>
                  <p className="font-medium text-gray-900 dark:text-gray-100">
                    {(compliance.quebecLaw25 as { summary?: string })?.summary}
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    {((compliance.quebecLaw25 as { privacyByDesignBullets?: string[] })?.privacyByDesignBullets || []).map(
                      (b: string) => (
                        <li key={b}>{b}</li>
                      )
                    )}
                  </ul>
                  <p className="text-xs text-gray-500">
                    {(compliance.aiTransparency as { carrierDisclosureScript?: string })?.carrierDisclosureScript}
                  </p>
                </>
              ) : (
                <p className="text-gray-500">Loading…</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="MOD-04: PMS write-back log" subtitle="Cloud audit trail; execute SQL UPDATE on-prem via AbelDent connector." />
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 gap-2">
                <div>
                  <label htmlFor="wb-source" className="text-2xs font-semibold text-gray-500 uppercase">Source agent</label>
                  <select
                    id="wb-source"
                    className="mt-1 w-full text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                    value={wbForm.source}
                    onChange={(e) =>
                      setWbForm((f) => ({
                        ...f,
                        source: e.target.value as 'resolution_closer' | 'escalation_closer',
                      }))
                    }
                  >
                    <option value="resolution_closer">Resolution_Closer (payment confirmed)</option>
                    <option value="escalation_closer">Escalation_Closer (denial reason)</option>
                  </select>
                </div>
                <Input
                  label="Claim ref"
                  value={wbForm.claimRef}
                  onChange={(e) => setWbForm((f) => ({ ...f, claimRef: e.target.value }))}
                />
                <Input
                  label="AbelDent patient ID (optional)"
                  value={wbForm.abeldentPatientId}
                  onChange={(e) => setWbForm((f) => ({ ...f, abeldentPatientId: e.target.value }))}
                />
                <div>
                  <label htmlFor="wb-payload" className="text-2xs font-semibold text-gray-500 uppercase">Payload (JSON, non-PHI)</label>
                  <textarea
                    id="wb-payload"
                    className="mt-1 w-full text-xs font-mono border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 min-h-[88px]"
                    value={wbForm.payloadJson}
                    onChange={(e) => setWbForm((f) => ({ ...f, payloadJson: e.target.value }))}
                  />
                </div>
              </div>
              <Button type="button" variant="primary" onClick={() => void submitWriteback()}>
                Log write-back
              </Button>
              <TableContainer>
                <Table>
                  <Thead>
                    <Tr>
                      <Th>When</Th>
                      <Th>Source</Th>
                      <Th>Claim</Th>
                      <Th>State</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {writebacks.map((w) => {
                      const state = w.processError
                        ? { label: `error: ${w.processError.slice(0, 40)}`, cls: 'text-red-600' }
                        : w.processedAt
                        ? { label: 'applied to AbelDent', cls: 'text-green-600' }
                        : { label: 'pending desktop sync', cls: 'text-amber-600' }
                      return (
                        <Tr key={w.id}>
                          <Td className="text-xs whitespace-nowrap">
                            {new Date(w.createdAt).toLocaleString('en-CA')}
                          </Td>
                          <Td>{w.source}</Td>
                          <Td className="font-mono text-xs">{w.claimRef}</Td>
                          <Td>
                            <span className={`text-xs ${state.cls}`}>{state.label}</span>
                          </Td>
                        </Tr>
                      )
                    })}
                  </Tbody>
                </Table>
              </TableContainer>
            </div>
          </Card>
        </div>

        {metrics?.eightDimensions && metrics.eightDimensions.length > 0 && (
          <Card>
            <CardHeader
              title="8-dimension dashboard"
              subtitle="Live values from CDCP cases, write-backs, fee-guide imports, and patient-balance telemetry."
            />
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {metrics.eightDimensions.map((d) => (
                <div
                  key={d.id}
                  className="rounded-xl border border-gray-100 dark:border-gray-700 p-3 bg-white dark:bg-gray-800"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-2xs uppercase tracking-wide text-gray-500">
                      {d.id}. {d.name}
                    </span>
                    <span
                      className={`text-2xs px-2 py-0.5 rounded ${STATUS_COLORS[d.status]}`}
                    >
                      {d.status}
                    </span>
                  </div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                    {formatDimensionValue(d)}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {d.detail}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {metrics?.itrans2 && (
          <Card>
            <CardHeader
              title="ITRANS 2.0 readiness"
              subtitle="ITRANS 1 retires June 30, 2026, CDAnet traffic must move to ITRANS 2 endpoints."
            />
            <div className="p-4 space-y-2">
              <div className="flex flex-wrap gap-3 items-center">
                <span
                  className={`px-2 py-0.5 rounded text-xs font-semibold ${
                    metrics.itrans2.itrans2Live
                      ? STATUS_COLORS.ok
                      : metrics.itrans2.daysUntilItrans1Retires < 30
                      ? STATUS_COLORS.risk
                      : STATUS_COLORS.watch
                  }`}
                >
                  {metrics.itrans2.readiness}
                </span>
                <span className="text-sm tabular-nums">
                  {metrics.itrans2.daysUntilItrans1Retires > 0
                    ? `${metrics.itrans2.daysUntilItrans1Retires} days until ITRANS 1 retirement`
                    : 'ITRANS 1 retirement date passed, verify ITRANS 2 is fully live'}
                </span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {metrics.itrans2.nextAction}
              </p>
              <ul className="text-xs grid grid-cols-2 gap-1 text-gray-500">
                {Object.entries(metrics.itrans2.config).map(([k, v]) => (
                  <li key={k}>
                    <span className={v ? 'text-green-600' : 'text-gray-400'}>
                      {v ? '✓' : '○'}
                    </span>{' '}
                    {k}
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        )}
      </div>
    </DataState>
  )
}
