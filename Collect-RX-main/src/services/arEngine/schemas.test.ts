import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  CarrierAdjudicationPayloadSchema,
  assertLockedAdjudicationPayload,
  LockedPayloadValidationError,
  normalizeAdjudication,
  parseCarrierAdjudication,
  CARRIER_ADJUDICATION_PARSERS,
  CARRIER_IDS,
} from './schemas.js';

describe('CarrierAdjudicationPayloadSchema', () => {
  it('accepts a well-formed payload', () => {
    const payload = {
      carrier: 'sun_life',
      claim_id_token: randomUUID(),
      adjudication_status: 'PAID',
      denial_reason_code: null,
      amount_covered_cents: 50000,
    };
    expect(() => CarrierAdjudicationPayloadSchema.parse(payload)).not.toThrow();
  });

  it('rejects a raw (non-UUID) claim identifier — the whole point of tokenization', () => {
    const payload = {
      carrier: 'sun_life',
      claim_id_token: 'CLAIM-98765',
      adjudication_status: 'PAID',
      denial_reason_code: null,
      amount_covered_cents: 50000,
    };
    expect(CarrierAdjudicationPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects an adjudication_status outside the locked enum', () => {
    const payload = {
      carrier: 'sun_life',
      claim_id_token: randomUUID(),
      adjudication_status: 'MAYBE',
      denial_reason_code: null,
      amount_covered_cents: 0,
    };
    expect(CarrierAdjudicationPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects a negative covered amount', () => {
    const payload = {
      carrier: 'sun_life',
      claim_id_token: randomUUID(),
      adjudication_status: 'PENDING',
      denial_reason_code: null,
      amount_covered_cents: -100,
    };
    expect(CarrierAdjudicationPayloadSchema.safeParse(payload).success).toBe(false);
  });
});

describe('assertLockedAdjudicationPayload', () => {
  it('freezes a valid payload', () => {
    const locked = assertLockedAdjudicationPayload({
      carrier: 'manulife',
      claim_id_token: randomUUID(),
      adjudication_status: 'DENIED',
      denial_reason_code: 'not_covered',
      amount_covered_cents: 0,
    });
    expect(Object.isFrozen(locked)).toBe(true);
  });

  it('throws LockedPayloadValidationError for an invalid payload', () => {
    expect(() => assertLockedAdjudicationPayload({ carrier: 'not_a_carrier' })).toThrow(
      LockedPayloadValidationError,
    );
  });
});

describe('normalizeAdjudication', () => {
  const token = randomUUID();

  it('maps a RESOLVED outcome to PAID', () => {
    const payload = normalizeAdjudication('sun_life', {
      claimIdToken: token,
      outcome: 'RESOLVED',
      coveredAmountCents: 12345,
    });
    expect(payload.adjudication_status).toBe('PAID');
    expect(payload.amount_covered_cents).toBe(12345);
  });

  it('maps a DENIED outcome to DENIED and preserves the denial reason', () => {
    const payload = normalizeAdjudication('canada_life', {
      claimIdToken: token,
      outcome: 'DENIED',
      denialReasonCode: 'FREQ-01',
    });
    expect(payload.adjudication_status).toBe('DENIED');
    expect(payload.denial_reason_code).toBe('FREQ-01');
  });

  it('maps any other outcome to PENDING', () => {
    const payload = normalizeAdjudication('rbc', { claimIdToken: token, outcome: 'ESCALATED' });
    expect(payload.adjudication_status).toBe('PENDING');
  });

  it('never leaves amount_covered_cents undefined or negative', () => {
    const payload = normalizeAdjudication('green_shield', { claimIdToken: token, outcome: 'PENDING' });
    expect(payload.amount_covered_cents).toBe(0);
  });
});

describe('CARRIER_ADJUDICATION_PARSERS', () => {
  it('has an entry for every supported carrier', () => {
    for (const carrier of CARRIER_IDS) {
      expect(CARRIER_ADJUDICATION_PARSERS[carrier]).toBeTypeOf('function');
    }
  });

  it('parseCarrierAdjudication routes through the correct carrier parser', () => {
    const payload = parseCarrierAdjudication('telus_adjudicare', {
      claimIdToken: randomUUID(),
      outcome: 'RESOLVED',
      coveredAmountCents: 999,
    });
    expect(payload.carrier).toBe('telus_adjudicare');
  });
});
