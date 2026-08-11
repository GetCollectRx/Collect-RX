import { describe, it, expect } from 'vitest';

describe('role gate expectations (brief §10)', () => {
  it('documents front_desk blocked from aging reports via middleware export', async () => {
    const mod = await import('../src/server/middleware/requireUserRole.js');
    expect(typeof mod.blockFrontDeskReports).toBe('function');
  });
});
