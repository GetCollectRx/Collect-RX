import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetchJson } from '../lib/apiFetch'
import { resolveApiUrl } from '../lib/resolveApiUrl'

type UsageAlert = {
  level: 'info' | 'warning' | 'critical'
  code: string
  message: string
}

export function PlanUsageBanner() {
  const [alerts, setAlerts] = useState<UsageAlert[]>([])

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiFetchJson<{ plan?: { alerts?: UsageAlert[] } }>(
          resolveApiUrl('/api/billing/plan'),
        )
        const top = (data.plan?.alerts ?? []).filter((a) => a.level !== 'info').slice(0, 2)
        setAlerts(top)
      } catch {
        setAlerts([])
      }
    })()
  }, [])

  if (alerts.length === 0) return null

  return (
    <div className="mb-4 space-y-2">
      {alerts.map((a) => (
        <div
          key={a.code}
          className={`rounded-lg border px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-2 ${
            a.level === 'critical'
              ? 'border-red-200 bg-red-50 text-red-900'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
          role="status"
        >
          <span>{a.message}</span>
          <Link to="/billing" className="text-xs font-semibold underline shrink-0">
            View plan
          </Link>
        </div>
      ))}
    </div>
  )
}
