import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { apiFetchJson } from '../lib/apiFetch'
import { resolveApiUrl } from '../lib/resolveApiUrl'
import { usePractice } from '../context/PracticeContext'

type UsageAlert = {
  level: 'info' | 'warning' | 'critical'
  code: string
  message: string
}

type PlanBannerPayload = {
  plan?: {
    callsPaused: boolean
    callsPausedReason: string | null
    cycle: { minutesRemaining: number; minutesIncluded: number }
    alerts?: UsageAlert[]
  }
}

/**
 * App-shell banner: usage warnings plus a non-dismissible pause notice with
 * the CTA that actually unblocks calling (confirm overage / upgrade). Hidden
 * for roles without plan-usage access (the API returns 403 for them).
 */
export function PlanUsageBanner() {
  const { isPracticeOwner } = usePractice()
  const location = useLocation()
  const [payload, setPayload] = useState<PlanBannerPayload['plan'] | null>(null)
  const [overageBusy, setOverageBusy] = useState(false)
  const [overageError, setOverageError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await apiFetchJson<PlanBannerPayload>(resolveApiUrl('/api/billing/plan'))
      setPayload(data.plan ?? null)
    } catch {
      setPayload(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, location.pathname])

  if (!payload) return null

  const paused = payload.callsPaused
  const alerts = (payload.alerts ?? []).filter((a) => a.level !== 'info').slice(0, 2)
  if (!paused && alerts.length === 0) return null

  const minutesLeft = Math.max(0, payload.cycle.minutesRemaining)
  const overagePending = payload.callsPausedReason === 'overage_pending'

  async function confirmOverage() {
    setOverageError(null)
    setOverageBusy(true)
    try {
      await apiFetchJson(resolveApiUrl('/api/billing/usage/confirm-overage'), { method: 'POST' })
      await load()
    } catch (e) {
      setOverageError((e as Error).message)
    } finally {
      setOverageBusy(false)
    }
  }

  return (
    <div className="px-4 pt-3 space-y-2">
      {alerts.map((a) => (
        <div
          key={a.code}
          className={`rounded-lg border px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-2 ${
            a.level === 'critical' || paused
              ? 'border-red-200 bg-red-50 text-red-900'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
          role={paused ? 'alert' : 'status'}
        >
          <span>
            {a.message}{' '}
            <span className="text-xs opacity-80">
              ({minutesLeft} of {payload.cycle.minutesIncluded} plan minutes remaining)
            </span>
          </span>
          <span className="flex items-center gap-3 shrink-0">
            {overagePending && isPracticeOwner && (
              <button
                type="button"
                disabled={overageBusy}
                onClick={() => void confirmOverage()}
                className="text-xs font-semibold rounded-md bg-red-700 hover:bg-red-800 text-white px-3 py-1.5 disabled:opacity-50"
              >
                {overageBusy ? 'Please wait…' : 'Confirm overage charges'}
              </button>
            )}
            <Link to="/billing" className="text-xs font-semibold underline">
              {paused ? 'View plan & upgrade' : 'View plan'}
            </Link>
          </span>
        </div>
      ))}
      {paused && alerts.length === 0 && (
        <div
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 flex flex-wrap items-center justify-between gap-2"
          role="alert"
        >
          <span>Calling is paused for this practice.</span>
          <Link to="/billing" className="text-xs font-semibold underline shrink-0">
            View plan &amp; upgrade
          </Link>
        </div>
      )}
      {overageError && (
        <p className="text-xs text-red-700" role="alert">
          {overageError}
        </p>
      )}
    </div>
  )
}
