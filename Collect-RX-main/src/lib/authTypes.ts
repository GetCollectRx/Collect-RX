export type PracticeRole =
  | 'practice_owner'
  | 'office_manager'
  | 'billing_coordinator'
  | 'front_desk'
  | 'associate_dentist'
  | 'accountant'
  | 'group_admin'

export type AuthRole = PracticeRole | 'platform_dev'

export const ROLE_LABELS: Record<PracticeRole, string> = {
  practice_owner: 'Practice Owner',
  office_manager: 'Office Manager',
  billing_coordinator: 'Billing Coordinator',
  front_desk: 'Front Desk',
  associate_dentist: 'Associate Dentist',
  accountant: 'Accountant',
  group_admin: 'Group Admin',
}

export function isPracticeRole(role: AuthRole | null): role is PracticeRole {
  return role !== null && role !== 'platform_dev'
}

export type { UserRole } from '../types/userRole'
export { HOME_ROUTE, isReadOnlyRole } from '../types/userRole'
