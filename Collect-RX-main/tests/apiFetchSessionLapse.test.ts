import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function stubBrowser(responseStatus: number, body: unknown) {
  const store = new Map<string, string>()
  const events: string[] = []
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  vi.stubGlobal('window', {
    location: { origin: 'http://localhost', hostname: 'localhost' },
    dispatchEvent: (e: Event) => void events.push(e.type),
  })
  vi.stubGlobal('CustomEvent', class { type: string; constructor(t: string) { this.type = t } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: responseStatus, headers: { 'content-type': 'application/json' } })),
  )
  return { store, events }
}

describe('apiFetch records why a session ended', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  it('stores path and server reason, never the query string, and still signs out', async () => {
    const { store, events } = stubBrowser(401, { error: 'Account is no longer active' })
    const { apiFetch } = await import('../src/lib/apiFetch')
    const r = await apiFetch('/api/insurance/claims?patient=Jane%20Doe')
    expect(r.status).toBe(401)
    expect(store.get('crx_session_lapse')).toBe('1')
    expect(store.get('crx_session_lapse_detail')).toBe('/api/insurance/claims: Account is no longer active')
    expect(store.get('crx_session_lapse_detail')).not.toContain('Jane')
    expect(events).toContain('crx:session-expired')
  })

  it('does not treat a wrong-password login as a session lapse', async () => {
    const { store, events } = stubBrowser(401, { error: 'Invalid credentials' })
    const { apiFetch } = await import('../src/lib/apiFetch')
    await apiFetch('/api/auth/login', { method: 'POST' })
    expect(store.get('crx_session_lapse')).toBeUndefined()
    expect(events).toEqual([])
  })

  it('still signs out when the 401 body is not JSON', async () => {
    const { store, events } = stubBrowser(401, 'nope')
    const { apiFetch } = await import('../src/lib/apiFetch')
    await apiFetch('/api/auth/me')
    expect(store.get('crx_session_lapse_detail')).toBeTruthy()
    expect(events).toContain('crx:session-expired')
  })
})
