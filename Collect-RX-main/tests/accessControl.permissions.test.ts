import { describe, it, expect } from 'vitest';
import {
  accessLevel,
  canPerformAction,
  canAccessPractice,
  actionRequiresPracticeGrant,
  isBreakGlassAction,
} from '../src/server/accessControl/permissions.js';
import type { UserRole } from '../src/types/userRole.js';

describe('accessControl.permissions matrix', () => {
  it('front_desk can pause claims in own practice only', () => {
    expect(canPerformAction('front_desk', 'pause_claim')).toBe(true);
    expect(canPerformAction('front_desk', 'get_aging_report')).toBe(false);
    expect(canAccessPractice('front_desk', 'p1', 'p1')).toBe(true);
    expect(canAccessPractice('front_desk', 'p1', 'p2')).toBe(false);
  });

  it('practice_owner can read reports in own practice', () => {
    expect(canPerformAction('practice_owner', 'get_aging_report')).toBe(true);
    expect(canPerformAction('practice_owner', 'build_queue')).toBe(false);
    expect(accessLevel('practice_owner', 'update_practice')).toBe('own');
  });

  it('billing_ops_manager has cross-practice read on claims and reports', () => {
    expect(canPerformAction('billing_ops_manager', 'list_claims')).toBe(true);
    expect(canPerformAction('billing_ops_manager', 'pause_claim')).toBe(true);
    expect(canPerformAction('billing_ops_manager', 'update_practice')).toBe(false);
    expect(canAccessPractice('billing_ops_manager', null, 'any-id')).toBe(true);
  });

  it('platform_admin claim access requires grant; queue build is break-glass', () => {
    expect(actionRequiresPracticeGrant('list_claims')).toBe(true);
    expect(actionRequiresPracticeGrant('get_aging_report')).toBe(false);
    expect(isBreakGlassAction('build_queue')).toBe(true);
    expect(isBreakGlassAction('run_queue')).toBe(true);
    expect(canPerformAction('platform_admin', 'build_queue')).toBe(true);
  });

  it('auditor is read-only on reports and queue stats only', () => {
    expect(canPerformAction('auditor', 'get_carrier_stats')).toBe(true);
    expect(canPerformAction('auditor', 'list_claims')).toBe(false);
    expect(canPerformAction('auditor', 'resolve_escalation')).toBe(false);
  });

  it('unknown role cannot perform actions', () => {
    expect(canPerformAction(null, 'list_claims')).toBe(false);
    expect(canPerformAction('invalid' as UserRole, 'list_claims')).toBe(false);
  });
});
