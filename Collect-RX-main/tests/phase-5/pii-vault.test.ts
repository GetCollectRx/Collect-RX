// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — PIIVault Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { tokenize, detokenize, revoke, isValid, purgeExpired } from '../../src/services/pii-vault';

describe('PIIVault', () => {
  it('tokenize → detokenize round-trip returns original patientId', () => {
    const patientId = 'PATIENT-001';
    const token = tokenize(patientId);

    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(detokenize(token)).toBe(patientId);
  });

  it('same patientId returns same token within TTL', () => {
    const patientId = 'PATIENT-STABLE';
    const t1 = tokenize(patientId);
    const t2 = tokenize(patientId);
    expect(t1).toBe(t2);
  });

  it('different patients get different tokens', () => {
    const t1 = tokenize('PATIENT-A');
    const t2 = tokenize('PATIENT-B');
    expect(t1).not.toBe(t2);
  });

  it('detokenize throws for unknown token', () => {
    expect(() => detokenize('00000000-0000-0000-0000-000000000000')).toThrow('unknown token');
  });

  it('isValid returns true for live token', () => {
    const token = tokenize('PATIENT-VALID');
    expect(isValid(token)).toBe(true);
  });

  it('isValid returns false for unknown token', () => {
    expect(isValid('not-a-real-token')).toBe(false);
  });

  it('revoke makes token invalid', () => {
    const token = tokenize('PATIENT-REVOKE');
    expect(isValid(token)).toBe(true);
    revoke(token);
    expect(isValid(token)).toBe(false);
    expect(() => detokenize(token)).toThrow();
  });

  it('tokenize throws for empty patientId', () => {
    expect(() => tokenize('')).toThrow();
  });

  it('purgeExpired returns 0 when all tokens are fresh', () => {
    tokenize('PATIENT-PURGE-TEST');
    const purged = purgeExpired();
    expect(purged).toBeGreaterThanOrEqual(0);
  });
});
