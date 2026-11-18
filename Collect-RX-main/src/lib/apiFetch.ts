import { resolveApiUrl } from './resolveApiUrl'
import { parseApiJson } from './parseApiJson'
import { practiceScopedFetchInit, practiceScopedUrl } from './practiceScopedApi'
import { desktopAuthHeaders } from './desktopAuth'

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
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function retryAfterMs(res: Response): number {
  const raw = res.headers.get('Retry-After')
  if (!raw) return 1500
  const sec = Number(raw)
  if (Number.isFinite(sec) && sec > 0) return Math.min(sec * 1000, 10_000)
  return 1500
}

function requestUrlString(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url
  return String(input)
}

export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const scopedInit = practiceScopedFetchInit(init) ?? {}
  const authHeaders = desktopAuthHeaders()
  const mergedInit: RequestInit = {
    ...scopedInit,
    credentials: 'include',
    headers: {
      ...(scopedInit.headers instanceof Headers
        ? Object.fromEntries(scopedInit.headers.entries())
        : (scopedInit.headers as Record<string, string> | undefined)),
      ...authHeaders,
    },
  }
  let resolved = input
  if (typeof input === 'string') {
    const t = input.trim()
    if (t.startsWith('/api')) resolved = practiceScopedUrl(t)
  }
  return fetch(withApiOrigin(resolved), mergedInit).then((r) => {
    if (r.status === 401) {
      const url = requestUrlString(input)
      // Wrong-password login returns 401; must not clear an existing session.
      if (url.includes('/api/auth/login')) {
        return r
      }
      if (url.includes('/api/auth/login/platform-dev')) {
        return r
      }
      return describeSessionLapse(r, url).then(() => {
        try {
          sessionStorage.setItem('crx_session_lapse', '1');
        } catch {
          /* ignore */
        }
        window.dispatchEvent(new CustomEvent('crx:session-expired', { detail: { url } }));
        return r;
      });
    }
    return r;
  });
}


/**
 * Records which request ended the session and the server's reason, so the sign-in screen can show it.
 * A silent logout hides the real cause of a sign-in loop. Only the path is kept (no origin, no query
 * string, which can carry patient or claim identifiers) and the server's short error text.
 */
async function describeSessionLapse(r: Response, url: string): Promise<void> {
  try {
    let path = url
    try {
      path = new URL(url, 'http://local.invalid').pathname
    } catch {
      path = url.split('?')[0] ?? url
    }
    let reason = ''
    try {
      const body = (await r.clone().json()) as { error?: unknown }
      if (typeof body?.error === 'string') reason = body.error.slice(0, 120)
    } catch {
      /* body was not JSON */
    }
    sessionStorage.setItem('crx_session_lapse_detail', reason ? `${path}: ${reason}` : path)
  } catch {
    /* storage unavailable */
  }
}

/**
 * apiFetch + JSON body. Throws with a clear message if the response is HTML (mis-routed /api).
 * GET/HEAD requests retry briefly on 429 using Retry-After.
 */
export async function apiFetchJson<T = unknown>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const canRetry = method === 'GET' || method === 'HEAD'
  const maxAttempts = canRetry ? 3 : 1

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await apiFetch(input, init)
    const data = await parseApiJson<T>(r)
    if (r.status === 429 && canRetry && attempt < maxAttempts) {
      await sleep(retryAfterMs(r))
      continue
    }
    if (!r.ok) {
      const msg =
        typeof data === 'object' && data !== null && 'error' in data && typeof (data as { error?: string }).error === 'string'
          ? (data as { error: string }).error
          : `Request failed (${r.status})`
      throw new Error(msg)
    }
    return data
  }

  throw new Error('Request failed after retries')
}
