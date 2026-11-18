import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'
import { logger } from '../src/server/observability/logger'
import { emailFingerprint, logLoginEvent, logSessionRejected } from '../src/server/observability/authEvents'
import { authenticate } from '../src/server/middleware/authenticate'

afterEach(() => vi.restoreAllMocks())

describe('auth events never leak the email, password, token or query string', () => {
  it('fingerprint is stable, case-insensitive and does not contain the address', () => {
    const a = emailFingerprint('Jane.Doe@Example.com ')
    expect(a).toBe(emailFingerprint('jane.doe@example.com'))
    expect(a).toHaveLength(12)
    expect(a).not.toContain('jane')
  })

  it('login events carry outcome and fingerprint only', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    logLoginEvent('wrong_password', 'jane.doe@example.com')
    logLoginEvent('success', 'jane.doe@example.com')
    const all = JSON.stringify([warn.mock.calls, info.mock.calls])
    expect(all).toContain('wrong_password')
    expect(all).toContain('success')
    expect(all).not.toContain('jane')
    expect(all).not.toContain('example.com')
  })

  it('session rejections log the path without the query string', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const req = { baseUrl: '/api/insurance', path: '/claims?patient=Jane%20Doe', method: 'GET' } as unknown as Request
    logSessionRejected(req, 'user_missing_or_inactive', 'abcdef1234567890')
    const meta = warn.mock.calls[0]![1] as Record<string, unknown>
    expect(meta.path).toBe('/api/insurance/claims')
    expect(meta.reason).toBe('user_missing_or_inactive')
    expect(meta.userIdPrefix).toBe('abcdef12')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Jane')
  })

  it('authenticate logs no_token when a request has no credentials', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const status = vi.fn().mockReturnThis()
    const json = vi.fn()
    const req = { headers: {}, cookies: {}, baseUrl: '/api', path: '/auth/me', method: 'GET' } as unknown as Request
    authenticate(req, { status, json } as unknown as Response, vi.fn())
    expect(status).toHaveBeenCalledWith(401)
    expect(warn.mock.calls[0]![1]).toMatchObject({ reason: 'no_token', path: '/api/auth/me' })
  })
})
