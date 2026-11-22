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

/** Pages a signed-in person should be moved off: the root and the sign-in page. */
export function isPostAuthEntryPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/'
  return path === '/' || path === '/login'
}

/**
 * Where to send a person once their session is ready. A saved return path is
 * used only from an entry page, so it can never override a page they opened on
 * purpose, such as a direct link to Settings. Null means stay where they are.
 */
export function resolvePostAuthTarget(pathname: string, savedRedirect: string | null, home: string): string | null {
  if (!isPostAuthEntryPath(pathname)) return null
  return savedRedirect ?? home
}
