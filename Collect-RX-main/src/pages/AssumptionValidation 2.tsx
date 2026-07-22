import { useEffect, useState } from 'react'
import { usePractice } from '../context/PracticeContext'
import { apiFetchJson } from '../lib/apiFetch'
import { Card, CardHeader, DataState, StatTile, Button } from '../components/ui'

type WindowDays = 30 | 60 | 90

interface AssumptionValidationReport {
  windowDays: WindowDays
  periodStart: string
  periodEnd: string
  carrierAcceptance: {
    totalCompletedCalls: number
    acceptedCalls: number
    ratePct: number | null
  }
  resolution: {
    totalCompletedCalls: number
    resolvedCalls: number
    ratePct: number | null
    targetPct: number
    meetsTarget: boolean | null
  }
  roi: {
    revenueRecovered: number
    billingTier: string
    subscriptionCost: number
    ratio: number | null
    positive: boolean | null
  }
}

const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' })

function pctLabel(pct: number | null): string {
  return pct === null ? '—' : `${pct}%`
}

export default function AssumptionValidation() {
  const { practiceId, loading: practiceLoading } = usePractice()
  const [windowDays, setWindowDays] = useState<WindowDays>(30)
  const [report, setReport] = useState<AssumptionValidationReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    apiFetchJson<{ success: boolean; data: AssumptionValidationReport }>(
      `/api/analytics/assumption-validation?days=${windowDays}`,
    )
      .then((res) => setReport(res.data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [practiceId, windowDays])

  const resolutionAccent =
    report?.resolution.meetsTarget === null || !report
      ? 'default'
      : report.resolution.meetsTarget
        ? 'green'
        : 'red'

  const roiAccent =
    report?.roi.positive === null || !report ? 'default' : report.roi.positive ? 'green' : 'red'

  return (
    <div className="page-enter p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Assumption validation
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Day {windowDays} pilot checkpoint — do the core assumptions hold?
          </p>
        </div>
        <div className="flex gap-2">
          {([30, 60, 90] as WindowDays[]).map((d) => (
            <Button
              key={d}
              variant={windowDays === d ? 'primary' : 'secondary'}
              onClick={() => setWindowDays(d)}
            >
              Day {d}
            </Button>
          ))}
        </div>
      </div>

      <DataState loading={loading || practiceLoading} error={error} isEmpty={!report}>
        {report && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatTile
                label="Carrier acceptance rate"
                value={pctLabel(report.carrierAcceptance.ratePct)}
                sub={`${report.carrierAcceptance.acceptedCalls} of ${report.carrierAcceptance.totalCompletedCalls} completed calls reached a carrier conversation`}
                accent={report.carrierAcceptance.ratePct === null ? 'default' : 'blue'}
              />
              <StatTile
                label="Resolution rate"
                value={pctLabel(report.resolution.ratePct)}
                sub={`Target ≥ ${report.resolution.targetPct}% — ${report.resolution.resolvedCalls} resolved of ${report.resolution.totalCompletedCalls} calls`}
                accent={resolutionAccent}
              />
              <StatTile
                label="ROI vs subscription"
                value={report.roi.ratio === null ? '—' : `${report.roi.ratio}×`}
                sub={`${cad.format(report.roi.revenueRecovered)} recovered vs ${cad.format(report.roi.subscriptionCost)} subscription (${report.roi.billingTier})`}
                accent={roiAccent}
              />
            </div>

            <Card>
              <CardHeader title="How these are measured" />
              <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-2 list-disc pl-5">
                <li>
                  <strong>Carrier acceptance</strong> — completed calls that reached a carrier
                  conversation, excluding blocked, failed, unanswered, and hung-up calls.
                </li>
                <li>
                  <strong>Resolution rate</strong> — calls ending in a resolved claim, against the
                  60% pilot target.
                </li>
                <li>
                  <strong>ROI</strong> — billed value of claims resolved in the window, against the
                  subscription cost for the same period. A ratio of 1× or higher means the platform
                  paid for itself.
                </li>
              </ul>
            </Card>
          </>
        )}
      </DataState>
    </div>
  )
}
