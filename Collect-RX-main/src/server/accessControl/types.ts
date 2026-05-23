/** All practice-layer roles. Mirrors the PracticeRole enum in schema.prisma. */
export type PracticeRole =
  | 'practice_owner'
  | 'office_manager'
  | 'billing_coordinator'
  | 'front_desk'
  | 'associate_dentist'
  | 'accountant'
  | 'group_admin';

/**
 * Numeric authority level for each role.
 * Used by authorizeRole middleware: request is allowed when actor level >= required level.
 * Roles at the same level (front_desk / associate_dentist / accountant) are distinguished
 * by exact-role checks where their capabilities diverge.
 */
export const ROLE_LEVEL: Record<PracticeRole | 'platform_dev', number> = {
  platform_dev:          100,
  group_admin:            70,
  practice_owner:         60,
  office_manager:         50,
  billing_coordinator:    30,
  front_desk:             20,
  associate_dentist:      20,
  accountant:             20,
} as const;

/** Session for an individual practice user (email + password login). */
export type UserAuthPayload = {
  role: PracticeRole;
  userId: string;
  practiceId: string;
  phiAccess: boolean;
  /** Populated only for associate_dentist — all queries must be scoped to this provider. */
  providerId?: string;
};

/** @deprecated Kept so existing callers that check role === 'practice' keep compiling. */
export type PracticeAuthPayload = {
  role: 'practice';
  practiceId: string;
  phiAccess: true;
};

/** Platform operator — full ops/config; PHI blocked at middleware + serializers. */
export type PlatformDevAuthPayload = {
  role: 'platform_dev';
  phiAccess: false;
};

export type AuthJwtPayload = UserAuthPayload | PlatformDevAuthPayload;

// ─── Role predicates ────────────────────────────────────────────────────────

export function isPlatformDev(auth: AuthJwtPayload | undefined): auth is PlatformDevAuthPayload {
  return auth?.role === 'platform_dev';
}

export function isUserSession(auth: AuthJwtPayload | undefined): auth is UserAuthPayload {
  return auth != null && auth.role !== 'platform_dev';
}

export function hasPhiAccess(auth: AuthJwtPayload | undefined): boolean {
  return auth?.phiAccess === true;
}

export function roleLevel(auth: AuthJwtPayload | undefined): number {
  if (!auth) return 0;
  return ROLE_LEVEL[auth.role as keyof typeof ROLE_LEVEL] ?? 0;
}

/** True if the session meets or exceeds the minimum role level. */
export function hasMinRole(auth: AuthJwtPayload | undefined, min: PracticeRole | 'platform_dev'): boolean {
  return roleLevel(auth) >= (ROLE_LEVEL[min] ?? 0);
}
