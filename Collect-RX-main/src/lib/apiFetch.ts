import { resolveApiUrl } from './resolveApiUrl'
import { parseApiJson } from './parseApiJson'

function withApiOrigin(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === 'string') {
    const t = input.trim()
    if (t.startsWith('/api')) return resolveApiUrl(t)
  }
  return input
}

/**
 * Shared fetch for authenticated API calls — dispatches session expiry on 401.
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(withApiOrigin(input), { ...init, credentials: 'include' }).then((r) => {
    if (r.status === 401) {
      try {
        sessionStorage.setItem('crx_session_lapse', '1');
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new CustomEvent('crx:session-expired', { detail: { url: String(input) } }));
    }
    return r;
  });
}

/**
 * apiFetch + JSON body. Throws with a clear message if the response is HTML (mis-routed /api).
 */
export async function apiFetchJson<T = unknown>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const r = await apiFetch(input, init)
  const data = await parseApiJson<T>(r)
  if (!r.ok) {
    const msg =
      typeof data === 'object' && data !== null && 'error' in data && typeof (data as { error?: string }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${r.status})`
    throw new Error(msg)
  }
  return data
}
