import { describe, it, expect } from 'vitest';
import { classifyOutcome, shouldAutoEscalate } from '../src/server/services/outcomeClassifier.js';

describe('outcomeClassifier', () => {
  it('classifies payment processing as RESOLVED', () => {
    const r = classifyOutcome('', [{ speaker: 'carrier', text: 'payment processing started' }], {});
    expect(r.outcome).toBe('RESOLVED');
  });

  it('classifies short calls as NO_ANSWER / ivr fallback', () => {
    const r = classifyOutcome('', [], { durationSeconds: 20, activeAgent: 'IVR_Navigator' });
    expect(r.outcome).toBe('NO_ANSWER');
  });

  it('human takeover overrides transcript', () => {
    const r = classifyOutcome('', [{ speaker: 'carrier', text: 'approved' }], {
      takenOverByStaffId: 'staff-1',
    });
    expect(r.outcome).toBe('ESCALATED');
  });

  it('shouldAutoEscalate on third failed attempt', () => {
    expect(shouldAutoEscalate('FAILED', 3)).toBe(true);
    expect(shouldAutoEscalate('RESOLVED', 3)).toBe(false);
  });
});

describe('role gate expectations (brief §10)', () => {
  it('documents front_desk blocked from aging reports via middleware export', async () => {
    const mod = await import('../src/server/middleware/requireUserRole.js');
    expect(typeof mod.blockFrontDeskReports).toBe('function');
  });
});
