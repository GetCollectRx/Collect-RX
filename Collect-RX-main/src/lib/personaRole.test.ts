import { describe, expect, it } from 'vitest';
import { isPracticeGroupAdmin } from './personaRole';

describe('isPracticeGroupAdmin', () => {
  it('is true for a real practice group_admin (has a sessionUser)', () => {
    expect(isPracticeGroupAdmin('group_admin', { id: 'user-1' })).toBe(true);
  });

  it('is false for a platform billing_ops_manager/platform_admin session carrying the legacy group_admin role shim but no sessionUser', () => {
    // Regression: GroupAdminRoute (src/App.tsx) used to check `role !== 'group_admin'`
    // directly instead of this helper, so a platform billing_ops_manager session
    // (which is signed a legacy `role: 'group_admin'` shim for other reasons but has
    // no practice-layer sessionUser) could navigate straight into /group-dashboard.
    // The backend independently 403s the underlying data calls, so this was not a
    // data leak, but the route guard itself was not doing its job.
    expect(isPracticeGroupAdmin('group_admin', null)).toBe(false);
    expect(isPracticeGroupAdmin('group_admin', undefined)).toBe(false);
  });

  it('is false for any other role regardless of sessionUser', () => {
    expect(isPracticeGroupAdmin('practice_owner', { id: 'user-1' })).toBe(false);
    expect(isPracticeGroupAdmin(null, { id: 'user-1' })).toBe(false);
  });
});
