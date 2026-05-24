/** CollectRx platform personas — authoritative role enum per build brief. */
export type UserRole =
  | 'front_desk'
  | 'practice_owner'
  | 'auditor'
  | 'billing_ops_manager'
  | 'platform_admin';

export const HOME_ROUTE: Record<UserRole, string> = {
  front_desk: '/console',
  practice_owner: '/dashboard',
  auditor: '/reports/aging',
  billing_ops_manager: '/portfolio',
  platform_admin: '/admin',
};

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  front_desk: 'Front Desk',
  practice_owner: 'Practice Owner',
  auditor: 'Auditor',
  billing_ops_manager: 'Billing Ops',
  platform_admin: 'Platform Admin',
};

export function isCrossPracticeRole(role: UserRole): boolean {
  return role === 'billing_ops_manager' || role === 'platform_admin';
}

export function isReadOnlyRole(role: UserRole): boolean {
  return role === 'auditor';
}

export function practiceScopedRole(role: UserRole): boolean {
  return role === 'front_desk' || role === 'practice_owner';
}
