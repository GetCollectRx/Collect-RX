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
