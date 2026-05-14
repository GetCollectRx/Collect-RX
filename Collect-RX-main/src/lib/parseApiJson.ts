/**
 * Parse JSON from an API response. Fails with a clear message when the body is HTML
 * (CDN/static host serving index.html for /api, or wrong PUBLIC_API_BASE_URL / proxy).
 */
export async function parseApiJson<T = unknown>(r: Response): Promise<T> {
  const raw = await r.text()
  const t = raw.trimStart()
  if (t.startsWith('<') || t.startsWith('<!')) {
    throw new Error(
      'The server returned a web page instead of API JSON. Configure PUBLIC_API_BASE_URL on the API ' +
        'host (see .env.example), or set VITE_API_ORIGIN / COLLECTRX_API_ORIGIN so /api hits your Express server.'
    )
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`Invalid JSON from API (${r.status})`)
  }
}
