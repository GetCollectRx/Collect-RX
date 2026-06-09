import { describe, it, expect } from 'vitest'

/**
 * P2-09: minimal CI test — expand with real unit tests over time.
 */
describe('server smoke', () => {
  it('asserts the test runner is wired', () => {
    expect(true).toBe(true)
  })
})
