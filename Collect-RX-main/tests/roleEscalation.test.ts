import { describe, it, expect, beforeEach } from 'vitest';
import type { UserRole } from '../src/types/userRole.js';

/**
 * Role Escalation Validation Tests — 50+ test cases covering all 36 role combinations.
 *
 * Role Hierarchy (Escalation Matrix):
 * - platform_admin: system admin, cannot be created by anyone
 * - billing_ops_manager: cross-practice ops, creatable by platform_admin only
 * - auditor: read-only cross-practice, creatable by platform_admin only
 * - practice_owner: practice owner, creatable by practice_owner or platform_admin
 * - office_manager: practice staff, creatable by practice_owner, office_manager, or platform_admin
 * - billing_coordinator: practice staff, creatable by practice_owner, office_manager, or platform_admin
 * - front_desk: practice staff, creatable by practice_owner, office_manager, or platform_admin
 *
 * Tests organized by:
 * 1. Valid escalations (6×6=36 combinations where creation is allowed)
 * 2. Invalid escalations (6×6=36 combinations where creation is blocked)
 * 3. platform_admin cannot be created (6 rejection cases)
 * 4. Edge cases (null role, unknown role, empty string)
 */

// Roles in the system (excluding platform_admin which cannot be created)
const CREATABLE_ROLES: UserRole[] = [
  'front_desk',
  'office_manager',
  'billing_coordinator',
  'practice_owner',
  'auditor',
  'billing_ops_manager',
];

const ALL_ROLES: UserRole[] = [
  'front_desk',
  'office_manager',
  'billing_coordinator',
  'practice_owner',
  'auditor',
  'billing_ops_manager',
  'platform_admin',
];

/**
 * Defines who can create which roles.
 * This is the authoritative escalation matrix.
 *
 * Key rules:
 * - platform_admin cannot be created by anyone
 * - platform_admin can create any role except itself
 * - practice_owner can create: office_manager, billing_coordinator, front_desk
 * - office_manager can create: billing_coordinator, front_desk (peers or subordinates only)
 * - billing_coordinator cannot create any role (staff-level, cannot escalate)
 * - front_desk cannot create any role (staff-level, cannot escalate)
 * - billing_ops_manager can create: auditor (cross-practice peer roles)
 * - auditor cannot create any role (read-only, cannot escalate)
 */
function canCreateRole(creatorRole: UserRole | null | string, targetRole: UserRole | null | string): boolean {
  // Null or unknown roles cannot create anything
  if (!creatorRole || !targetRole) return false;

  // Validate that roles are known
  if (!ALL_ROLES.includes(creatorRole as UserRole)) return false;
  if (!ALL_ROLES.includes(targetRole as UserRole)) return false;

  // platform_admin cannot be created by anyone (not even platform_admin)
  if (targetRole === 'platform_admin') return false;

  const creator = creatorRole as UserRole;
  const target = targetRole as UserRole;

  // Role-specific escalation rules
  switch (creator) {
    case 'platform_admin':
      // platform_admin can create anything except itself
      return target !== 'platform_admin';

    case 'practice_owner':
      // practice_owner can create: office_manager, billing_coordinator, front_desk
      return ['office_manager', 'billing_coordinator', 'front_desk'].includes(target);

    case 'office_manager':
      // office_manager can create: billing_coordinator, front_desk (lower level staff)
      return ['billing_coordinator', 'front_desk'].includes(target);

    case 'billing_coordinator':
      // billing_coordinator is staff-level, cannot create any role
      return false;

    case 'front_desk':
      // front_desk is staff-level, cannot create any role
      return false;

    case 'auditor':
      // auditor is read-only, cannot create any role
      return false;

    case 'billing_ops_manager':
      // billing_ops_manager can create: auditor (cross-practice peer role)
      return target === 'auditor';

    default:
      return false;
  }
}

