import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CollectRxLogoMark } from '../components/brand/CollectRxLogo'
import { DesktopConnectorBanner } from '../components/desktop/DesktopConnectorBanner'
import { Card, CardHeader, DataState } from '../components/ui'
import { usePublicPortalTheme } from '../website/usePublicPortalTheme'
import {
  DESKTOP_RELEASES_PAGE,
  fallbackDesktopReleaseInfo,
  fetchDesktopReleases,
  getRecommendedPlatform,
  type DesktopPlatform,
  type DesktopReleaseInfo,
} from '../lib/desktopReleases'

function formatBytes(n?: number): string {
  if (!n) return ''
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function platformBadge(platform: DesktopPlatform, recommended: DesktopPlatform): string | null {
  if (platform !== recommended) return null
  return 'Recommended for this device'
}

export default function DesktopDownload() {
  usePublicPortalTheme()
  const recommended = useMemo(() => getRecommendedPlatform(), [])
  const [release, setRelease] = useState<DesktopReleaseInfo | null>(null)
  const [downloadsConfigured, setDownloadsConfigured] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchDesktopReleases()
      .then((result) => {
        if (cancelled) return
        if (result) {
          setRelease(result.info)
          setDownloadsConfigured(result.downloadsConfigured)
        } else {
          setRelease(fallbackDesktopReleaseInfo())
          setDownloadsConfigured(false)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError((e as Error).message)
          setRelease(fallbackDesktopReleaseInfo())
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const info = release ?? fallbackDesktopReleaseInfo()

  // Connector code is intentionally retained for a possible future phase, but
  // the current supported pilot intake is CSV-only. Do not expose installers or
  // setup instructions until product, security, deployment, and support review
  // explicitly enables this surface.
  const desktopConnectorAvailable = false
  if (!desktopConnectorAvailable) {
    return (
      <div className="crx-app min-h-screen">
        <div className="page-enter p-6 max-w-3xl mx-auto">
          <Card>
            <CardHeader title="Desktop connector unavailable" subtitle="Current supported intake: CSV only" />
            <div className="px-4 pb-4 space-y-3 text-sm text-crx-t2">
              <p>No installation or practice-management-system access is required for the current pilot.</p>
              <Link to="/import" className="inline-flex font-medium text-crx-green hover:underline">
                Import a reviewed CSV export
              </Link>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <DataState loading={loading} error={error}>
      <div className="crx-app min-h-screen">
      <div className="page-enter p-6 max-w-3xl mx-auto space-y-6">
        <DesktopConnectorBanner />

        {!downloadsConfigured && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Installers are listed below, but direct download requires server configuration. If a link fails,
            sign in and use <Link to="/import" className="underline font-medium">Import CSV</Link> or{' '}
            <Link to="/admin/sync" className="underline font-medium">Admin → Sync ops</Link>, or email{' '}
            <a href="mailto:support@collectrx.ca" className="underline font-medium">support@collectrx.ca</a> for the
            Windows installer.
          </div>
        )}

        <header className="flex items-start gap-4">
          <CollectRxLogoMark size={48} />
          <div>
            <h1 className="page-title">CollectRx desktop</h1>
            <p className="page-subtitle">
              Run CollectRx from your taskbar on Windows. Same app as the website, with an alert that
              reaches you even when the window is minimized.
            </p>
          </div>
        </header>

        <Card>
          <CardHeader
            title={`Download v${info.version}`}
            subtitle={
              info.publishedAt
                ? `Published ${new Date(info.publishedAt).toLocaleDateString()}`
                : 'Installers are published on GitHub Releases'
            }
          />
          <div className="px-4 pb-4 grid gap-3 sm:grid-cols-2">
            {info.assets.map((asset) => {
              const rec = platformBadge(asset.platform, recommended)
              return (
                <a
                  key={asset.platform}
                  href={asset.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl border border-crx-bdr bg-crx-bg2 p-4 hover:border-crx-green transition-colors"
                >
                  <div className="font-medium text-crx-900">{asset.label}</div>
                  <div className="text-xs text-crx-t3 mt-1">{asset.fileName}</div>
                  {asset.sizeBytes ? (
                    <div className="text-xs text-crx-t3">{formatBytes(asset.sizeBytes)}</div>
                  ) : null}
                  {rec && <div className="text-2xs text-crx-green mt-2 font-medium">{rec}</div>}
                </a>
              )
            })}
          </div>
          <div className="px-4 pb-4 flex flex-wrap gap-3">
            <a
              href={info.releasePageUrl || DESKTOP_RELEASES_PAGE}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center font-medium text-sm px-4 py-2 rounded-lg bg-crx-500 text-white hover:bg-crx-600"
            >
              All releases on GitHub
            </a>
            <Link to="/guide" className="inline-flex items-center text-sm px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">
              Setup guide
            </Link>
          </div>
        </Card>

        <Card>
          <CardHeader title="What the desktop app does" />
          <ul className="px-4 pb-4 text-sm text-crx-t2 space-y-2 list-disc list-inside">
            <li>Opens your practice dashboard at <code className="text-xs">www.collectrx.ca</code> in a focused window.</li>
            <li>Alerts you the moment a carrier rep is on the line, even when the window is minimized.</li>
            <li>Minimizes to the system tray — double-click the tray icon to reopen.</li>
            <li>Auto-updates when you publish a new GitHub release (packaged builds only).</li>
          </ul>
        </Card>

        <Card>
          <CardHeader title="Windows setup" subtitle="Works with any practice management system" />
          <ol className="px-4 pb-4 text-sm text-crx-t2 space-y-2 list-decimal list-inside">
            <li>Run the installer and sign in with your CollectRx account.</li>
            <li>Import claims from any PMS with a CSV export under Import CSV.</li>
            <li>Leave the app running in the system tray so handoff alerts reach you.</li>
          </ol>
        </Card>
      </div>
      </div>
    </DataState>
  )
}
