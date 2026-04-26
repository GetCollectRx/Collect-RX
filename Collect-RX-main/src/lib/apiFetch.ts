/**
 * Shared fetch for authenticated API calls — dispatches session expiry on 401.
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: 'include' }).then((r) => {
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
