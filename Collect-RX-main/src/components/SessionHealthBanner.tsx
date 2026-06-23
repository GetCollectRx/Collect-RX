import { Link } from 'react-router-dom'
import type { SessionHealthPayload } from '../types/sessionHealth'

type SessionHealthBannerProps = {
  health: SessionHealthPayload | null
  isPlatformAdmin: boolean
}

export function SessionHealthBanner({ health, isPlatformAdmin }: SessionHealthBannerProps) {
  if (!health || health.ok) return null

  const failed = health.checks.filter((c) => !c.ok && !c.skipped)
  const summary = failed.map((c) => c.label).join(', ')

  return (
    <div
      className="mx-4 mt-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm relative z-20"
      role="alert"
    >
      <p className="font-semibold text-red-900 dark:text-red-100">System health check failed at sign-in</p>
      <p className="text-red-800/90 dark:text-red-200/90 mt-1">
        Some services may be degraded: {summary || 'unknown issue'}. Contact support if this persists.
      </p>
      {isPlatformAdmin && (
        <p className="mt-2 text-xs font-semibold">
          <Link to="/admin/health" className="underline text-red-900 dark:text-red-100">
            Open system health
          </Link>
        </p>
      )}
    </div>
  )
}
