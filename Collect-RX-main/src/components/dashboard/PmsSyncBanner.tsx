import { Link } from 'react-router-dom'
import type { PracticePmsInfo } from '../../types/pms'

export interface DashboardLastPmsImport {
  at: string
  status: string
  source: string
  sourceDisplayName: string
  validationPassed: boolean | null
  recordsImported: number
  recordsTotal: number
  recordsFailed: number
}

type PmsSyncBannerProps = {
  pms: PracticePmsInfo
  lastImport: DashboardLastPmsImport | null
  canManageSync: boolean
}

function formatSyncTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function syncAgeHours(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000
}

export function PmsSyncBanner({ pms, lastImport, canManageSync }: PmsSyncBannerProps) {
  const settingsLink = '/settings'
  const syncLink = '/admin/sync'

  if (!lastImport) {
    return (
      <div
        className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm relative z-10"
        role="status"
      >
        <p className="font-semibold text-amber-900 dark:text-amber-100">Connect your practice management system</p>
        <p className="text-amber-800/90 dark:text-amber-200/90 mt-1">
          {pms.inferredFromLastImport
            ? `We detected ${pms.displayName} from a prior import. Confirm it in settings, then upload a fresh claim export so carrier follow-up has current balances.`
            : `Set your PMS (${pms.displayName}) and upload a claim export, CollectRx uses that data for calls; carrier phone rules are the same for every system.`}
        </p>
        {canManageSync && (
          <p className="mt-2 flex flex-wrap gap-3 text-xs font-semibold">
            <Link to={settingsLink} className="underline text-amber-900 dark:text-amber-100">
              Practice settings
            </Link>
            <Link to={syncLink} className="underline text-amber-900 dark:text-amber-100">
              Upload export
            </Link>
          </p>
        )}
      </div>
    )
  }

  const stale = syncAgeHours(lastImport.at) > 48
  const importFailed =
    lastImport.status === 'failed' ||
    lastImport.validationPassed === false ||
    (lastImport.recordsFailed > 0 && lastImport.status !== 'success')
  if (pms.inferredFromLastImport || importFailed || stale) {
    const title = importFailed
      ? 'Last PMS import needs attention'
      : stale
        ? 'PMS data may be stale'
        : 'Confirm your PMS vendor'

    const detail = importFailed
      ? `${lastImport.sourceDisplayName} import on ${formatSyncTime(lastImport.at)}, status ${lastImport.status}` +
        (lastImport.recordsFailed > 0 ? ` (${lastImport.recordsFailed} row errors).` : '.')
      : stale
        ? `Last sync from ${lastImport.sourceDisplayName} was ${formatSyncTime(lastImport.at)}. Upload a new export before the voice queue works stale claims.`
        : `Imports are using ${lastImport.sourceDisplayName}. Save ${pms.displayName} in Practice settings so column mapping stays consistent.`

    return (
      <div
        className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm relative z-10"
        role="status"
      >
        <p className="font-semibold text-amber-900 dark:text-amber-100">{title}</p>
        <p className="text-amber-800/90 dark:text-amber-200/90 mt-1">{detail}</p>
        {canManageSync && (
          <p className="mt-2 flex flex-wrap gap-3 text-xs font-semibold">
            {pms.inferredFromLastImport && (
              <Link to={settingsLink} className="underline text-amber-900 dark:text-amber-100">
                Practice settings
              </Link>
            )}
            <Link to={syncLink} className="underline text-amber-900 dark:text-amber-100">
              Sync ops
            </Link>
          </p>
        )}
      </div>
    )
  }

  return (
    <div
      className="rounded-lg border px-4 py-3 text-sm relative z-10"
      style={{
        borderColor: 'var(--crx-border, rgba(18, 201, 109, 0.25))',
        background: 'rgba(18, 201, 109, 0.06)',
      }}
      role="status"
    >
      <p className="font-medium" style={{ color: 'var(--crx-green)' }}>
        PMS: {pms.displayName}
        <span className="font-normal text-gray-500 dark:text-gray-400 ml-2">
          · Last sync {formatSyncTime(lastImport.at)} ({lastImport.recordsImported}/
          {lastImport.recordsTotal} claims)
        </span>
      </p>
      <p className="crx-sub mt-1 text-xs">
        Carrier calls use the same recovery rules for every PMS, only how we read your export changes.
        {canManageSync && (
          <>
            {' '}
            <Link to={syncLink} className="underline" style={{ color: 'var(--crx-green)' }}>
              Sync ops
            </Link>
          </>
        )}
      </p>
    </div>
  )
}
