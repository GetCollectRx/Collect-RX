import { describe, expect, it } from 'vitest';
import { mapToCarrierId } from '../src/server/pms/carrierMap.js';

describe('mapToCarrierId', () => {
  it('maps known carrier names across spacing/case variants', () => {
    expect(mapToCarrierId('Sun Life')).toBe('sun_life');
    expect(mapToCarrierId('Sun Life Financial')).toBe('sun_life');
    expect(mapToCarrierId('MANULIFE')).toBe('manulife');
    expect(mapToCarrierId('Manufacturers Life')).toBe('manulife');
    expect(mapToCarrierId('Canada Life')).toBe('canada_life');
    expect(mapToCarrierId('Great-West Life')).toBe('canada_life');
    expect(mapToCarrierId('Green Shield')).toBe('green_shield');
    expect(mapToCarrierId('RBC Insurance')).toBe('rbc');
    expect(mapToCarrierId('TELUS')).toBe('telus_adjudicare');
  });

  it('returns null for unknown or blank carriers instead of guessing', () => {
    expect(mapToCarrierId('Blue Cross')).toBeNull();
    expect(mapToCarrierId('Aetna')).toBeNull();
    expect(mapToCarrierId('')).toBeNull();
    expect(mapToCarrierId('   ')).toBeNull();
    expect(mapToCarrierId(null)).toBeNull();
    expect(mapToCarrierId(undefined)).toBeNull();
  });

  it('never silently defaults a real-but-unsupported carrier to Sun Life', () => {
    // The liability case: a Blue Cross claim must not be dialed to Sun Life.
    expect(mapToCarrierId('Blue Cross Blue Shield')).not.toBe('sun_life');
    expect(mapToCarrierId('Blue Cross Blue Shield')).toBeNull();
  });
});
