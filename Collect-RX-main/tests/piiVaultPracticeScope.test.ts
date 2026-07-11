import { describe, expect, it, beforeEach } from 'vitest';
import { PIIVault, type PatientPHI } from '../src/pii-vault.js';

const PHI: PatientPHI = {
  patientName: 'Jane Doe',
  dateOfBirth: '1985-03-12',
  subscriberId: 'SUB-123',
  groupPolicyNumber: 'GRP-456',
};

describe('PIIVault practice binding', () => {
  let vault: PIIVault;

  beforeEach(() => {
    vault = new PIIVault();
  });

  it('tokenize requires practiceId', () => {
    expect(() => vault.tokenize(PHI, 'test', '')).toThrow(/practiceId/);
  });

  it('detokenize succeeds only for the owning practice', () => {
    const token = vault.tokenize(PHI, 'test', 'practice-a');
    const ok = vault.detokenize(token, 'test', { practiceId: 'practice-a' });
    expect(ok.success).toBe(true);
    expect(ok.phi?.patientName).toBe('Jane Doe');

    const cross = vault.detokenize(token, 'test', { practiceId: 'practice-b' });
    expect(cross.success).toBe(false);
    expect(cross.error).toBe('PRACTICE_MISMATCH');
  });

  it('detokenize requires practiceId', () => {
    const token = vault.tokenize(PHI, 'test', 'practice-a');
    const r = vault.detokenize(token, 'test', { practiceId: '  ' });
    expect(r.success).toBe(false);
    expect(r.error).toBe('PRACTICE_ID_REQUIRED');
  });
});
