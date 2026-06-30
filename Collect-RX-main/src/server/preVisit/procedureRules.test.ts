import { describe, expect, it } from 'vitest';
import { requiresCdcpPredetermination, isCdcpCarrier } from './procedureRules';
import { reconsiderationExclusionReason } from '../canadianExpansion/constants';

describe('requiresCdcpPredetermination', () => {
  it('flags crowns/veneers range D2710-D2799', () => {
    expect(requiresCdcpPredetermination('D2740')).toBe(true);
  });

  it('does not flag a routine exam code', () => {
    expect(requiresCdcpPredetermination('D0120')).toBe(false);
  });

  it('flags implants range D6010-D6199', () => {
    expect(requiresCdcpPredetermination('D6010')).toBe(true);
  });

  it('flags surgical extractions range D7210-D7310', () => {
    expect(requiresCdcpPredetermination('D7210')).toBe(true);
  });

  it('flags dentures/partials range D5110-D5899', () => {
    expect(requiresCdcpPredetermination('D5110')).toBe(true);
  });

  it('does not flag D2960 — outside the predetermination ranges', () => {
    expect(requiresCdcpPredetermination('D2960')).toBe(false);
    // Cross-check: D2960 is also separately excluded from CDCP reconsideration
    // entirely (veneers), per constants.ts.
    expect(reconsiderationExclusionReason('D2960')).not.toBeNull();
  });
});

describe('isCdcpCarrier', () => {
  it('is true only for sun_life', () => {
    expect(isCdcpCarrier('sun_life')).toBe(true);
    expect(isCdcpCarrier('canada_life')).toBe(false);
    expect(isCdcpCarrier('manulife')).toBe(false);
    expect(isCdcpCarrier('telus_adjudicare')).toBe(false);
  });
});
