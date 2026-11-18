import { describe, expect, it } from 'vitest'
import type { Request } from 'express'
import { loginLimiterKey } from '../src/server/middleware/rateLimiter.js'

function req(email: unknown, ip: string, path = '/login'): Request {
  return { body: { email }, ip, baseUrl: '/api/auth', path } as unknown as Request
}

describe('loginLimiterKey', () => {
  it('is identical for the same account from different IP addresses', () => {
    expect(loginLimiterKey(req('a@x.test', '203.0.113.1'))).toBe(loginLimiterKey(req('a@x.test', '198.51.100.9')))
  })

  it('differs between accounts from the same IP address', () => {
    expect(loginLimiterKey(req('a@x.test', '203.0.113.1'))).not.toBe(loginLimiterKey(req('b@x.test', '203.0.113.1')))
  })

  it('ignores email case and surrounding spaces', () => {
    expect(loginLimiterKey(req(' A@X.test ', '203.0.113.1'))).toBe(loginLimiterKey(req('a@x.test', '203.0.113.1')))
  })

  it('contains neither the IP address nor the raw email', () => {
    const key = loginLimiterKey(req('a@x.test', '203.0.113.1'))
    expect(key).not.toContain('203.0.113.1')
    expect(key).not.toContain('a@x.test')
  })

  it('keeps routes separate and handles a missing email', () => {
    expect(loginLimiterKey(req('a@x.test', '1.1.1.1', '/login'))).not.toBe(loginLimiterKey(req('a@x.test', '1.1.1.1', '/login/platform-dev')))
    expect(loginLimiterKey(req(undefined, '1.1.1.1'))).toMatch(/\|none$/)
  })
})
