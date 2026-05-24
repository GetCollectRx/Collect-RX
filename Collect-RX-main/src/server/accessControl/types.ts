/** All practice-layer roles. Mirrors the PracticeRole enum in schema.prisma. */
import type { UserRole } from '../../types/userRole.js';

export type PracticeRole =
  | 'practice_owner'
  | 'office_manager'
  | 'billing_coordinator'
  | 'front_desk'
  | 'associate_dentist'
  | 'accountant'
  | 'group_admin';

export const ROLE_LEVEL: Record<PracticeRole | 'platform_dev', number> = {
  platform_dev: 100,
  group_admin: 70,
  practice_owner: 60,
  office_manager: 50,
  billing_coordinator: 30,
  front_desk: 20,
  associate_dentist: 20,
  accountant: 20,
} as const;

export type UserAuthPayload = {
  role: PracticeRole;
  userId: string;
  practiceId: string;
  phiAccess: boolean;
  providerId?: string;
};

export type PlatformDevAuthPayload = {
  role: 'platform_dev';
  phiAccess: false;
  userId: string;
  practiceId: null;
};

/** JWT may also carry brief persona fields (platform users / legacy). */
export type BriefAuthFields = {
  userRole?: UserRole;
  deskRole?: 'owner' | 'front_desk';
};

export type AuthJwtPayload = (UserAuthPayload | PlatformDevAuthPayload) & BriefAuthFields;

export function practiceRoleToBrief(role: PracticeRole | 'platform_dev'): UserRole {
  switch (role) {
    case 'front_desk':
      return 'front_desk';
    case 'practice_owner':
      return 'practice_owner';
    case 'accountant':
      return 'auditor';
    case 'group_admin':
      return 'billing_ops_manager';
    case 'platform_dev':
      return 'platform_admin';
    case 'office_manager':
    case 'billing_coordinator':
    case 'associate_dentist':
      return 'practice_owner';
    default:
      return 'practice_owner';
  }
}

export function getUserRole(auth: AuthJwtPayload | undefined): UserRole | null {
  if (!auth) return null;
  if (auth.userRole) return auth.userRole;
  if (auth.role === 'platform_dev') return 'platform_admin';
  return practiceRoleToBrief(auth.role);
}

export function authUserId(auth: AuthJwtPayload | undefined): string | null {
  if (!auth) return null;
  if (auth.role === 'platform_dev') return auth.userId;
  return auth.userId;
}

export function authPracticeId(auth: AuthJwtPayload | undefined): string | null {
  if (!auth) return null;
  if (auth.role === 'platform_dev') return null;
  return auth.practiceId || null;
}

export function isPlatformDev(auth: AuthJwtPayload | undefined): auth is PlatformDevAuthPayload {
  return auth?.role === 'platform_dev' || getUserRole(auth) === 'platform_admin';
}

export function isPlatformAdmin(auth: AuthJwtPayload | undefined): boolean {
  return getUserRole(auth) === 'platform_admin';
}

export function isUserSession(auth: AuthJwtPayload | undefined): auth is UserAuthPayload {
  return auth != null && auth.role !== 'platform_dev';
}

export function hasPhiAccess(auth: AuthJwtPayload | undefined): boolean {
  return auth?.phiAccess === true;
}

export function roleLevel(auth: AuthJwtPayload | undefined): number {
  if (!auth) return 0;
  if (auth.role === 'platform_dev') return ROLE_LEVEL.platform_dev;
  const brief = getUserRole(auth);
  if (brief === 'platform_admin') return ROLE_LEVEL.platform_dev;
  if (brief === 'billing_ops_manager') return ROLE_LEVEL.group_admin;
  if (brief === 'practice_owner') return ROLE_LEVEL.practice_owner;
  if (brief === 'front_desk') return ROLE_LEVEL.front_desk;
  if (brief === 'auditor') return ROLE_LEVEL.accountant;
  return ROLE_LEVEL[auth.role] ?? 0;
}

export function hasMinRole(auth: AuthJwtPayload | undefined, min: PracticeRole | 'platform_dev'): boolean {
  return roleLevel(auth) >= (ROLE_LEVEL[min] ?? 0);
}

export function isFrontDesk(auth: AuthJwtPayload | undefined): boolean {
  return getUserRole(auth) === 'front_desk';
}

export function isPracticeOwner(auth: AuthJwtPayload | undefined): boolean {
  return getUserRole(auth) === 'practice_owner';
}

export function isAuditor(auth: AuthJwtPayload | undefined): boolean {
  return getUserRole(auth) === 'auditor';
}

export function isBillingOpsManager(auth: AuthJwtPayload | undefined): boolean {
  return getUserRole(auth) === 'billing_ops_manager';
}

export function isCrossPracticeReader(auth: AuthJwtPayload | undefined): boolean {
  const r = getUserRole(auth);
  return r === 'billing_ops_manager' || r === 'platform_admin';
}