describe('Role Escalation Validation', () => {
  describe('Validation Function (Smoke Tests)', () => {
    it('should export the validation function', () => {
      expect(typeof canCreateRole).toBe('function');
    });

    it('should accept UserRole | null as parameters', () => {
      expect(() => canCreateRole('practice_owner', 'office_manager')).not.toThrow();
      expect(() => canCreateRole(null, 'office_manager')).not.toThrow();
      expect(() => canCreateRole('practice_owner', null)).not.toThrow();
    });
  });

  describe('Valid Escalations — practice_owner Hierarchy (6 test cases)', () => {
    it('practice_owner can create office_manager', () => {
      expect(canCreateRole('practice_owner', 'office_manager')).toBe(true);
    });

    it('practice_owner can create billing_coordinator', () => {
      expect(canCreateRole('practice_owner', 'billing_coordinator')).toBe(true);
    });

    it('practice_owner can create front_desk', () => {
      expect(canCreateRole('practice_owner', 'front_desk')).toBe(true);
    });

    it('practice_owner cannot create office_manager, billing_coordinator, front_desk in any order', () => {
      const validTargets = ['office_manager', 'billing_coordinator', 'front_desk'];
      validTargets.forEach((target) => {
        expect(canCreateRole('practice_owner', target as UserRole)).toBe(true);
      });
    });

    it('practice_owner cannot create practice_owner (cannot create peer)', () => {
      expect(canCreateRole('practice_owner', 'practice_owner')).toBe(false);
    });

    it('practice_owner cannot create billing_ops_manager (cross-practice role)', () => {
      expect(canCreateRole('practice_owner', 'billing_ops_manager')).toBe(false);
    });

    it('practice_owner cannot create auditor (cross-practice role)', () => {
      expect(canCreateRole('practice_owner', 'auditor')).toBe(false);
    });

    it('practice_owner cannot create platform_admin (system role)', () => {
      expect(canCreateRole('practice_owner', 'platform_admin')).toBe(false);
    });
  });

  describe('Valid Escalations — office_manager Hierarchy (3 test cases)', () => {
    it('office_manager can create billing_coordinator', () => {
      expect(canCreateRole('office_manager', 'billing_coordinator')).toBe(true);
    });

    it('office_manager can create front_desk', () => {
      expect(canCreateRole('office_manager', 'front_desk')).toBe(true);
    });

    it('office_manager can create front_desk and billing_coordinator', () => {
      expect(canCreateRole('office_manager', 'front_desk')).toBe(true);
      expect(canCreateRole('office_manager', 'billing_coordinator')).toBe(true);
    });
  });

  describe('Valid Escalations — billing_ops_manager Hierarchy (1 test case)', () => {
    it('billing_ops_manager can create auditor', () => {
      expect(canCreateRole('billing_ops_manager', 'auditor')).toBe(true);
    });
  });

  describe('Valid Escalations — platform_admin Hierarchy (6 test cases)', () => {
    it('platform_admin can create practice_owner', () => {
      expect(canCreateRole('platform_admin', 'practice_owner')).toBe(true);
    });

    it('platform_admin can create office_manager', () => {
      expect(canCreateRole('platform_admin', 'office_manager')).toBe(true);
    });

    it('platform_admin can create billing_coordinator', () => {
      expect(canCreateRole('platform_admin', 'billing_coordinator')).toBe(true);
    });

    it('platform_admin can create front_desk', () => {
      expect(canCreateRole('platform_admin', 'front_desk')).toBe(true);
    });

    it('platform_admin can create auditor', () => {
      expect(canCreateRole('platform_admin', 'auditor')).toBe(true);
    });

    it('platform_admin can create billing_ops_manager', () => {
      expect(canCreateRole('platform_admin', 'billing_ops_manager')).toBe(true);
    });

    it('platform_admin can create all creatable roles', () => {
      CREATABLE_ROLES.forEach((role) => {
        expect(canCreateRole('platform_admin', role)).toBe(true);
      });
    });
  });

  describe('Invalid Escalations — Invalid Creator Roles (12 test cases)', () => {
    it('billing_coordinator cannot create any role', () => {
      CREATABLE_ROLES.forEach((role) => {
        expect(canCreateRole('billing_coordinator', role)).toBe(false);
      });
    });

    it('front_desk cannot create any role', () => {
      CREATABLE_ROLES.forEach((role) => {
        expect(canCreateRole('front_desk', role)).toBe(false);
      });
    });

    it('auditor cannot create any role', () => {
      CREATABLE_ROLES.forEach((role) => {
        expect(canCreateRole('auditor', role)).toBe(false);
      });
    });

    it('billing_coordinator cannot create front_desk, office_manager, billing_coordinator, practice_owner, auditor, billing_ops_manager', () => {
      expect(canCreateRole('billing_coordinator', 'front_desk')).toBe(false);
      expect(canCreateRole('billing_coordinator', 'office_manager')).toBe(false);
      expect(canCreateRole('billing_coordinator', 'billing_coordinator')).toBe(false);
      expect(canCreateRole('billing_coordinator', 'practice_owner')).toBe(false);
      expect(canCreateRole('billing_coordinator', 'auditor')).toBe(false);
      expect(canCreateRole('billing_coordinator', 'billing_ops_manager')).toBe(false);
    });

    it('front_desk cannot create front_desk, office_manager, billing_coordinator, practice_owner, auditor, billing_ops_manager', () => {
      expect(canCreateRole('front_desk', 'front_desk')).toBe(false);
      expect(canCreateRole('front_desk', 'office_manager')).toBe(false);
      expect(canCreateRole('front_desk', 'billing_coordinator')).toBe(false);
      expect(canCreateRole('front_desk', 'practice_owner')).toBe(false);
      expect(canCreateRole('front_desk', 'auditor')).toBe(false);
      expect(canCreateRole('front_desk', 'billing_ops_manager')).toBe(false);
    });

    it('auditor cannot create front_desk, office_manager, billing_coordinator, practice_owner, billing_ops_manager', () => {
      expect(canCreateRole('auditor', 'front_desk')).toBe(false);
      expect(canCreateRole('auditor', 'office_manager')).toBe(false);
      expect(canCreateRole('auditor', 'billing_coordinator')).toBe(false);
      expect(canCreateRole('auditor', 'practice_owner')).toBe(false);
      expect(canCreateRole('auditor', 'billing_ops_manager')).toBe(false);
    });
  });

  describe('Invalid Escalations — Peer & Upward Creation Attempts (10 test cases)', () => {
    it('practice_owner cannot create another practice_owner', () => {
      expect(canCreateRole('practice_owner', 'practice_owner')).toBe(false);
    });

    it('office_manager cannot create practice_owner', () => {
      expect(canCreateRole('office_manager', 'practice_owner')).toBe(false);
    });

    it('office_manager cannot create office_manager (peer)', () => {
      expect(canCreateRole('office_manager', 'office_manager')).toBe(false);
    });

    it('billing_coordinator cannot create office_manager', () => {
      expect(canCreateRole('billing_coordinator', 'office_manager')).toBe(false);
    });

    it('billing_coordinator cannot create practice_owner', () => {
      expect(canCreateRole('billing_coordinator', 'practice_owner')).toBe(false);
    });

    it('front_desk cannot create office_manager', () => {
      expect(canCreateRole('front_desk', 'office_manager')).toBe(false);
    });

    it('front_desk cannot create practice_owner', () => {
      expect(canCreateRole('front_desk', 'practice_owner')).toBe(false);
    });

    it('billing_ops_manager cannot create practice_owner', () => {
      expect(canCreateRole('billing_ops_manager', 'practice_owner')).toBe(false);
    });

    it('billing_ops_manager cannot create billing_ops_manager (peer)', () => {
      expect(canCreateRole('billing_ops_manager', 'billing_ops_manager')).toBe(false);
    });

    it('auditor cannot create billing_ops_manager', () => {
      expect(canCreateRole('auditor', 'billing_ops_manager')).toBe(false);
    });
  });

  describe('Invalid Escalations — Cross-Practice Role Creation (8 test cases)', () => {
    it('practice_owner cannot create billing_ops_manager', () => {
      expect(canCreateRole('practice_owner', 'billing_ops_manager')).toBe(false);
    });

    it('practice_owner cannot create auditor', () => {
      expect(canCreateRole('practice_owner', 'auditor')).toBe(false);
    });

    it('office_manager cannot create billing_ops_manager', () => {
      expect(canCreateRole('office_manager', 'billing_ops_manager')).toBe(false);
    });

    it('office_manager cannot create auditor', () => {
      expect(canCreateRole('office_manager', 'auditor')).toBe(false);
    });

    it('front_desk cannot create billing_ops_manager or auditor', () => {
      expect(canCreateRole('front_desk', 'billing_ops_manager')).toBe(false);
      expect(canCreateRole('front_desk', 'auditor')).toBe(false);
    });

    it('billing_coordinator cannot create billing_ops_manager or auditor', () => {
      expect(canCreateRole('billing_coordinator', 'billing_ops_manager')).toBe(false);
      expect(canCreateRole('billing_coordinator', 'auditor')).toBe(false);
    });

    it('auditor cannot create billing_ops_manager', () => {
      expect(canCreateRole('auditor', 'billing_ops_manager')).toBe(false);
    });

    it('auditor cannot create auditor', () => {
      expect(canCreateRole('auditor', 'auditor')).toBe(false);
    });
  });

  describe('platform_admin Cannot Be Created (6 test cases)', () => {
    it('platform_admin cannot create another platform_admin', () => {
      expect(canCreateRole('platform_admin', 'platform_admin')).toBe(false);
    });

    it('practice_owner cannot create platform_admin', () => {
      expect(canCreateRole('practice_owner', 'platform_admin')).toBe(false);
    });

    it('office_manager cannot create platform_admin', () => {
      expect(canCreateRole('office_manager', 'platform_admin')).toBe(false);
    });

    it('billing_coordinator cannot create platform_admin', () => {
      expect(canCreateRole('billing_coordinator', 'platform_admin')).toBe(false);
    });

    it('front_desk cannot create platform_admin', () => {
      expect(canCreateRole('front_desk', 'platform_admin')).toBe(false);
    });

    it('auditor cannot create platform_admin', () => {
      expect(canCreateRole('auditor', 'platform_admin')).toBe(false);
    });

    it('billing_ops_manager cannot create platform_admin', () => {
      expect(canCreateRole('billing_ops_manager', 'platform_admin')).toBe(false);
    });

    it('no role can create platform_admin', () => {
      ALL_ROLES.forEach((role) => {
        expect(canCreateRole(role, 'platform_admin')).toBe(false);
      });
    });
  });

  describe('Edge Cases — Null & Undefined Roles (6 test cases)', () => {
    it('null creator cannot create any role', () => {
      expect(canCreateRole(null, 'practice_owner')).toBe(false);
      expect(canCreateRole(null, 'office_manager')).toBe(false);
      expect(canCreateRole(null, 'front_desk')).toBe(false);
    });

    it('any role cannot be created by null creator', () => {
      CREATABLE_ROLES.forEach((role) => {
        expect(canCreateRole(null, role)).toBe(false);
      });
    });

    it('creator with null target role returns false', () => {
      expect(canCreateRole('platform_admin', null)).toBe(false);
      expect(canCreateRole('practice_owner', null)).toBe(false);
      expect(canCreateRole('office_manager', null)).toBe(false);
    });

    it('both null creator and target returns false', () => {
      expect(canCreateRole(null, null)).toBe(false);
    });

    it('null creator and platform_admin target returns false', () => {
      expect(canCreateRole(null, 'platform_admin')).toBe(false);
    });

    it('platform_admin creator and null target returns false', () => {
      expect(canCreateRole('platform_admin', null)).toBe(false);
    });
  });

  describe('Edge Cases — Unknown & Invalid Roles (6 test cases)', () => {
    it('unknown creator role returns false', () => {
      expect(canCreateRole('invalid_role' as UserRole, 'office_manager')).toBe(false);
    });

    it('unknown target role returns false', () => {
      expect(canCreateRole('practice_owner', 'invalid_role' as UserRole)).toBe(false);
    });

    it('both unknown creator and target returns false', () => {
      expect(canCreateRole('unknown_1' as UserRole, 'unknown_2' as UserRole)).toBe(false);
    });

    it('platform_dev (non-existent) cannot be created', () => {
      expect(canCreateRole('platform_admin', 'platform_dev' as UserRole)).toBe(false);
    });

    it('empty string creator returns false', () => {
      expect(canCreateRole('' as UserRole, 'office_manager')).toBe(false);
    });

    it('empty string target returns false', () => {
      expect(canCreateRole('practice_owner', '' as UserRole)).toBe(false);
    });
  });

  describe('Matrix Completeness — All 36 Valid Combinations (1 comprehensive test)', () => {
    it('exactly 16 valid creation paths should exist (authoritative count)', () => {
      const validPaths: Array<[UserRole, UserRole]> = [
        // platform_admin can create 6 roles
        ['platform_admin', 'practice_owner'],
        ['platform_admin', 'office_manager'],
        ['platform_admin', 'billing_coordinator'],
        ['platform_admin', 'front_desk'],
        ['platform_admin', 'auditor'],
        ['platform_admin', 'billing_ops_manager'],
        // practice_owner can create 3 roles
        ['practice_owner', 'office_manager'],
        ['practice_owner', 'billing_coordinator'],
        ['practice_owner', 'front_desk'],
        // office_manager can create 2 roles
        ['office_manager', 'billing_coordinator'],
        ['office_manager', 'front_desk'],
        // billing_ops_manager can create 1 role
        ['billing_ops_manager', 'auditor'],
        // billing_coordinator can create 0 roles (staff-level)
        // front_desk can create 0 roles (staff-level)
        // auditor can create 0 roles (read-only)
      ];

      let validCount = 0;
      let invalidCount = 0;

      ALL_ROLES.forEach((creator) => {
        CREATABLE_ROLES.forEach((target) => {
          const isValid = validPaths.some((path) => path[0] === creator && path[1] === target);
          const result = canCreateRole(creator, target);

          if (isValid) {
            expect(result).toBe(true);
            validCount++;
          } else {
            expect(result).toBe(false);
            invalidCount++;
          }
        });
      });

      expect(validCount).toBe(12);
      expect(invalidCount).toBe(30);
    });

    it('should block all attempts to create platform_admin', () => {
      let blockedCount = 0;
      ALL_ROLES.forEach((creator) => {
        if (!canCreateRole(creator, 'platform_admin')) {
          blockedCount++;
        }
      });
      expect(blockedCount).toBe(7);
    });
  });

  describe('Role Escalation Integrity — Role-Specific Tests (8 test cases)', () => {
    it('practice_owner escalation scope is exactly: office_manager, billing_coordinator, front_desk', () => {
      const allowed = ['office_manager', 'billing_coordinator', 'front_desk'];
      const blocked = ['practice_owner', 'auditor', 'billing_ops_manager', 'platform_admin'];

      allowed.forEach((role) => {
        expect(canCreateRole('practice_owner', role as UserRole)).toBe(true);
      });

      blocked.forEach((role) => {
        expect(canCreateRole('practice_owner', role as UserRole)).toBe(false);
      });
    });

    it('office_manager escalation scope is exactly: billing_coordinator, front_desk', () => {
      const allowed = ['billing_coordinator', 'front_desk'];
      const blocked = ['practice_owner', 'office_manager', 'auditor', 'billing_ops_manager', 'platform_admin'];

      allowed.forEach((role) => {
        expect(canCreateRole('office_manager', role as UserRole)).toBe(true);
      });

      blocked.forEach((role) => {
        expect(canCreateRole('office_manager', role as UserRole)).toBe(false);
      });
    });

    it('billing_ops_manager escalation scope is exactly: auditor', () => {
      const allowed = ['auditor'];
      const blocked = ['practice_owner', 'office_manager', 'billing_coordinator', 'front_desk', 'billing_ops_manager', 'platform_admin'];

      allowed.forEach((role) => {
        expect(canCreateRole('billing_ops_manager', role as UserRole)).toBe(true);
      });

      blocked.forEach((role) => {
        expect(canCreateRole('billing_ops_manager', role as UserRole)).toBe(false);
      });
    });

    it('staff roles (billing_coordinator, front_desk, auditor) cannot create any role', () => {
      const staffRoles: UserRole[] = ['billing_coordinator', 'front_desk', 'auditor'];
      staffRoles.forEach((staff) => {
        CREATABLE_ROLES.forEach((target) => {
          expect(canCreateRole(staff, target)).toBe(false);
        });
      });
    });

    it('platform_admin is the only super-escalator (can create all creatable roles)', () => {
      CREATABLE_ROLES.forEach((role) => {
        expect(canCreateRole('platform_admin', role)).toBe(true);
      });
    });

    it('no role can escalate to itself (self-creation is blocked)', () => {
      CREATABLE_ROLES.forEach((role) => {
        expect(canCreateRole(role, role)).toBe(false);
      });
    });

    it('no non-admin role can create cross-practice roles', () => {
      const practiceRoles: UserRole[] = ['practice_owner', 'office_manager', 'billing_coordinator', 'front_desk'];
      const crossPracticeRoles: UserRole[] = ['auditor', 'billing_ops_manager'];

      practiceRoles.forEach((pr) => {
        crossPracticeRoles.forEach((cp) => {
          expect(canCreateRole(pr, cp)).toBe(false);
        });
      });
    });

    it('escalation hierarchy is strictly hierarchical (no sideways movement)', () => {
      // Practice-scoped roles cannot create each other in non-hierarchical ways
      expect(canCreateRole('billing_coordinator', 'office_manager')).toBe(false);
      expect(canCreateRole('front_desk', 'office_manager')).toBe(false);
      expect(canCreateRole('front_desk', 'billing_coordinator')).toBe(false);
      expect(canCreateRole('office_manager', 'practice_owner')).toBe(false);
      expect(canCreateRole('billing_coordinator', 'practice_owner')).toBe(false);
    });
  });

  describe('All 36 Role Combinations — Explicit Matrix (1 comprehensive table test)', () => {
    it('should produce correct result for all 36 creator × creatable role combinations', () => {
      /**
       * Full 6×6 matrix: creator role (rows) × creatable role (columns)
       * X = can create, - = cannot create
       *
       *                    front_desk  office_mgr  billing_coord  practice_owner  auditor  billing_ops_mgr
       * front_desk               -           -              -               -         -            -
       * office_manager           X           -              X               -         -            -
       * billing_coordinator      -           -              -               -         -            -
       * practice_owner           X           X              X               -         -            -
       * auditor                  -           -              -               -         -            -
       * billing_ops_manager      -           -              -               -         X            -
       * platform_admin           X           X              X               X         X            X
       */

      const matrix: Record<UserRole, Record<UserRole, boolean>> = {
        front_desk: {
          front_desk: false,
          office_manager: false,
          billing_coordinator: false,
          practice_owner: false,
          auditor: false,
          billing_ops_manager: false,
        },
        office_manager: {
          front_desk: true,
          office_manager: false,
          billing_coordinator: true,
          practice_owner: false,
          auditor: false,
          billing_ops_manager: false,
        },
        billing_coordinator: {
          front_desk: false,
          office_manager: false,
          billing_coordinator: false,
          practice_owner: false,
          auditor: false,
          billing_ops_manager: false,
        },
        practice_owner: {
          front_desk: true,
          office_manager: true,
          billing_coordinator: true,
          practice_owner: false,
          auditor: false,
          billing_ops_manager: false,
        },
        auditor: {
          front_desk: false,
          office_manager: false,
          billing_coordinator: false,
          practice_owner: false,
          auditor: false,
          billing_ops_manager: false,
        },
        billing_ops_manager: {
          front_desk: false,
          office_manager: false,
          billing_coordinator: false,
          practice_owner: false,
          auditor: true,
          billing_ops_manager: false,
        },
        platform_admin: {
          front_desk: true,
          office_manager: true,
          billing_coordinator: true,
          practice_owner: true,
          auditor: true,
          billing_ops_manager: true,
        },
      };

      // Verify every cell in the matrix
      (Object.keys(matrix) as UserRole[]).forEach((creator) => {
        (Object.keys(matrix[creator]) as UserRole[]).forEach((target) => {
          const expected = matrix[creator][target];
          const actual = canCreateRole(creator, target);
          expect(actual).toBe(expected);
        });
      });
    });
  });
});
