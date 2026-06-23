import type { AuthRole } from './authTypes'

let sessionRole: AuthRole | null = null
let platformDevPracticeId: string | null = null

export function configureApiSession(role: AuthRole | null, practiceId: string): void {
  sessionRole = role
  platformDevPracticeId = role === 'platform_dev' && practiceId ? practiceId : null
}

/** Append `practiceId` query for platform developer sessions (server requires context). */
export function practiceScopedUrl(path: string): string {
  if (sessionRole !== 'platform_dev' || !platformDevPracticeId) return path
  const t = path.trim()
  if (!t.startsWith('/api')) return path
  if (t.includes('practiceId=')) return path
  const sep = t.includes('?') ? '&' : '?'
  return `${t}${sep}practiceId=${encodeURIComponent(platformDevPracticeId)}`
}

export function practiceScopedFetchInit(init?: RequestInit): RequestInit | undefined {
  if (sessionRole !== 'platform_dev' || !platformDevPracticeId) return init
  const headers = new Headers(init?.headers)
  if (!headers.has('X-Practice-Id')) {
    headers.set('X-Practice-Id', platformDevPracticeId)
  }
  return { ...init, headers }
}
