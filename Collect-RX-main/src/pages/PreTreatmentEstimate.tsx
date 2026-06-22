import { useState, useCallback } from 'react'
import { apiFetch } from '../lib/apiFetch'
import { parseApiJson } from '../lib/parseApiJson'
import {
  Card, CardHeader, Button, Input, InlineToast, useToast, Divider, DataState, ProgressBar,
} from '../components/ui'
import AnnualMaxTracker  from '../components/AnnualMaxTracker'
import CoverageBreakdown from '../components/CoverageBreakdown'
import { HelpTip } from '../components/HelpTip'

// ── Constants ─────────────────────────────────────────────────────────────
const CDT_CATEGORIES: Record<string, { label: string; examples: string }> = {
  preventive:        { label: 'Preventive',        examples: 'D0120, D1110, D0274' },
  basic_restorative: { label: 'Basic Restorative', examples: 'D2140, D2150, D2391' },
  major_restorative: { label: 'Major Restorative', examples: 'D2740, D2750, D2790' },
  endodontics:       { label: 'Endodontics',       examples: 'D3310, D3320, D3330' },
  periodontics:      { label: 'Periodontics',      examples: 'D4341, D4342, D4910' },
  prosthodontics:    { label: 'Prosthodontics',    examples: 'D5110, D5120, D6240' },
  oral_surgery:      { label: 'Oral Surgery',      examples: 'D7140, D7210, D7240' },
  orthodontics:      { label: 'Orthodontics',      examples: 'D8080, D8090' },
}

interface Benefits {
  annual_max?: number; annual_max_used?: number; pending_claims?: number
  plan_year_end?: string; stale_flag?: boolean; deductible?: number; deductible_met?: number
}
interface CoverageItem {
  cdt_category: string; coverage_pct?: number; waiting_period_months?: number
  waiting_period_start?: string; frequency_limit_months?: number; last_service_date?: string
}
interface EstimateProc { code: string; category: string; fee: number; coveragePct: number; insurancePays: number; patientOwes: number }
interface Estimate { totalFees?: number; insurancePays?: number; patientOwes?: number; procedures?: EstimateProc[]; deductibleApplied?: number; exceedsAnnualMax?: boolean; overageAmount?: number }

function fmtCurrency(v: number | null | undefined) {
  return v != null ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v) : '$0.00'
}

