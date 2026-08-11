import { describe, expect, it } from 'vitest';
import {
  tokenizePatient,
  detokenizePatient,
  isValidPatientToken,
  assertNoPhiInOutboundPayload,
  PhiBoundaryViolationError,
  TokenNotFoundError,
} from './tokenizer.js';

const PRACTICE_A = 'practice-a';
const PRACTICE_B = 'practice-b';

const SAMPLE_PHI = {
  patientName: 'Jordan Test',
  dateOfBirth: '1990-01-15',
  subscriberId: 'SUB-001',
  groupPolicyNumber: 'GRP-001',
};

describe('tokenizePatient / detokenizePatient', () => {
  it('round-trips PHI through a UUID token scoped to the issuing practice', () => {
    const token = tokenizePatient(SAMPLE_PHI, {
      practiceId: PRACTICE_A,
      callerContext: 'test:tokenize',
    });

    expect(isValidPatientToken(token)).toBe(true);

    const resolved = detokenizePatient(token, {
      practiceId: PRACTICE_A,
      callerContext: 'test:detokenize',
    });
    expect(resolved).toEqual(SAMPLE_PHI);
  });

  it('refuses to detokenize across a tenant boundary', () => {
    const token = tokenizePatient(SAMPLE_PHI, {
      practiceId: PRACTICE_A,
      callerContext: 'test:tokenize',
    });

    expect(() =>
      detokenizePatient(token, { practiceId: PRACTICE_B, callerContext: 'test:cross-tenant' }),
    ).toThrow(TokenNotFoundError);
  });

  it('throws for an unknown token', () => {
    expect(() =>
      detokenizePatient('00000000-0000-4000-8000-000000000000', {
        practiceId: PRACTICE_A,
        callerContext: 'test:unknown',
      }),
    ).toThrow(TokenNotFoundError);
  });
});

describe('isValidPatientToken', () => {
  it('accepts a well-formed UUID v4', () => {
    expect(isValidPatientToken('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
  });

  it('rejects a raw claim number or malformed string', () => {
    expect(isValidPatientToken('CLAIM-12345')).toBe(false);
    expect(isValidPatientToken('')).toBe(false);
  });
});

describe('assertNoPhiInOutboundPayload', () => {
  it('passes a payload with no PHI-shaped keys', () => {
    expect(() =>
      assertNoPhiInOutboundPayload({ claimId: 'abc', patientToken: 'uuid', carrierId: 'sun_life' }),
    ).not.toThrow();
  });

  it('throws when a PHI-shaped key is present and not allow-listed', () => {
    expect(() => assertNoPhiInOutboundPayload({ patientName: 'Jordan Test' })).toThrow(
      PhiBoundaryViolationError,
    );
  });

  it('walks nested objects', () => {
    expect(() =>
      assertNoPhiInOutboundPayload({ metadata: { nested: { dateOfBirth: '1990-01-15' } } }),
    ).toThrow(PhiBoundaryViolationError);
  });

  it('allows an explicitly named PHI field (the ephemeral-variables escape valve)', () => {
    expect(() =>
      assertNoPhiInOutboundPayload({ patientName: 'Jordan Test' }, ['patientName']),
    ).not.toThrow();
  });
});
