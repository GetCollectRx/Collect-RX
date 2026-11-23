import { describe, expect, it } from 'vitest';
import {
  decideNonDentalDial,
  MIN_SHADOW_CALLS_PASSED,
  parseDialAllowlist,
  payerKeyFromName,
} from './carrierAllowlist';

const entry = (over: Record<string, unknown> = {}) => ({
  practiceId: 'p1',
  payer: 'intact',
  enabled: true,
  shadowCallsPassed: MIN_SHADOW_CALLS_PASSED,
  enabledBy: 'admin-1',
  ...over,
});

describe('carrier allowlist', () => {
  it('denies by default with no config', () => {
    const { entries } = parseDialAllowlist(undefined);
    expect(decideNonDentalDial(entries, 'p1', 'Intact Insurance')).toEqual({ allowed: false, reason: 'no_entry' });
  });

  it('allows only the exact tenant and payer once shadow calls pass', () => {
    const { entries } = parseDialAllowlist(JSON.stringify([entry()]));
    expect(decideNonDentalDial(entries, 'p1', 'INTACT Insurance Company').allowed).toBe(true);
    expect(decideNonDentalDial(entries, 'p2', 'Intact').reason).toBe('no_entry');
    expect(decideNonDentalDial(entries, 'p1', 'Aviva Canada').reason).toBe('no_entry');
  });

  it('blocks disabled entries and entries without enough shadow calls', () => {
    const off = parseDialAllowlist(JSON.stringify([entry({ enabled: false })])).entries;
    expect(decideNonDentalDial(off, 'p1', 'Intact').reason).toBe('disabled');
    const few = parseDialAllowlist(JSON.stringify([entry({ shadowCallsPassed: MIN_SHADOW_CALLS_PASSED - 1 })])).entries;
    expect(decideNonDentalDial(few, 'p1', 'Intact').reason).toBe('insufficient_shadow_calls');
  });

  it('denies unrecognised payers', () => {
    const { entries } = parseDialAllowlist(JSON.stringify([entry()]));
    expect(decideNonDentalDial(entries, 'p1', 'Mystery Mutual').reason).toBe('payer_unrecognised');
  });

  it('maps the supported payer names', () => {
    expect(payerKeyFromName('Insurance Corporation of British Columbia')).toBe('icbc');
    expect(payerKeyFromName('Sun Life Financial')).toBe('sun_life');
    expect(payerKeyFromName('Canada Life')).toBe('canada_life');
    expect(payerKeyFromName('Desjardins Assurances')).toBe('desjardins');
  });

  it('fails closed on malformed input, including one bad entry in a list', () => {
    expect(parseDialAllowlist('not json').entries).toEqual([]);
    expect(parseDialAllowlist('{}').errors).toHaveLength(1);
    const mixed = parseDialAllowlist(JSON.stringify([entry(), entry({ payer: 'nobody' })]));
    expect(mixed.entries).toEqual([]);
    expect(mixed.errors).toHaveLength(1);
  });
});