// ── Summary box ───────────────────────────────────────────────────────────
function SummaryBox({ label, value, sub, accent = 'default' }: { label: string; value: string; sub?: string; accent?: string }) {
  const textMap: Record<string, string> = {
    default: 'text-gray-900 dark:text-gray-100',
    green:   'text-crx-600 dark:text-crx-400',
    amber:   'text-amber-600 dark:text-amber-400',
  }
  return (
    <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg px-4 py-3 text-center">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-bold mt-1 tabular-nums ${textMap[accent] ?? textMap.default}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────
export default function PreTreatmentEstimate() {
  const [patientToken, setPatientToken] = useState('')
  const [carrierCode,  setCarrierCode]  = useState('')
  const [procedures,   setProcedures]   = useState([{ code: '', fee: '' }])
  const [benefits,     setBenefits]     = useState<Benefits | null>(null)
  const [coverage,     setCoverage]     = useState<CoverageItem[]>([])
  const [estimate,     setEstimate]     = useState<Estimate | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [estimating,   setEstimating]   = useState(false)
  const [benefitsError, setBenefitsError] = useState<string | null>(null)
  const [estimateError, setEstimateError] = useState<string | null>(null)
  const { toast, showToast }            = useToast()

  const loadBenefits = useCallback(async () => {
    if (!patientToken.trim() || !carrierCode.trim()) {
      showToast('err', 'Enter patient token and carrier code first.')
      return
    }
    setLoading(true)
    setBenefitsError(null)
    setEstimateError(null)
    setBenefits(null); setCoverage([]); setEstimate(null)
    try {
      const res  = await apiFetch(`/api/benefits/${patientToken.trim()}?carrier_code=${carrierCode.trim()}`)
      const data = await parseApiJson<{ benefits?: unknown; coverage?: CoverageItem[]; error?: string }>(res)
      if (!res.ok) throw new Error(data.error || 'Failed to load benefits')
      if (data.benefits) { setBenefits(data.benefits); setCoverage(data.coverage ?? []) }
      else {
        const msg = 'No benefits found for this patient/carrier.'
        setBenefitsError(msg)
        showToast('err', msg)
      }
    } catch (err) {
      const msg = (err as Error).message
      setBenefitsError(msg)
      showToast('err', msg)
    }
    finally { setLoading(false) }
  }, [patientToken, carrierCode, showToast])

  const calculateEstimate = useCallback(async () => {
    const valid = procedures.filter(p => p.code.trim() && p.fee)
    if (valid.length === 0) { showToast('err', 'Add at least one procedure with code and fee.'); return }
    setEstimating(true)
    setEstimateError(null)
    setEstimate(null)
    try {
      const res  = await apiFetch('/api/benefits/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_token: patientToken.trim(),
          carrier_code:  carrierCode.trim(),
          procedures: valid.map(p => ({ cdtCode: p.code.trim().toUpperCase(), fee: parseFloat(p.fee) })),
        }),
      })
      const data = await parseApiJson<Estimate & { error?: string }>(res)
      if (!res.ok) throw new Error(data.error || 'Estimate failed')
      setEstimate(data as Estimate)
    } catch (err) {
      const msg = (err as Error).message
      setEstimateError(msg)
      showToast('err', msg)
    }
    finally { setEstimating(false) }
  }, [patientToken, carrierCode, procedures, showToast])

  const addProcedure    = () => setProcedures(p => [...p, { code: '', fee: '' }])
  const removeProcedure = (i: number) => setProcedures(p => p.filter((_, idx) => idx !== i))
  const updateProcedure = (i: number, field: 'code'|'fee', v: string) =>
    setProcedures(p => { const n = [...p]; n[i] = { ...n[i], [field]: v }; return n })

  // Confidence indicator based on data freshness
  const confidence = benefits?.stale_flag ? 60 : benefits ? 92 : 0

  return (
    <div className="page-enter p-6 space-y-5 max-w-[1400px]">
      {/* Header */}
      <div>
        <div className="flex items-center gap-1.5">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Pre-Treatment Estimate</h1>
          <HelpTip>
            Load stored benefits for a patient and carrier, add CDT procedures and fees, then run an estimate. Results depend on
            data freshness; Admin may need to sync carrier settings first.
          </HelpTip>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Calculate patient responsibility before treatment begins</p>
      </div>

      {toast && <InlineToast toast={toast} />}

      {/** P3-14: shared loading (full-page); benefits API errors stay inline on the right so the form remains usable. */}
      <DataState
        loading={loading}
        error={null}
        isEmpty={false}
      >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: form ─────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Patient lookup */}
          <Card>
            <CardHeader title="Patient & Carrier" subtitle="Enter the token and carrier code to load benefit details" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Patient Token"
                value={patientToken}
                onChange={e => { setPatientToken(e.target.value); setBenefitsError(null) }}
                placeholder="e.g. pt_a1b2c3"
              />
              <Input
                label="Carrier Code"
                value={carrierCode}
                onChange={e => { setCarrierCode(e.target.value); setBenefitsError(null) }}
                placeholder="sun_life · manulife · canada_life…"
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={loadBenefits}
              loading={loading}
            >
              Load Benefits
            </Button>
          </Card>

          {/* Treatment plan */}
          <Card>
            <CardHeader
              title="Treatment Plan"
              action={
                <Button variant="ghost" size="xs" onClick={addProcedure}>+ Add procedure</Button>
              }
            />
            <div className="space-y-2">
              {procedures.map((proc, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    placeholder="CDT code (e.g. D2750)"
                    value={proc.code}
                    onChange={e => updateProcedure(i, 'code', e.target.value)}
                    className="flex-1"
                    aria-label={`Procedure ${i+1} CDT code`}
                  />
                  <Input
                    type="number"
                    placeholder="Fee"
                    value={proc.fee}
                    onChange={e => updateProcedure(i, 'fee', e.target.value)}
                    className="w-28"
                    leading="$"
                    aria-label={`Procedure ${i+1} fee`}
                  />
                  {procedures.length > 1 && (
                    <button
                      onClick={() => removeProcedure(i)}
                      className="text-gray-400 hover:text-red-500 transition-colors p-1"
                      aria-label={`Remove procedure ${i+1}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* CDT quick reference */}
            <Divider className="my-4" />
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Common CDT codes by category</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
              {Object.entries(CDT_CATEGORIES).map(([, v]) => (
                <div key={v.label}>
                  <span className="font-medium text-gray-600 dark:text-gray-300">{v.label}:</span> {v.examples}
                </div>
              ))}
            </div>

            {estimateError && (
              <div
                className="mt-4 p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50/80 dark:bg-red-900/20 text-sm text-red-800 dark:text-red-200"
                role="alert"
              >
                {estimateError}
              </div>
            )}

            <Button
              variant="primary"
              size="md"
              className="mt-5 w-full"
              onClick={calculateEstimate}
              loading={estimating}
              disabled={!benefits || estimating}
            >
              {estimating ? 'Calculating…' : 'Calculate Estimate'}
            </Button>
          </Card>

          {/* Estimate results */}
          {estimate && (
            <Card>
              <CardHeader title="Estimate Breakdown" />

              {/* Summary row */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <SummaryBox label="Total Fees"          value={fmtCurrency(estimate.totalFees)} />
                <SummaryBox label="Est. Insurance Pays" value={fmtCurrency(estimate.insurancePays)} accent="green" />
                <SummaryBox label="Est. Patient Owes"   value={fmtCurrency(estimate.patientOwes)}  accent="amber" />
              </div>

              {/* Per-procedure table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-700 text-left">
                      {['Procedure','Fee','Coverage','Ins. Pays','Patient'].map(h => (
                        <th key={h} className="pb-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide last:text-right">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700/40">
                    {estimate.procedures?.map((p, i) => (
                      <tr key={i}>
                        <td className="py-2.5 text-gray-800 dark:text-gray-200">
                          {p.code} <span className="text-gray-400 text-xs">({p.category})</span>
                        </td>
                        <td className="py-2.5 text-gray-600 dark:text-gray-400">{fmtCurrency(p.fee)}</td>
                        <td className="py-2.5 text-gray-600 dark:text-gray-400">{p.coveragePct}%</td>
                        <td className="py-2.5 text-crx-600 dark:text-crx-400 font-medium">{fmtCurrency(p.insurancePays)}</td>
                        <td className="py-2.5 text-right font-semibold text-gray-900 dark:text-gray-100">{fmtCurrency(p.patientOwes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Warnings */}
              {(estimate.deductibleApplied ?? 0) > 0 && (
                <div className="mt-4 px-3 py-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg text-xs text-blue-700 dark:text-blue-300">
                  Deductible of {fmtCurrency(estimate.deductibleApplied)} applied to this estimate.
                </div>
              )}
              {estimate.exceedsAnnualMax && (
                <div className="mt-3 px-3 py-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-300 font-medium">
                  Treatment exceeds remaining annual maximum by {fmtCurrency(estimate.overageAmount)}. That amount is included in patient responsibility.
                </div>
              )}
              <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
                This is an estimate only. Actual insurance payment may vary based on UCR limitations, alternate benefit clauses, and final adjudication.
              </p>
            </Card>
          )}
        </div>

        {/* ── Right: benefits panel ──────────────────────────────────────── */}
        <div className="space-y-5">
          {benefits ? (
            <>
              {/* Confidence indicator */}
              <Card padding="sm">
                <CardHeader title="Data Confidence" subtitle={benefits.stale_flag ? 'Benefits data may be stale' : 'Benefits data is current'} />
                <ProgressBar value={confidence} color={confidence >= 80 ? '#0F6E56' : '#f59e0b'} />
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-gray-400">Low</span>
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{confidence}%</span>
                  <span className="text-xs text-gray-400">High</span>
                </div>
              </Card>

              <AnnualMaxTracker
                annualMax={benefits.annual_max}
                annualMaxUsed={benefits.annual_max_used}
                pendingClaims={benefits.pending_claims ?? 0}
                planYearEnd={benefits.plan_year_end}
                staleFlag={benefits.stale_flag}
              />
              <CoverageBreakdown
                coverage={coverage.map(c => ({
                  category: c.cdt_category,
                  label: CDT_CATEGORIES[c.cdt_category]?.label ?? c.cdt_category,
                  coveragePct: c.coverage_pct,
                  waitingPeriodMonths: c.waiting_period_months,
                  waitingPeriodStart:  c.waiting_period_start,
                  frequencyLimitMonths: c.frequency_limit_months,
                  lastServiceDate:     c.last_service_date,
                }))}
                deductible={benefits.deductible ? { amount: benefits.deductible, met: benefits.deductible_met ?? 0 } : null}
              />
            </>
          ) : (
            <Card className="py-8">
              {benefitsError && (
                <div
                  className="mb-4 p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50/80 dark:bg-red-900/20 text-sm text-red-800 dark:text-red-200 text-left"
                  role="alert"
                >
                  {benefitsError}
                </div>
              )}
              <div className="text-center">
                <div className="text-4xl mb-3" aria-hidden="true">🔍</div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Enter a patient token and carrier code to load coverage details
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>
      </DataState>
    </div>
  )
}
