/**
 * Optional absolute API origin (no trailing slash).
 * Precedence: Electron `collectrx.apiOrigin` (COLLECTRX_API_ORIGIN), unless it is loopback while the
 *   page is remote HTTPS (then ignored) →
 * `<meta name="crx-public-api-origin">` (PUBLIC_API_BASE_URL / VITE_API_ORIGIN) →
 * `VITE_API_ORIGIN` (build-time) → **CollectRx public-site fallback** (see below) → same-origin `/api/...`.
 *
 * **Dev on localhost:** If `VITE_API_ORIGIN` points at a remote host, the browser still loads the app
 * from `http://localhost:5173`. Auth cookies are `SameSite=Lax` on the API host, so they are **not**
 * sent on cross-site `fetch` — every `/api/*` call returns 401 and `apiFetch` logs the user out.
 * In Vite **dev** over `http:` or `https:` we always use same-origin `/api` (proxied to the local
 * Express port) unless `VITE_DEV_ALLOW_REMOTE_API=true`. Otherwise any dev hostname (LAN IP,
 * `.local`, Tailscale, etc.) would skip the proxy, follow `VITE_API_ORIGIN` / meta → cross-site
 * `fetch` → `SameSite=Lax` cookies not sent → 401 and logout. Non-http(s) pages (`file://`, custom
 * protocols) keep absolute resolution from Electron / meta / `VITE_API_ORIGIN`.
 *
 * Public marketing host (www.collectrx.ca) often serves only static HTML; `/api` there is not JSON.
 * When no origin is configured, production builds on collectrx.ca default to the canonical app URL used
 * across this repo (override with VITE_API_ORIGIN or meta if your API lives elsewhere).
 */
const COLLECTRX_DEFAULT_API_ORIGIN = 'https://www.collectrx.ca'

/** Use Vite `/api` proxy in dev so httpOnly cookies stay same-site (see module comment). */
function useLocalViteApiProxy(): boolean {
  if (typeof window === 'undefined') return false
  if (!import.meta.env.DEV) return false
  const allow =
    import.meta.env.VITE_DEV_ALLOW_REMOTE_API === 'true' ||
    import.meta.env.VITE_DEV_ALLOW_REMOTE_API === '1'
  if (allow) return false
  const { protocol } = window.location
  if (protocol !== 'http:' && protocol !== 'https:') return false
  return true
}

function metaApiOrigin(): string {
  if (typeof document === 'undefined') return ''
  const el = document.querySelector('meta[name="crx-public-api-origin"]')
  const v = el?.getAttribute('content')?.trim().replace(/\/$/, '')
  if (v && /^https?:\/\//i.test(v)) return v
  return ''
}

function electronApiOrigin(): string {
  if (typeof window === 'undefined') return ''
  const crx = (window as Window & { collectrx?: { apiOrigin?: string } }).collectrx
  const o = crx?.apiOrigin?.trim()
  return o ? o.replace(/\/$/, '') : ''
}

/** Loopback API origin from preload is invalid for https://www… (mixed content + wrong host). */
function effectiveElectronApiOrigin(): string {
  const o = electronApiOrigin()
  if (!o || typeof window === 'undefined') return o
  try {
    const { protocol, hostname } = window.location
    if (protocol !== 'https:' && protocol !== 'http:') return o
    if (hostname === 'localhost' || hostname === '127.0.0.1') return o
    const u = new URL(o)
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return ''
  } catch {
    return o
  }
  return o
}

const viteOrigin = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.replace(/\/$/, '') ?? ''

/** When the SPA is on collectrx.ca but Express is on another host, avoid same-origin /api → HTML. */
function inferredCollectRxApiOrigin(): string {
  if (typeof window === 'undefined' || import.meta.env.DEV) return ''
  const host = window.location.hostname.replace(/^www\./i, '')
  if (host !== 'collectrx.ca') return ''
  return COLLECTRX_DEFAULT_API_ORIGIN
}

export function resolveApiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  if (useLocalViteApiProxy()) return p
  const origin =
    effectiveElectronApiOrigin() || metaApiOrigin() || viteOrigin || inferredCollectRxApiOrigin()
  if (!origin) return p
  return `${origin}${p}`
}
