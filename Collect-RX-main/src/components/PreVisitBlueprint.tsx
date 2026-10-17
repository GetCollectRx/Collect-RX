/**
 * Pre-Visit Blueprint — front-desk checkout tool showing the exact ODA vs.
 * CDCP cost split for a planned procedure, plus known downgrade/lab-fee-cap
 * warnings, so staff can set patient expectations before treatment instead
 * of after.
 *
 * Calls POST /api/ontario-billing/split (calculateOntarioSplitBilling on the
 * server — see billingCalculator.ts) rather than duplicating the split-
 * billing math in the browser: the money math has one source of truth,
 * matching how PreTreatmentEstimate.tsx calls /api/eligibility/estimate
 * instead of computing coverage client-side.
 */
import { useState } from 'react'
import { apiFetchJson } from '../lib/apiFetch'
import { Card, CardHeader, Input, Select, Button } from './ui'

type CoPayTier = 0 | 40 | 60

interface SplitBillingResult {
  cdcpApprovedCoverageCents: number
  patientCoPayCents: number
  balanceBillingCents: number
  totalPatientResponsibilityCents: number
  secondaryRouteAmountCents: number
}

interface SplitBillingResponseBody {
  success: boolean
  result?: SplitBillingResult
  error?: string
}

/**
 * Known CDCP downgrade / lab-fee-cap warnings by CDT code prefix. Not backed
 * by a data table (unlike carrier-configs.json) — these are front-desk
 * talking points, not billing math, and this is the small, hand-maintained
 * set the PRD calls out (posterior composite-to-amalgam downgrades, CDCP lab
 * fee caps on removable prosthodontics).
 */
const KNOWN_DOWNGRADE_WARNINGS: Array<{ cdtPrefixes: string[]; message: string }> = [
  {
    cdtPrefixes: ['D2391', 'D2392', 'D2393', 'D2394'],
    message:
      'CDCP may downgrade a posterior composite filling to the amalgam fee if amalgam is a clinically acceptable alternative — the patient may owe the difference as balance billing.',
  },
  {
    cdtPrefixes: ['D5110', 'D5120', 'D5211', 'D5212'],
    message: 'CDCP caps the lab fee portion of removable dentures/partials separately from the clinical fee — confirm the lab invoice is within the CDCP lab fee schedule before quoting.',
  },
]

function warningsForCdtCode(cdtCode: string): string[] {
  const normalized = cdtCode.trim().toUpperCase()
  if (!normalized) return []
  return KNOWN_DOWNGRADE_WARNINGS.filter((w) => w.cdtPrefixes.some((p) => normalized.startsWith(p))).map(
    (w) => w.message,
  )
}

function fmtCentsAsCurrency(cents: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)
}

export default function PreVisitBlueprint() {
  const [cdtCode, setCdtCode] = useState('')
  const [odaFee, setOdaFee] = useState('120.00')
  const [cdcpFee, setCdcpFee] = useState('85.00')
  const [coPayTier, setCoPayTier] = useState<CoPayTier>(0)
  const [isProvincialSecondary, setIsProvincialSecondary] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SplitBillingResult | null>(null)

  const canCalculate = Number(odaFee) >= 0 && Number(cdcpFee) >= 0

  const calculate = async () => {
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const res = await apiFetchJson<SplitBillingResponseBody>('/api/ontario-billing/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          odaFeeAmount: Number(odaFee),
          cdcpFeeAmount: Number(cdcpFee),
          coPayTier,
          isProvincialSecondary,
        }),
      })
      if (!res.success || !res.result) {
        throw new Error(res.error ?? 'Could not calculate the split')
      }
      setResult(res.result)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const warnings = warningsForCdtCode(cdtCode)

  return (
    <div className="max-w-xl space-y-4">
      <Card>
        <CardHeader
          title="CDCP / ODA Pre-Visit Blueprint"
          subtitle="Show the patient their exact cost split before treatment — no checkout surprises"
        />
        <div className="space-y-3">
          <Input
            label="CDT code (optional — shows known downgrade/lab-fee warnings)"
            value={cdtCode}
            onChange={(e) => setCdtCode(e.target.value)}
            placeholder="e.g. D2392"
          />
          <div className="grid sm:grid-cols-2 gap-3">
            <Input
              label="ODA Suggested Fee Guide rate ($)"
              type="number"
              min="0"
              step="0.01"
              value={odaFee}
              onChange={(e) => setOdaFee(e.target.value)}
            />
            <Input
              label="CDCP fee grid amount ($)"
              type="number"
              min="0"
              step="0.01"
              value={cdcpFee}
              onChange={(e) => setCdcpFee(e.target.value)}
            />
          </div>
          <Select
            label="Patient's CDCP co-pay tier"
            value={coPayTier}
            onChange={(e) => setCoPayTier(Number(e.target.value) as CoPayTier)}
          >
            <option value={0}>0% — under $70,000 adjusted family net income</option>
            <option value={40}>40% — $70,000–$79,999</option>
            <option value={60}>60% — $80,000–$89,999</option>
          </Select>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={isProvincialSecondary}
              onChange={(e) => setIsProvincialSecondary(e.target.checked)}
              className="rounded border-gray-300 text-crx-500 focus:ring-crx-500"
            />
            Patient has provincial secondary coverage (ODSP / Ontario Works / Healthy Smiles Ontario)
          </label>

          <Button onClick={calculate} disabled={!canCalculate} loading={submitting}>
            Calculate patient cost
          </Button>
        </div>
      </Card>

      {warnings.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-2">
            Known downgrade / lab-fee warning
          </p>
          <ul className="space-y-1">
            {warnings.map((w) => (
              <li key={w} className="text-sm text-amber-800">
                {w}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {error && (
        <Card className="border-red-200 bg-red-50">
          <p className="text-sm font-medium text-red-600">{error}</p>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader title="Checkout breakdown" />
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Insurer approved payout (Sun Life CDCP)</span>
              <span className="font-semibold text-gray-800">{fmtCentsAsCurrency(result.cdcpApprovedCoverageCents)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Patient co-pay (income tier)</span>
              <span className="font-semibold text-red-600">{fmtCentsAsCurrency(result.patientCoPayCents)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Balance billing (ODA vs. CDCP gap)</span>
              <span className="font-semibold text-red-600">{fmtCentsAsCurrency(result.balanceBillingCents)}</span>
            </div>
            {isProvincialSecondary && (
              <div className="flex justify-between text-sm bg-amber-100 -mx-2 px-2 py-1 rounded">
                <span className="text-amber-800 font-medium">Routed to Accerta (provincial secondary)</span>
                <span className="font-bold text-amber-800">{fmtCentsAsCurrency(result.secondaryRouteAmountCents)}</span>
              </div>
            )}
            <div className="flex justify-between text-base border-t border-gray-100 pt-2 mt-2 font-bold">
              <span className="text-gray-800">Total patient checkout responsibility</span>
              <span className="text-crx-600">{fmtCentsAsCurrency(result.totalPatientResponsibilityCents)}</span>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
