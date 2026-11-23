import { describe, expect, it } from 'vitest'
import {
  carrierDisplayName,
  describeHandoffAlert,
  handoffAlertReducer,
  type HandoffAlert,
} from './handoffAlert'

function alert(overrides: Partial<HandoffAlert> = {}): HandoffAlert {
  return {
    callId: 'call-1',
    claimNumber: 'CLM-42',
    carrierId: 'sun_life',
    outstandingAmount: 300,
    designatedName: 'Dana Reyes',
    requestedAt: '2026-11-23T15:00:00.000Z',
    ...overrides,
  }
}

describe('handoffAlertReducer', () => {
  it('shows an alert when a rep answers', () => {
    expect(handoffAlertReducer(null, { type: 'requested', alert: alert() })).toEqual(alert())
  })

  it('clears the alert when staff acknowledge it', () => {
    expect(handoffAlertReducer(alert(), { type: 'acknowledged' })).toBeNull()
  })

  it('replaces an unacknowledged alert with the newer one', () => {
    const newer = alert({ callId: 'call-2', requestedAt: '2026-11-23T15:05:00.000Z' })
    expect(handoffAlertReducer(alert(), { type: 'requested', alert: newer })).toEqual(newer)
  })

  it('drops an alert that timed out', () => {
    expect(handoffAlertReducer(alert(), { type: 'expired', requestedAt: alert().requestedAt })).toBeNull()
  })

  it('does not let an old timeout dismiss a newer alert', () => {
    const newer = alert({ requestedAt: '2026-11-23T15:05:00.000Z' })
    expect(handoffAlertReducer(newer, { type: 'expired', requestedAt: alert().requestedAt })).toEqual(newer)
  })

  it('ignores a timeout when there is no alert', () => {
    expect(handoffAlertReducer(null, { type: 'expired', requestedAt: alert().requestedAt })).toBeNull()
  })
})

describe('describeHandoffAlert', () => {
  it('names the carrier, the claim and the amount, and tells the designated person to pick up', () => {
    expect(describeHandoffAlert(alert())).toEqual({
      headline: 'Sun Life rep is on the line',
      instruction: 'Pick up your phone now, Dana Reyes. The call is transferring to you.',
      meta: 'Claim CLM-42 · $300.00',
    })
  })

  it('still reads clearly when nothing is known beyond the call', () => {
    expect(
      describeHandoffAlert(alert({ carrierId: null, claimNumber: null, outstandingAmount: null, designatedName: null })),
    ).toEqual({
      headline: 'A carrier rep is on the line',
      instruction: 'Pick up the phone now. The call is transferring to the office.',
      meta: '',
    })
  })
})

describe('carrierDisplayName', () => {
  it('turns carrier ids into readable names', () => {
    expect(carrierDisplayName('green_shield')).toBe('Green Shield')
    expect(carrierDisplayName('telus_adjudicare')).toBe('Telus Adjudicare')
    expect(carrierDisplayName(null)).toBeNull()
  })
})
