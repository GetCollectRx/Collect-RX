import type { AuthRole } from './authTypes'
import type { PracticeSettings } from '../types/practiceSettings'

/**
 * Who may edit the settings a practice needs before a Hold Sentinel call can
 * reach its staff and a carrier will accept the call: the call window, who takes
 * the call and the staffed hours, the voice agent switch, and the provider number
 * per carrier.
 *
 * The practice owner is the account created at signup, so it has to be able to
 * set these itself. Every other setting stays read-only for the owner role;
 * operators (office manager, billing coordinator, platform dev) already edit
 * everything, and read-only roles such as the accountant cannot edit anything.
 */
export function canEditPracticeSetup(role: AuthRole | null, isReadOnly: boolean): boolean {
  return !isReadOnly || role === 'practice_owner'
}

/** The only settings the owner-level "Save setup" button may send. */
export type OwnerSetupSettings = Pick<
  PracticeSettings,
  | 'callWindowStart'
  | 'callWindowEnd'
  | 'escalationPhoneNumber'
  | 'staffedHours'
  | 'designatedIndividualUserId'
  | 'voiceAgentEnabled'
  | 'carrierConfigs'
>

/**
 * Picks exactly the owner-editable fields, so nothing else in the loaded
 * settings (carrier toggles, human-assisted mode, email switches) can ride
 * along in an owner's save. carrierConfigs goes as a whole because the server
 * replaces it as a whole; the page only unlocks the provider number inputs
 * for the owner, so the other carrier fields are sent back unchanged.
 */
export function pickOwnerSetupSettings(settings: PracticeSettings): OwnerSetupSettings {
  return {
    callWindowStart: settings.callWindowStart,
    callWindowEnd: settings.callWindowEnd,
    escalationPhoneNumber: settings.escalationPhoneNumber,
    staffedHours: settings.staffedHours,
    designatedIndividualUserId: settings.designatedIndividualUserId,
    voiceAgentEnabled: settings.voiceAgentEnabled,
    carrierConfigs: settings.carrierConfigs,
  }
}
