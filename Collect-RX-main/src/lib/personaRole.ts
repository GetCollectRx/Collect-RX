import type { AuthRole, PracticeRole } from './authTypes'
import type { UserRole } from '../types/userRole'

export function authRoleToBriefPersona(role: AuthRole | null): UserRole | null {
  if (!role) return null
  if (role === 'platform_dev') return 'platform_admin'
  return practiceRoleToBriefPersona(role)
}

export function practiceRoleToBriefPersona(role: PracticeRole): UserRole {
  switch (role) {
    case 'front_desk':
      return 'front_desk'
    case 'practice_owner':
      return 'practice_owner'
    case 'accountant':
      return 'auditor'
    case 'group_admin':
      return 'billing_ops_manager'
    case 'office_manager':
    case 'billing_coordinator':
    case 'associate_dentist':
      return 'practice_owner'
    default:
      return 'practice_owner'
  }
}

/**
 * Practice-user group admins (sessionUser present) home on the PHI-free
 * GroupDashboard. Platform billing-ops/admin sessions also carry the legacy
 * shim role 'group_admin' but have no sessionUser — they keep the
 * billing-ops persona home (/portfolio), whose APIs accept their JWT.
 */
export function isPracticeGroupAdmin(role: string | null, sessionUser: unknown): boolean {
  return role === 'group_admin' && sessionUser != null
}
