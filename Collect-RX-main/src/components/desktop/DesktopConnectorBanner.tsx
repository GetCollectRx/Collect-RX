import { Link } from 'react-router-dom'
import { useDesktopConnector } from '../../hooks/useDesktopConnector'
import { Button } from '../ui'

export function DesktopConnectorBanner() {
  const { isDesktop, appVersion, updateAvailable, updateDownloaded, restartToUpdate } = useDesktopConnector()

  if (!isDesktop) return null

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
        <Link to="/download" className="text-xs underline text-crx-700 self-center">
          Downloads
        </Link>
      </div>
    </div>
  )
}
