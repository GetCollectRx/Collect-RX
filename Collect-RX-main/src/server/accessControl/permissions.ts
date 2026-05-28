/**
 * CollectRx RBAC — resource/action matrix from access-control handoff (2026-05-20).
 * Server-side enforcement only; UI mirrors these rules via useRoleAccess / ProtectedRoute.
 */

import type { UserRole } from '../../types/userRole.js';

export type Resource =
  | 'practices'
  | 'claims'
  | 'queue'
  | 'escalations'
  | 'reports';

export type Action =
  | 'list_practices'
  | 'get_practice'
  | 'update_practice'
  | 'list_claims'
  | 'get_claim'
  | 'pause_claim'
  | 'unpause_claim'
  | 'build_queue'
  | 'run_queue'
  | 'get_queue_stats'
  | 'list_escalations'
  | 'resolve_escalation'
  | 'get_aging_report'
  | 'get_carrier_stats';

export type AccessLevel = 'none' | 'own' | 'all' | 'read_all' | 'write_all' | 'grant' | 'break_glass';

const MATRIX: Record<Action, Record<UserRole, AccessLevel>> = {
  list_practices: {
    front_desk: 'none',
    practice_owner: 'own',
    billing_ops_manager: 'read_all',
    platform_admin: 'read_all',
    auditor: 'none',
  },
  get_practice: {
    front_desk: 'none',
    practice_owner: 'own',
    billing_ops_manager: 'read_all',
    platform_admin: 'read_all',
    auditor: 'none',
  },
  update_practice: {
    front_desk: 'none',
    practice_owner: 'own',
    billing_ops_manager: 'none',
    platform_admin: 'write_all',
    auditor: 'none',
  },
  list_claims: {
    front_desk: 'own',
    practice_owner: 'own',
    billing_ops_manager: 'read_all',
    platform_admin: 'grant',
    auditor: 'none',
  },
  get_claim: {
    front_desk: 'own',
    practice_owner: 'own',
    billing_ops_manager: 'read_all',
    platform_admin: 'grant',
    auditor: 'none',
  },
  pause_claim: {
    front_desk: 'own',
    practice_owner: 'own',
    billing_ops_manager: 'write_all',
    platform_admin: 'grant',
    auditor: 'none',
  },
  unpause_claim: {
    front_desk: 'own',
    practice_owner: 'own',
    billing_ops_manager: 'write_all',
    platform_admin: 'grant',
    auditor: 'none',
  },
  build_queue: {
    front_desk: 'none',
    practice_owner: 'none',
    billing_ops_manager: 'none',
    platform_admin: 'break_glass',
    auditor: 'none',
  },
  run_queue: {
    front_desk: 'none',
    practice_owner: 'none',
    billing_ops_manager: 'none',
    platform_admin: 'break_glass',
    auditor: 'none',
  },
  get_queue_stats: {
    front_desk: 'none',
    practice_owner: 'own',
    billing_ops_manager: 'read_all',
    platform_admin: 'read_all',
    auditor: 'read_all',
  },
  list_escalations: {
    front_desk: 'own',
    practice_owner: 'own',
    billing_ops_manager: 'read_all',
    platform_admin: 'grant',
    auditor: 'none',
  },
  resolve_escalation: {
    front_desk: 'own',
    practice_owner: 'own',
    billing_ops_manager: 'write_all',
    platform_admin: 'grant',
    auditor: 'none',
  },
  get_aging_report: {
    front_desk: 'none',
    practice_owner: 'own',
    billing_ops_manager: 'read_all',
    platform_admin: 'read_all',
    auditor: 'read_all',
  },
  get_carrier_stats: {
    front_desk: 'none',
    practice_owner: 'own',
    billing_ops_manager: 'read_all',
    platform_admin: 'read_all',
    auditor: 'read_all',
  },
};

export function accessLevel(role: UserRole | null, action: Action): AccessLevel {
  if (!role) return 'none';
  return MATRIX[action][role] ?? 'none';
}

/** True when the role may perform the action (ignores per-practice grants — check those separately). */
export function canPerformAction(role: UserRole | null, action: Action): boolean {
  const level = accessLevel(role, action);
  return level !== 'none';
}

export function actionRequiresPracticeGrant(action: Action): boolean {
  return accessLevel('platform_admin', action) === 'grant';
}

export function actionRequiresAuditorGrant(action: Action): boolean {
  const level = accessLevel('auditor', action);
  return level === 'read_all' || level === 'own';
}

export function isBreakGlassAction(action: Action): boolean {
  return accessLevel('platform_admin', action) === 'break_glass';
}

/**
 * Whether a session may target a practice at all (data-layer scope).
 * Grant tables still apply for platform_admin claims and auditor reports.
 */
export function canAccessPractice(
  role: UserRole | null,
  sessionPracticeId: string | null,
  targetPracticeId: string,
): boolean {
  if (!role) return false;
  switch (role) {
    case 'front_desk':
    case 'practice_owner':
      return Boolean(sessionPracticeId && sessionPracticeId === targetPracticeId);
    case 'billing_ops_manager':
    case 'platform_admin':
      return true;
    case 'auditor':
      return true;
    default:
      return false;
  }
}
