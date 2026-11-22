import type { DeskHandoffRequest } from '../types/ws'

export type HandoffAlert = DeskHandoffRequest

export type HandoffAlertAction =
  | { type: 'requested'; alert: HandoffAlert }
  | { type: 'acknowledged' }
  | { type: 'expired'; requestedAt: string }

/** An alert nobody acknowledged is dropped after this long, so a stale one never lingers on screen. */
export const HANDOFF_ALERT_TTL_MS = 15 * 60_000

/** Shown in the browser tab while an alert is up, so it is noticed from another tab or window. */
export const HANDOFF_TAB_TITLE = '(!) Rep on the line: pick up'

export function handoffAlertReducer(state: HandoffAlert | null, action: HandoffAlertAction): HandoffAlert | null {
  switch (action.type) {
    case 'requested':
      // A newer rep replaces an older unacknowledged alert: the newest call is the live one.
      return action.alert
    case 'acknowledged':
      return null
    case 'expired':
      // Only the alert that timed out is dropped, never a newer one that replaced it.
      return state && state.requestedAt === action.requestedAt ? null : state
  }
}

/** sun_life becomes Sun Life; null when the carrier is not known. */
export function carrierDisplayName(carrierId: string | null): string | null {
  if (!carrierId) return null
  return carrierId
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export interface HandoffAlertText {
  headline: string
  instruction: string
  meta: string
}

export function describeHandoffAlert(alert: HandoffAlert): HandoffAlertText {
  const carrier = carrierDisplayName(alert.carrierId)
  const meta = [
    alert.claimNumber ? `Claim ${alert.claimNumber}` : null,
    alert.outstandingAmount !== null ? `$${alert.outstandingAmount.toFixed(2)}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
  return {
    headline: `${carrier ?? 'A carrier'} rep is on the line`,
    instruction: alert.designatedName
      ? `Pick up your phone now, ${alert.designatedName}. The call is transferring to you.`
      : 'Pick up the phone now. The call is transferring to the office.',
    meta,
  }
}
