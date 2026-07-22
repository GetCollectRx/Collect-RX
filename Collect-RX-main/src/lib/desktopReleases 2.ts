export type DesktopPlatform = 'mac-arm64' | 'mac-x64' | 'windows' | 'linux' | 'unknown'

export interface DesktopReleaseAsset {
  platform: DesktopPlatform
  label: string
  fileName: string
  downloadUrl: string
  sizeBytes?: number
}

export interface DesktopReleaseInfo {
  version: string
  publishedAt: string | null
  releasePageUrl: string
  assets: DesktopReleaseAsset[]
}

export const DESKTOP_RELEASES_PAGE =
  'https://github.com/GetCollectRx/Collect-RX/releases/tag/v1.0.0-pilot'

export const PILOT_RELEASE_TAG = 'v1.0.0-pilot'

/** Proxied download — works when GitHub repo/releases are private. */
export function proxyDesktopAssetUrl(fileName: string): string {
  return `/api/desktop/releases/assets/${encodeURIComponent(fileName)}`
}

const ASSET_PATTERNS: { platform: DesktopPlatform; label: string; test: (name: string) => boolean }[] = [
  { platform: 'mac-arm64', label: 'macOS (Apple Silicon)', test: (n) => /arm64.*\.zip$/i.test(n) },
  {
    platform: 'mac-x64',
    label: 'macOS (Intel)',
    test: (n) => /\.zip$/i.test(n) && /mac/i.test(n) && !/arm64/i.test(n),
  },
  {
    platform: 'windows',
    label: 'Windows installer',
    test: (n) => /setup.*\.exe$/i.test(n) || /^CollectRx\.Setup\./i.test(n),
  },
  { platform: 'linux', label: 'Linux (AppImage)', test: (n) => /\.AppImage$/i.test(n) },
]

const PILOT_ASSET_FILES: { platform: DesktopPlatform; label: string; fileName: string }[] = [
  { platform: 'windows', label: 'Windows installer', fileName: 'CollectRx.Setup.1.0.0.exe' },
  { platform: 'mac-arm64', label: 'macOS (Apple Silicon)', fileName: 'CollectRx-1.0.0-arm64-mac.zip' },
  { platform: 'mac-x64', label: 'macOS (Intel)', fileName: 'CollectRx-1.0.0-mac.zip' },
  { platform: 'linux', label: 'Linux (AppImage)', fileName: 'CollectRx-1.0.0.AppImage' },
]

/** Pinned pilot manifest when GitHub API is unavailable — links use CollectRx proxy URLs. */
export const PILOT_DESKTOP_RELEASE: DesktopReleaseInfo = {
  version: '1.0.0-pilot',
  publishedAt: '2026-07-09T00:03:17.000Z',
  releasePageUrl: DESKTOP_RELEASES_PAGE,
  assets: PILOT_ASSET_FILES.map((a) => ({
    platform: a.platform,
    label: a.label,
    fileName: a.fileName,
    downloadUrl: proxyDesktopAssetUrl(a.fileName),
  })),
}

function detectUserPlatform(): DesktopPlatform {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent
  const platform = navigator.platform || ''
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'windows'
  if (/Mac/i.test(platform)) {
    // Apple Silicon Macs often report MacIntel; use WebGL heuristic when available.
    try {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl')
      const debug = gl?.getExtension('WEBGL_debug_renderer_info') as {
        UNMASKED_RENDERER_WEBGL: number
      } | null
      const renderer = debug ? gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL) : ''
      if (typeof renderer === 'string' && /Apple M/i.test(renderer)) return 'mac-arm64'
    } catch {
      /* ignore */
    }
    return 'mac-x64'
  }
  if (/Linux/i.test(platform) || /Linux/i.test(ua)) return 'linux'
  return 'unknown'
}

export function getRecommendedPlatform(): DesktopPlatform {
  return detectUserPlatform()
}

export async function fetchDesktopReleases(): Promise<{
  info: DesktopReleaseInfo
  downloadsConfigured: boolean
} | null> {
  try {
    const res = await fetch('/api/desktop/releases')
    if (!res.ok) return null
    const json = (await res.json()) as {
      success?: boolean
      data?: DesktopReleaseInfo
      downloadsConfigured?: boolean
    }
    if (!json.success || !json.data) return null
    return {
      info: json.data,
      downloadsConfigured: json.downloadsConfigured !== false,
    }
  } catch {
    return null
  }
}

export function fallbackDesktopReleaseInfo(): DesktopReleaseInfo {
  return PILOT_DESKTOP_RELEASE
}

export function parseGithubReleaseAssets(
  version: string,
  publishedAt: string | null,
  releasePageUrl: string,
  assets: { name: string; browser_download_url: string; size?: number }[],
): DesktopReleaseInfo {
  const mapped: DesktopReleaseAsset[] = []
  for (const pattern of ASSET_PATTERNS) {
    const hit = assets.find((a) => pattern.test(a.name))
    if (hit) {
      mapped.push({
        platform: pattern.platform,
        label: pattern.label,
        fileName: hit.name,
        downloadUrl: hit.browser_download_url,
        sizeBytes: hit.size,
      })
    }
  }
  return { version, publishedAt, releasePageUrl, assets: mapped }
}
