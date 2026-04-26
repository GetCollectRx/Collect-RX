/**
 * Central API helper — always uses the Vite proxy path (/api/...)
 * In dev: Vite proxies /api → http://localhost:3000
 * In prod: Electron loads the Railway URL directly, same /api path
 *
 * All requests use `credentials: 'include'` for httpOnly session cookies.
 */
export const apiCredentials: RequestCredentials = 'include'

export async function apiFetch<T = unknown>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = path.startsWith('/') ? path : `/${path}`
  const res = await fetch(url, { credentials: apiCredentials, ...options })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as any).error ?? res.statusText)
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
