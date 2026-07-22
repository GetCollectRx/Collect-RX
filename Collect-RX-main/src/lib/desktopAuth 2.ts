const STORAGE_KEY = 'crx_desktop_session_token'

export function isDesktopClient(): boolean {
  return import.meta.env.VITE_APP_SURFACE === 'desktop'
}

export function getDesktopSessionToken(): string | null {
  if (!isDesktopClient()) return null
  try {
    const t = sessionStorage.getItem(STORAGE_KEY)
    return t && t.trim() ? t.trim() : null
  } catch {
    return null
  }
}

export function setDesktopSessionToken(token: string | null | undefined): void {
  if (!isDesktopClient()) return
  try {
    if (!token?.trim()) sessionStorage.removeItem(STORAGE_KEY)
    else sessionStorage.setItem(STORAGE_KEY, token.trim())
  } catch {
    /* ignore */
  }
}

export function desktopAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  if (isDesktopClient()) headers['X-CRX-Desktop'] = '1'
  const token = getDesktopSessionToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}
