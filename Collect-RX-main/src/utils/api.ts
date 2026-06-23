import { resolveApiUrl } from '../lib/resolveApiUrl'

/**
 * Central API helper — `/api/...` (same origin or VITE_API_ORIGIN in dev).
 * In dev: Vite proxies /api → API_PORT or PORT (default 3000).
 * In prod: same host as the SPA unless VITE_API_ORIGIN is set at build time.
 *
 * All requests use `credentials: 'include'` for httpOnly session cookies.
 */
export const apiCredentials: RequestCredentials = 'include'

export async function apiFetch<T = unknown>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const rel = path.startsWith('/') ? path : `/${path}`
  const url = resolveApiUrl(rel)
  const res = await fetch(url, { credentials: apiCredentials, ...options })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export const api = {
  get: <T = unknown>(path: string) => apiFetch<T>(path),
  post: <T = unknown>(path: string, body: unknown) =>
    apiFetch<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  put: <T = unknown>(path: string, body: unknown) =>
    apiFetch<T>(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
}
