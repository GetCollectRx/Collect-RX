import { Link } from 'react-router-dom'
import { useDesktopConnector } from '../../hooks/useDesktopConnector'
import { Button } from '../ui'

const STATUS_LABEL: Record<string, string> = {
  healthy: 'Sync active',
  starting: 'Starting sync…',
  error: 'Sync error',
  offline: 'Sync offline',
}

export function DesktopConnectorBanner() {
  const { isDesktop, appVersion, sync, updateAvailable, updateDownloaded, triggerManualSync, restartToUpdate } =
    useDesktopConnector()

  if (!isDesktop) return null

  const syncLabel = sync ? STATUS_LABEL[sync.status] ?? sync.status : 'Desktop connector'
  const syncTone =
    sync?.status === 'healthy'
      ? 'text-crx-700 dark:text-crx-300'
      : sync?.status === 'error'
        ? 'text-red-700 dark:text-red-300'
        : 'text-amber-700 dark:text-amber-300'

  return (
    <div
      className="mx-4 mt-3 mb-0 rounded-lg border border-crx-green-hi bg-crx-green-lo/40 px-4 py-3 text-sm flex flex-wrap items-center gap-3 justify-between"
      role="status"
      aria-live="polite"
    >
      <div className="space-y-0.5">
        <p className="font-medium text-crx-900 dark:text-crx-100">
          CollectRx desktop{appVersion ? ` v${appVersion}` : ''}
        </p>
        <p className={syncTone}>
          {syncLabel}
          {sync?.message ? ` · ${sync.message}` : ''}
        </p>
        {updateDownloaded && (
          <p className="text-crx-700">Update {updateDownloaded} ready — restart to install.</p>
        )}
        {updateAvailable && !updateDownloaded && (
          <p className="text-crx-700">Update {updateAvailable} downloading in the background…</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {updateDownloaded && (
          <Button variant="primary" size="sm" onClick={() => void restartToUpdate()}>
            Restart to update
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={() => void triggerManualSync()}>
          Sync now
        </Button>
        <Link to="/download" className="text-xs underline text-crx-700 self-center">
          Downloads
        </Link>
      </div>
    </div>
  )
}
