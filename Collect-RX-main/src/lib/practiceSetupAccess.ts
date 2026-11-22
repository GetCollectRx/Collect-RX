import type { AuthRole } from './authTypes'

/**
 * Who may edit the settings a practice needs before a Hold Sentinel call can
 * reach its staff: the call window and the escalation phone.
 *
 * The practice owner is the account created at signup, so it has to be able to
 * set these itself. Every other setting stays read-only for the owner role;
 * operators (office manager, billing coordinator, platform dev) already edit
 * everything, and read-only roles such as the accountant cannot edit anything.
 */
export function canEditPracticeSetup(role: AuthRole | null, isReadOnly: boolean): boolean {
  return !isReadOnly || role === 'practice_owner'
}
