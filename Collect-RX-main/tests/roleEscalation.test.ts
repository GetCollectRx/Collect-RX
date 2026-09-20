/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Role Escalation — canManageRole
 *
 * Exercises the *production* gate used by authRoutes on every account-creating,
 * role-changing and invite path. The rule is a strict level comparison
 * (`actorLevel > targetLevel`) over ROLE_LEVEL, which makes equal-level pairs
 * refusals — the case a hand-written allow-list is most likely to miss.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from 'vitest';
import { canManageRole } from '../src/server/routes/authRoutes.js';
import { ROLE_LEVEL, type PracticeRole, type UserAuthPayload } from '../src/server/accessControl/types.js';

function actor(role: PracticeRole): UserAuthPayload {
  return { role, userId: `user-${role}`, practiceId: 'practice-1', phiAccess: false };
}

const PRACTICE_ROLES: PracticeRole[] = [
  'group_admin',
  'practice_owner',
  'office_manager',
  'billing_coordinator',
  'front_desk',
  'associate_dentist',
  'accountant',
];

describe('canManageRole', () => {
  it('permits management strictly downward, for every ordered pair', () => {
    for (const actorRole of PRACTICE_ROLES) {
      for (const targetRole of PRACTICE_ROLES) {
        const expected = ROLE_LEVEL[actorRole] > ROLE_LEVEL[targetRole];
        expect(
          canManageRole(actor(actorRole), targetRole),
          `${actorRole} → ${targetRole}`,
        ).toBe(expected);
      }
    }
  });

  it('refuses same-level pairs, including a role managing its own peers', () => {
    // front_desk, associate_dentist and accountant all sit at level 20.
    expect(canManageRole(actor('front_desk'), 'associate_dentist')).toBe(false);
    expect(canManageRole(actor('associate_dentist'), 'accountant')).toBe(false);
    expect(canManageRole(actor('accountant'), 'front_desk')).toBe(false);

    // No role may clone its own level, owners included.
    for (const role of PRACTICE_ROLES) {
      expect(canManageRole(actor(role), role), `${role} → ${role}`).toBe(false);
    }
  });

  it('refuses every escalation to platform_dev, the level above all practice roles', () => {
    for (const role of PRACTICE_ROLES) {
      expect(canManageRole(actor(role), 'platform_dev'), `${role} → platform_dev`).toBe(false);
    }
  });

  it('lets billing_coordinator manage the level-20 roles beneath it', () => {
    // Deliberately pinned: staff-level roles are not uniformly barred from
    // account creation — billing_coordinator (30) outranks front_desk (20).
    expect(canManageRole(actor('billing_coordinator'), 'front_desk')).toBe(true);
    expect(canManageRole(actor('billing_coordinator'), 'office_manager')).toBe(false);
  });

  it('treats an unrecognised role as level 0 on both sides', () => {
    expect(canManageRole(actor('practice_owner'), 'not_a_role')).toBe(true);
    expect(
      canManageRole({ ...actor('practice_owner'), role: 'not_a_role' as PracticeRole }, 'front_desk'),
    ).toBe(false);
  });
});
