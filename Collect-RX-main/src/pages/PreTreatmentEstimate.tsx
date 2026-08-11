import { useState } from 'react'
import { apiFetchJson } from '../lib/apiFetch'
import { Button, Card, CardHeader, Badge, DataState, Select, Input } from '../components/ui'
import CoverageBreakdown from '../components/CoverageBreakdown'
import AnnualMaxTracker from '../components/AnnualMaxTracker'
import { Carrier, CoverageTier, type EligibilityEstimate } from '../services/eligibility/types'

const CARRIER_LABELS: Record<Carrier, string> = {
  [Carrier.SunLife]: 'Sun Life',
  [Carrier.CanadaLife]: 'Canada Life',
  [Carrier.Manulife]: 'Manulife',
  [Carrier.GreenShield]: 'Green Shield',
  [Carrier.RBC]: 'RBC Insurance',
  [Carrier.TELUSAdjudiCare]: 'TELUS AdjudiCare',
}

const TIER_LABELS: Record<string, string> = {
  [CoverageTier.Preventive]: 'Preventive',
  [CoverageTier.Basic]: 'Basic restorative',
  [CoverageTier.Major]: 'Major restorative',
  [CoverageTier.Ortho]: 'Orthodontics',
}

interface EstimateResponseBody {
  success: boolean
  estimate?: EligibilityEstimate
  error?: string
}

function fmtCurrency(v: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v)
}

function confidenceBadgeColor(score: number): 'green' | 'amber' | 'red' {
  if (score >= 70) return 'green'
  if (score >= 40) return 'amber'
  return 'red'
}

/**
 * Minimal pre-treatment estimate entry point — patient + carrier + one procedure,
 * calls POST /api/eligibility/estimate, renders the result with the existing
 * CoverageBreakdown / AnnualMaxTracker presentational components.
 */
