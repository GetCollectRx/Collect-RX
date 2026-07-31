/** Marketing / legal routes served outside the practice app shell. */
const PUBLIC_APP_PREFIXES = [
  '/legal',
  '/product',
  '/changelog',
  '/reset-password',
  '/signup',
  '/accept-invite',
  '/demo',
  '/landing',
  '/how-it-works',
  '/roi',
  '/pricing',
  '/features',
  '/carriers',
  '/compliance',
  '/about',
  '/download',
  '/resources',
]

/**
 * True when an anonymous visitor should sign in (not see the marketing landing page).
 */
export function pathRequiresAuth(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/login') return false
  if (path === '/' || path === '/landing') return false
  return !PUBLIC_APP_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

export const LOGIN_REDIRECT_KEY = 'crx_login_redirect'

export function storeLoginRedirect(pathname: string, search = ''): void {
  const target = `${pathname}${search}`
  if (!target.startsWith('/') || target.startsWith('//') || target === '/login') return
  try {
    sessionStorage.setItem(LOGIN_REDIRECT_KEY, target)
  } catch {
    /* ignore */
  }
}

export function consumeLoginRedirect(): string | null {
  try {
    const raw = sessionStorage.getItem(LOGIN_REDIRECT_KEY)
    sessionStorage.removeItem(LOGIN_REDIRECT_KEY)
    if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw === '/login') return null
    return raw
  } catch {
    return null
  }
}
