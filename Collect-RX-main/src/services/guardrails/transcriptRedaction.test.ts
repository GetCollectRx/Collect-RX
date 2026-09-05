import { describe, expect, it } from 'vitest';
import { redactKnownPhi, redactPhiPatterns, redactTranscript } from './transcriptRedaction.js';
import type { PatientPHI } from '../../pii-vault.js';

const PHI: PatientPHI = {
  patientName: 'Jane Doe',
  dateOfBirth: '1990-03-15',
  subscriberId: 'SUB-998877',
  groupPolicyNumber: 'GRP-4455',
  subscriberName: 'John Doe',
  subscriberDateOfBirth: '1988-01-02',
  healthCardNumber: '1234567890',
};

describe('redactKnownPhi', () => {
  it('redacts every known PHI field, case-insensitively', () => {
    const transcript =
      'Agent: Can you confirm the patient name? Rep: jane doe. Agent: And subscriber ID? Rep: SUB-998877, group GRP-4455.';
    const redacted = redactKnownPhi(transcript, PHI);
    expect(redacted).not.toMatch(/jane doe/i);
    expect(redacted).not.toContain('SUB-998877');
    expect(redacted).not.toContain('GRP-4455');
    expect(redacted).toContain('[REDACTED]:name');
    expect(redacted).toContain('[REDACTED]:id');
  });

  it('leaves text unchanged when a PHI field is missing', () => {
    const transcript = 'No PHI here.';
    expect(redactKnownPhi(transcript, PHI)).toBe(transcript);
  });

  it('does not throw on empty/undefined PHI fields', () => {
    const sparse: PatientPHI = { patientName: 'Jane Doe', dateOfBirth: '', subscriberId: '', groupPolicyNumber: '' };
    expect(() => redactKnownPhi('Jane Doe called.', sparse)).not.toThrow();
  });
});

describe('redactPhiPatterns', () => {
  it('redacts a 10-digit health card number', () => {
    expect(redactPhiPatterns('HCN is 1234567890 on file.')).toBe('HCN is [REDACTED] on file.');
  });

  it('redacts YYYY-MM-DD and MM/DD/YYYY dates', () => {
    expect(redactPhiPatterns('DOB 1990-03-15 or 03/15/1990.')).toBe('DOB [REDACTED] or [REDACTED].');
  });

  it('leaves ordinary text untouched', () => {
    const text = 'Claim approved, payment issued next cycle.';
    expect(redactPhiPatterns(text)).toBe(text);
  });
});

describe('redactTranscript', () => {
  it('applies both known-value and pattern redaction', () => {
    const transcript = 'Patient Jane Doe, DOB 1990-03-15, HCN 1234567890 spoken on call.';
    const redacted = redactTranscript(transcript, PHI);
    expect(redacted).not.toMatch(/jane doe/i);
    expect(redacted).not.toContain('1990-03-15');
    expect(redacted).not.toContain('1234567890');
  });

  it('falls back to pattern-only redaction when phi is null (expired/missing token)', () => {
    const transcript = 'Unknown caller stated DOB 1990-03-15.';
    const redacted = redactTranscript(transcript, null);
    expect(redacted).not.toContain('1990-03-15');
    expect(redacted).toContain('[REDACTED]');
  });
});