export default function PreTreatmentEstimate() {
  const [patientId, setPatientId] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [carrier, setCarrier] = useState<Carrier>(Carrier.SunLife)
  const [memberId, setMemberId] = useState('')
  const [groupNumber, setGroupNumber] = useState('')
  const [planEffectiveDate, setPlanEffectiveDate] = useState('')
  const [cdtCode, setCdtCode] = useState('')
  const [providerFee, setProviderFee] = useState('')
  const [dateOfService, setDateOfService] = useState(() => new Date().toISOString().slice(0, 10))

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [estimate, setEstimate] = useState<EligibilityEstimate | null>(null)

  const canSubmit =
    patientId.trim() &&
    firstName.trim() &&
    lastName.trim() &&
    dateOfBirth &&
    memberId.trim() &&
    groupNumber.trim() &&
    planEffectiveDate &&
    cdtCode.trim() &&
    providerFee &&
    Number(providerFee) > 0 &&
    dateOfService

  const runEstimate = async () => {
    setSubmitting(true)
    setError(null)
    setEstimate(null)
    try {
      const body = {
        patientId: patientId.trim(),
        carrier,
        procedures: [
          {
            cdtCode: cdtCode.trim().toUpperCase(),
            providerFee: Number(providerFee),
            quantity: 1,
            dateOfService,
          },
        ],
        patient: {
          patientId: patientId.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          dateOfBirth,
          relationshipToSubscriber: 'self',
          primaryPlan: {
            planId: `${patientId.trim()}-primary`,
            carrier,
            planName: CARRIER_LABELS[carrier],
            groupNumber: groupNumber.trim(),
            memberId: memberId.trim(),
            effectiveDate: planEffectiveDate,
            terminationDate: null,
            planType: 'group',
          },
        },
      }

      const res = await apiFetchJson<EstimateResponseBody>('/api/eligibility/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.success || !res.estimate) {
        throw new Error(res.error ?? 'Could not generate estimate')
      }
      setEstimate(res.estimate)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const coverageItems = estimate
    ? Array.from(new Map(estimate.procedures.map((p) => [p.tier, p])).values()).map((p) => ({
        category: p.tier,
        label: TIER_LABELS[p.tier] ?? p.tier,
        coveragePct: p.coveragePercent,
      }))
    : []

  const deductible = estimate
    ? {
        amount: estimate.totals.deductibleAppliedTotal + estimate.estimatedDeductibleRemaining,
        met: estimate.totals.deductibleAppliedTotal,
      }
    : null

  const annualMaxAvailable = estimate ? estimate.totals.insuranceTotal + estimate.estimatedAnnualMaxRemaining : 0

  return (
    <div className="page-enter p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="page-title">Pre-treatment estimate</h1>
        <p className="page-subtitle">
          Estimate what insurance will cover for a planned procedure, using deductible, annual max, and
          coverage-tier rules for the patient's carrier.
        </p>
      </div>

      <Card>
        <CardHeader title="Patient & plan" subtitle="Used to compute deductible and annual max against this carrier's rules" />
        <div className="px-4 pb-4 grid sm:grid-cols-2 gap-3">
          <Input label="Patient ID" value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="PMS patient ID" />
          <Select label="Carrier" value={carrier} onChange={(e) => setCarrier(e.target.value as Carrier)}>
            {Object.values(Carrier).map((c) => (
              <option key={c} value={c}>{CARRIER_LABELS[c]}</option>
            ))}
          </Select>
          <Input label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <Input label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          <Input label="Date of birth" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
          <Input label="Plan effective date" type="date" value={planEffectiveDate} onChange={(e) => setPlanEffectiveDate(e.target.value)} />
          <Input label="Member ID" value={memberId} onChange={(e) => setMemberId(e.target.value)} />
          <Input label="Group number" value={groupNumber} onChange={(e) => setGroupNumber(e.target.value)} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Procedure" subtitle="CDT code and provider fee for the planned treatment" />
        <div className="px-4 pb-4 grid sm:grid-cols-3 gap-3">
          <Input label="CDT code" value={cdtCode} onChange={(e) => setCdtCode(e.target.value)} placeholder="D2740" />
          <Input
            label="Provider fee ($)"
            type="number"
            min="0"
            step="0.01"
            value={providerFee}
            onChange={(e) => setProviderFee(e.target.value)}
          />
          <Input label="Date of service" type="date" value={dateOfService} onChange={(e) => setDateOfService(e.target.value)} />
        </div>
        <div className="px-4 pb-4">
          <Button onClick={() => void runEstimate()} disabled={!canSubmit || submitting}>
            {submitting ? 'Estimating…' : 'Generate estimate'}
          </Button>
        </div>
      </Card>

      <DataState loading={submitting} error={error} isEmpty={!estimate} emptyTitle="No estimate yet" emptyDetail="Fill in the patient, plan, and procedure details above, then generate an estimate.">
        {estimate && (
          <div className="space-y-6">
            <Card>
              <CardHeader title="Estimate summary" subtitle={`Generated ${new Date(estimate.generatedAt).toLocaleString()}`} />
              <div className="px-4 pb-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge color={confidenceBadgeColor(estimate.confidenceScore)}>
                    Confidence {estimate.confidenceScore}%
                  </Badge>
                  <Badge>{estimate.eligibilityStatus}</Badge>
                </div>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  <div>
                    <dt className="text-gray-500">Provider fee</dt>
                    <dd className="font-medium">{fmtCurrency(estimate.totals.providerFeeTotal)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Insurance pays</dt>
                    <dd className="font-medium">{fmtCurrency(estimate.totals.insuranceTotal)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Patient owes</dt>
                    <dd className="font-medium">{fmtCurrency(estimate.totals.patientTotal)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Deductible applied</dt>
                    <dd className="font-medium">{fmtCurrency(estimate.totals.deductibleAppliedTotal)}</dd>
                  </div>
                </dl>
                {estimate.confidenceNotes.length > 0 && (
                  <ul className="text-xs text-gray-500 list-disc pl-4 space-y-1">
                    {estimate.confidenceNotes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                )}
              </div>
            </Card>

            <div className="grid sm:grid-cols-2 gap-6">
              <CoverageBreakdown coverage={coverageItems} deductible={deductible} />
              <AnnualMaxTracker annualMax={annualMaxAvailable} annualMaxUsed={estimate.totals.insuranceTotal} />
            </div>
          </div>
        )}
      </DataState>
    </div>
  )
}
