import { describe, expect, it } from 'vitest';
import {
  ANNUAL_REPORT_CATEGORIES,
  BREACH_RETENTION_MONTHS,
  buildBreachPacket,
  scanForIdentifiers,
  validateRegisterEntry,
  yearlyAnnualCounts,
  type BreachRegisterInput,
} from '../../src/server/compliance/breachRegister';

const base: BreachRegisterInput = {
  notificationType: 'DATA_EXPOSURE',
  discoveredAt: new Date('2026-03-10T12:00:00Z'),
  circumstances: 'Export file sent to an unintended internal mailbox',
  occurredFrom: new Date('2026-03-09T08:00:00Z'),
  occurredTo: new Date('2026-03-09T09:30:00Z'),
  dataElements: ['BILLING', 'INSURANCE_IDENTIFIER'],
  numberOfIndividuals: 3,
  stepsToReduceHarm: 'Mailbox purged; recipient attested deletion',
  notificationSteps: 'Custodian notified same day with packet',
  contactName: 'Privacy contact (role)',
  annualCategories: ['DISCLOSED_WITHOUT_AUTHORITY'],
};

describe('constants', () => {
  it('uses the 24-month retention from SOR/2018-64 s.6(1)', () => {
    expect(BREACH_RETENTION_MONTHS).toBe(24);
  });

  it('lists the five O. Reg. 329/04 s.6.4(1) annual categories in statute order', () => {
    expect([...ANNUAL_REPORT_CATEGORIES]).toEqual([
      'STOLEN',
      'LOST',
      'USED_WITHOUT_AUTHORITY',
      'DISCLOSED_WITHOUT_AUTHORITY',
      'EHR_COLLECTED_WITHOUT_AUTHORITY',
    ]);
  });
});

describe('validateRegisterEntry', () => {
  it('accepts a complete entry', () => {
    expect(validateRegisterEntry(base)).toEqual({ ok: true });
  });

  it('requires at least one annual category', () => {
    const r = validateRegisterEntry({ ...base, annualCategories: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain('annualCategories');
  });

  it('rejects an unknown annual category code', () => {
    const r = validateRegisterEntry({ ...base, annualCategories: ['MISLAID'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain('annualCategories contains unknown code MISLAID');
  });

  it('reports each missing required field', () => {
    const r = validateRegisterEntry({ ...base, circumstances: '  ', occurredFrom: null, contactName: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing.sort()).toEqual(['circumstances', 'contactName', 'occurredFrom'].sort());
  });

  it('rejects an unknown register category and an unknown data element code', () => {
    const r = validateRegisterEntry({ ...base, notificationType: 'OTHER', dataElements: ['SSN'] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reasons).toEqual(
        expect.arrayContaining([expect.stringContaining('register categories'), expect.stringContaining('unknown code SSN')]),
      );
    }
  });

  it('rejects an impossible period and a discovery before the event', () => {
    const r = validateRegisterEntry({ ...base, occurredTo: new Date('2026-03-01T00:00:00Z') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain('occurredFrom is after occurredTo');
  });

  it('blocks free text that carries a direct identifier', () => {
    const r = validateRegisterEntry({ ...base, circumstances: 'Sent to jane.doe@example.com' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toEqual(expect.arrayContaining([expect.stringContaining('circumstances appears to contain a direct identifier')]));
  });

  it('allows zero individuals but rejects negative or fractional counts', () => {
    expect(validateRegisterEntry({ ...base, numberOfIndividuals: 0 })).toEqual({ ok: true });
    expect(validateRegisterEntry({ ...base, numberOfIndividuals: -1 }).ok).toBe(false);
    expect(validateRegisterEntry({ ...base, numberOfIndividuals: 1.5 }).ok).toBe(false);
  });
});

describe('scanForIdentifiers', () => {
  it('detects email, phone and health-card-like values', () => {
    expect(scanForIdentifiers('a@b.co')).toEqual(['email']);
    expect(scanForIdentifiers('call 613-555-0147')).toEqual(['phone']);
    expect(scanForIdentifiers('card 1234 567 890 AB')).toContain('health-card-like');
  });

  it('passes ordinary incident prose', () => {
    expect(scanForIdentifiers('Mailbox purged and recipient attested deletion')).toEqual([]);
  });
});

describe('buildBreachPacket', () => {
  it('contains tokens and codes only, never the free-text identifiers it was given', () => {
    const packet = buildBreachPacket({ ...base, affectedPatientTokens: ['tok_a1', 'tok_b2'], vendorsInvolved: ['Twilio'] });
    const json = JSON.stringify(packet);
    expect(packet.affectedPatientTokens).toEqual(['tok_a1', 'tok_b2']);
    expect(packet.annualCategories).toEqual(['DISCLOSED_WITHOUT_AUTHORITY']);
    expect(scanForIdentifiers(json)).toEqual([]);
  });

  it('throws on an incomplete entry rather than emitting a partial packet', () => {
    expect(() => buildBreachPacket({ ...base, stepsToReduceHarm: '' })).toThrow(/incomplete/);
  });
});

describe('yearlyAnnualCounts', () => {
  it('zero-fills all five categories and counts a record once per category it carries', () => {
    const rows = [
      { annualCategories: ['LOST', 'STOLEN'], discoveredAt: new Date('2026-01-02T00:00:00Z') },
      { annualCategories: ['LOST'], discoveredAt: new Date('2025-12-31T23:59:00Z') },
      { annualCategories: ['USED_WITHOUT_AUTHORITY'], discoveredAt: new Date('2026-06-01T00:00:00Z') },
    ];
    const counts = yearlyAnnualCounts(rows, 2026);
    expect(Object.keys(counts).sort()).toEqual([...ANNUAL_REPORT_CATEGORIES].sort());
    expect(counts.LOST).toBe(1);
    expect(counts.STOLEN).toBe(1);
    expect(counts.USED_WITHOUT_AUTHORITY).toBe(1);
    expect(counts.DISCLOSED_WITHOUT_AUTHORITY).toBe(0);
  });
});
