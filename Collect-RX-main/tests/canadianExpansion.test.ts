import { describe, expect, it } from 'vitest';
import {
  normalizeCdtCode,
  reconsiderationExclusionReason,
  requiresCdcpDesensitizationPreauth,
} from '../src/server/canadianExpansion/constants';

describe('canadianExpansion constants', () => {
  it('normalizes CDT codes', () => {
    expect(normalizeCdtCode('41301')).toBe('D41301');
    expect(normalizeCdtCode('d120')).toBe('D0120');
  });

  it('flags CDCP desensitization pre-auth codes', () => {
    expect(requiresCdcpDesensitizationPreauth('41301')).toBe(true);
    expect(requiresCdcpDesensitizationPreauth('D0120')).toBe(false);
  });

  it('excludes reconsideration for Appendix E–style categories', () => {
    expect(reconsiderationExclusionReason('D9975')).toContain('whitening');
    expect(reconsiderationExclusionReason('D2740')).toBeNull();
  });
});
