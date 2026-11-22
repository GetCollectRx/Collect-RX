import { describe, expect, it } from 'vitest'
import { canEditPracticeSetup } from './practiceSetupAccess'

describe('canEditPracticeSetup', () => {
  it('lets the practice owner set up the call window and escalation phone even though the owner role is read-only', () => {
    expect(canEditPracticeSetup('practice_owner', true)).toBe(true)
  })

  it('lets operators edit, since they are not read-only', () => {
    expect(canEditPracticeSetup('office_manager', false)).toBe(true)
    expect(canEditPracticeSetup('billing_coordinator', false)).toBe(true)
    expect(canEditPracticeSetup('platform_dev', false)).toBe(true)
  })

  it('keeps read-only roles other than the owner locked out', () => {
    expect(canEditPracticeSetup('accountant', true)).toBe(false)
    expect(canEditPracticeSetup('associate_dentist', true)).toBe(false)
  })

  it('denies a session whose role is not known yet', () => {
    expect(canEditPracticeSetup(null, true)).toBe(false)
  })
})
