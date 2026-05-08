import { describe, expect, it } from 'vitest';
import {
  normalizeCdtCode,
  reconsiderationExclusionReason,
  requiresCdcpDesensitizationPreauth,
} from '../src/server/canadianExpansion/constants';
import { detectDenialFromEndOfCall } from '../src/server/canadianExpansion/autoReconsideration';
import {
  validateGapEstimate,
  validateReconsiderationCreate,
  validateReconsiderationStatus,
  ValidationError,
} from '../src/server/canadianExpansion/validators';

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

describe('canadianExpansion validators', () => {
  it('rejects malformed claim refs', () => {
    expect(() =>
      validateReconsiderationCreate({
        patient_token: 'tok-123',
        claim_ref: 'bad ref with spaces',
      })
    ).toThrow(ValidationError);
  });

  it('accepts well-formed reconsideration input', () => {
    const out = validateReconsiderationCreate({
      patient_token: 'tok-123',
      claim_ref: 'PRE-2026-001',
      procedure_code: 'D2740',
      denial_date: '2026-04-15',
    });
    expect(out.claimRef).toBe('PRE-2026-001');
    expect(out.procedureCode).toBe('D2740');
    expect(out.denialDate.getUTCFullYear()).toBe(2026);
  });

  it('enforces status enum', () => {
    expect(() => validateReconsiderationStatus({ status: 'whatever' })).toThrow(ValidationError);
    expect(validateReconsiderationStatus({ status: 'submitted' })).toBe('submitted');
  });

  it('caps gap-estimate procedure list', () => {
    const procs = Array.from({ length: 51 }, () => ({ cdt_code: 'D0120', office_fee_cad: 50 }));
    expect(() => validateGapEstimate({ province: 'ON', procedures: procs })).toThrow(ValidationError);
  });
});

describe('auto-reconsideration detection', () => {
  it('extracts a denial signal from a Vapi end-of-call-report', () => {
    const sig = detectDenialFromEndOfCall({
      type: 'end-of-call-report',
      call: {
        id: 'call_abc',
        metadata: {
          practice_id: 'prac-1',
          patient_token: 'tok-9',
          claim_ref: 'PRE-2026-007',
          procedure_code: 'D2740',
        },
      },
      analysis: {
        structuredData: {
          outcome: 'NOT_COVERED',
          is_appealable: true,
          carrier_code: 'cdcp_sunlife',
          reason_code: 'INSUFFICIENT_DOCS',
        },
      },
    });
    expect(sig).not.toBeNull();
    expect(sig?.claimRef).toBe('PRE-2026-007');
    expect(sig?.carrierCode).toBe('cdcp_sunlife');
  });

  it('returns null for non-denial outcomes', () => {
    expect(
      detectDenialFromEndOfCall({
        type: 'end-of-call-report',
        analysis: { structuredData: { outcome: 'COVERED' } },
      })
    ).toBeNull();
  });

  it('returns null when required identifiers are missing', () => {
    expect(
      detectDenialFromEndOfCall({
        type: 'end-of-call-report',
        analysis: { structuredData: { outcome: 'DENIED', is_appealable: true } },
      })
    ).toBeNull();
  });
});
