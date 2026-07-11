import { Link } from 'react-router-dom'
import type { SessionHealthPayload } from '../types/sessionHealth'

type SessionHealthBannerProps = {
  health: SessionHealthPayload | null
  isPlatformAdmin: boolean
}

export function SessionHealthBanner({ health, isPlatformAdmin }: SessionHealthBannerProps) {
  if (!health) return null

  const failed = health.checks.filter((c) => !c.ok && !c.skipped)
  const warnings = health.checks.filter((c) => c.skipped && !c.ok)
  if (failed.length === 0 && warnings.length === 0) return null

  const isError = failed.length > 0
  const items = isError ? failed : warnings
  const summary = items.map((c) => c.label).join(', ')

  return (
    <div
      className={
        isError
          ? 'mx-4 mt-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm relative z-20'
          : 'mx-4 mt-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm relative z-20'
      }
      role="alert"
    >
      <p className={`font-semibold ${isError ? 'text-red-900 dark:text-red-100' : 'text-amber-900 dark:text-amber-100'}`}>
        {isError ? 'System health check failed at sign-in' : 'Some integrations are not configured'}
      </p>
      <p className={`mt-1 ${isError ? 'text-red-800/90 dark:text-red-200/90' : 'text-amber-800/90 dark:text-amber-200/90'}`}>
        {isError
          ? `Degraded services: ${summary || 'unknown issue'}. Contact support if this persists.`
          : `Optional for full go-live: ${summary}. Configure under Admin → Integrations.`}
      </p>
      {(isPlatformAdmin || !isError) && (
        <p className="mt-2 text-xs font-semibold">
          <Link
            to={isPlatformAdmin ? '/admin/health' : '/admin/integrations'}
            className={`underline ${isError ? 'text-red-900 dark:text-red-100' : 'text-amber-900 dark:text-amber-100'}`}
          >
            {isPlatformAdmin ? 'Open system health' : 'Open integrations'}
          </Link>
        </p>
      )}
    </div>
  )
}
