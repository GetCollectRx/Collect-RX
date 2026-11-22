import { describe, expect, it } from 'vitest'
import { defaultPracticeSettings } from '../server/services/practiceSettingsService'
import { defaultStaffedHours } from './staffedHours'
import { canEditPracticeSetup, pickOwnerSetupSettings } from './practiceSetupAccess'

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

describe('pickOwnerSetupSettings', () => {
  it('sends exactly the owner-editable fields', () => {
    const settings = {
      ...defaultPracticeSettings(),
      callWindowStart: '09:00',
      callWindowEnd: '16:30',
      escalationPhoneNumber: '+16135550100',
      voiceAgentEnabled: true,
    }
    const picked = pickOwnerSetupSettings(settings)
    expect(Object.keys(picked).sort()).toEqual([
      'callWindowEnd',
      'callWindowStart',
      'carrierConfigs',
      'designatedIndividualUserId',
      'escalationPhoneNumber',
      'staffedHours',
      'voiceAgentEnabled',
    ])
    expect(picked).toMatchObject({
      callWindowStart: '09:00',
      callWindowEnd: '16:30',
      escalationPhoneNumber: '+16135550100',
      voiceAgentEnabled: true,
    })
  })

  it('leaves out settings the owner cannot change', () => {
    const picked = pickOwnerSetupSettings({
      ...defaultPracticeSettings(),
      humanAssistedMode: false,
      emailsEnabled: false,
      automationEnabled: false,
      sendFromPracticeEmail: true,
    })
    for (const locked of ['humanAssistedMode', 'emailsEnabled', 'automationEnabled', 'sendFromPracticeEmail']) {
      expect(picked).not.toHaveProperty(locked)
    }
  })

  it('carries the entered provider numbers and leaves every other carrier field as loaded', () => {
    const base = defaultPracticeSettings()
    const [first, ...rest] = base.carrierConfigs
    const picked = pickOwnerSetupSettings({
      ...base,
      carrierConfigs: [{ ...first, providerNumber: 'ON-123456' }, ...rest],
    })
    expect(picked.carrierConfigs[0]).toEqual({ ...first, providerNumber: 'ON-123456' })
    expect(picked.carrierConfigs.slice(1)).toEqual(rest)
  })
})

describe('pickOwnerSetupSettings staffed hours and designated individual', () => {
  it('carries the staffed hours and the designated individual the owner chose', () => {
    const staffedHours = defaultStaffedHours()
    staffedHours.mon = { open: true, start: '07:00', end: '19:00' }
    const picked = pickOwnerSetupSettings({
      ...defaultPracticeSettings(),
      staffedHours,
      designatedIndividualUserId: 'user-1',
    })
    expect(picked.staffedHours).toEqual(staffedHours)
    expect(picked.designatedIndividualUserId).toBe('user-1')
  })

  it('sends an empty string to clear the designated individual, which survives JSON', () => {
    const picked = pickOwnerSetupSettings({ ...defaultPracticeSettings(), designatedIndividualUserId: '' })
    expect(JSON.parse(JSON.stringify(picked)).designatedIndividualUserId).toBe('')
  })

  it('leaves both out of the request when the practice never set them', () => {
    const body = JSON.parse(JSON.stringify(pickOwnerSetupSettings(defaultPracticeSettings())))
    expect(body).not.toHaveProperty('staffedHours')
    expect(body).not.toHaveProperty('designatedIndividualUserId')
  })
})
