import { describe, it, expect } from 'vitest'
import { redactString } from '../src/server/observability/logger.js'

describe('P6-01 redact', () => {
  it('redacts email-like substrings', () => {
    expect(redactString('Contact jane@example.com please')).toMatch(/\[redacted:email\]/)
  })
  it('redacts N. American phone-like patterns', () => {
    expect(redactString('Call 555-123-4567 today')).toMatch(/\[redacted:phone\]/)
  })
})
