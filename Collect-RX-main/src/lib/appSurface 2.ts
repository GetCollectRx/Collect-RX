import { COLLECTRX_MARKETING_ORIGIN, COLLECTRX_PROD_APP_ORIGIN } from './collectrxOrigins'

/**
 * Which UI surface this build serves.
 *
 * - full: local dev — marketing + practice app in one SPA
 * - marketing: public website funnel (collectrx.ca)
 * - app: practice command center (collect-rx.fly.dev) — no marketing pages
 * - desktop: legacy alias for `app` (was Electron-only; kept for old builds)
 */
export type AppSurface = 'full' | 'marketing' | 'app' | 'desktop'

function marketingHosts(): Set<string> {
  try {
    return new Set([new URL(COLLECTRX_MARKETING_ORIGIN).hostname.replace(/^www\./i, '')])
  } catch {
    return new Set(['collectrx.ca'])
  }
}

function commandCenterHosts(): Set<string> {
  const hosts = new Set<string>()
  for (const origin of [COLLECTRX_PROD_APP_ORIGIN, 'https://app.collectrx.ca']) {
    try {
      hosts.add(new URL(origin).hostname)
    } catch {
      /* skip */
    }
  }
  return hosts
}

function surfaceFromHostname(): AppSurface | null {
  if (typeof window === 'undefined') return null
  const host = window.location.hostname.replace(/^www\./i, '')
  if (marketingHosts().has(host)) return 'marketing'
  if (commandCenterHosts().has(host)) return 'app'
  return null
}

export function getAppSurface(): AppSurface {
  const fromHost = surfaceFromHostname()
  if (fromHost) return fromHost
  const raw = import.meta.env.VITE_APP_SURFACE
  if (raw === 'marketing') return 'marketing'
  if (raw === 'app' || raw === 'desktop') return 'app'
  return 'full'
}

export const appSurface = getAppSurface()
export const isMarketingSurface = appSurface === 'marketing'
export const isCommandCenterSurface = appSurface === 'app' || appSurface === 'desktop'
/** @deprecated Use isCommandCenterSurface — Electron is not the product shell. */
export const isDesktopSurface = isCommandCenterSurface
export const isFullSurface = appSurface === 'full'
