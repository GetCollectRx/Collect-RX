import { describe, expect, it } from 'vitest'
import { isPostAuthEntryPath, resolvePostAuthTarget } from './pathRequiresAuth'

describe('isPostAuthEntryPath', () => {
  it('is true for the root and the sign-in page, with or without a trailing slash', () => {
    for (const path of ['/', '', '/login', '/login/']) expect(isPostAuthEntryPath(path)).toBe(true)
  })

  it('is false for every other page', () => {
    for (const path of ['/settings', '/dashboard', '/login-help', '/claims']) expect(isPostAuthEntryPath(path)).toBe(false)
  })
})

describe('resolvePostAuthTarget', () => {
  it('sends a person on the sign-in page to the page they were trying to reach', () => {
    expect(resolvePostAuthTarget('/login', '/claims', '/dashboard')).toBe('/claims')
  })

  it('falls back to the signed-in home when nothing was saved', () => {
    expect(resolvePostAuthTarget('/login', null, '/dashboard')).toBe('/dashboard')
    expect(resolvePostAuthTarget('/', null, '/dashboard')).toBe('/dashboard')
  })

  it('never overrides a page the person opened on purpose with a stale saved path', () => {
    expect(resolvePostAuthTarget('/settings', '/dashboard', '/dashboard')).toBeNull()
  })

  it('leaves a person on a non-entry page alone when nothing was saved', () => {
    expect(resolvePostAuthTarget('/settings', null, '/dashboard')).toBeNull()
  })
})
