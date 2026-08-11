// ─────────────────────────────────────────────────────────────────────────────
// Agent 04 — PHI Boundary Validator
//
// CRITICAL: PHI (patient names, DOBs, health card numbers) must NEVER cross to
// Vapi. This agent validates the PIIVault tokenization boundary. A failure here
// means PHIPA/PIPEDA compliance is broken — the most severe category of defect.
//
// Every test in this file validates a PHI safety boundary. None should be
// skipped or weakened. If any test fails, stop and escalate immediately.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { tokenize, detokenize, revoke, isValid, purgeExpired } from '../../src/services/pii-vault';

// ─────────────────────────────────────────────────────────────────────────────
// Section A — Core Token Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 04-A — Core token lifecycle', () => {
  it('tokenize → detokenize round-trip preserves patientId', () => {
    const patientId = 'PATIENT-PHI-001';
    const token = tokenize(patientId);
    expect(detokenize(token)).toBe(patientId);
  });

  it('token format is UUID v4 (suitable for Vapi payload — no PHI visible)', () => {
    const token = tokenize('PATIENT-FORMAT-TEST');
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('token does NOT contain the original patientId string', () => {
    const patientId = 'SMITH-JOHN-1985';
    const token = tokenize(patientId);
    expect(token).not.toContain('SMITH');
    expect(token).not.toContain('JOHN');
    expect(token).not.toContain('1985');
  });

  it('same patientId returns the same token (idempotent within TTL)', () => {
    const patientId = 'PATIENT-STABLE-001';
    const t1 = tokenize(patientId);
    const t2 = tokenize(patientId);
    expect(t1).toBe(t2);
  });

  it('different patients get different tokens', () => {
    const t1 = tokenize('PATIENT-A-001');
    const t2 = tokenize('PATIENT-B-002');
    expect(t1).not.toBe(t2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section B — Token Validity and Revocation
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 04-B — Token validity and revocation', () => {
  it('isValid returns true for a freshly created token', () => {
    const token = tokenize('PATIENT-VALID-001');
    expect(isValid(token)).toBe(true);
  });

  it('isValid returns false for an unknown/random token', () => {
    expect(isValid('00000000-0000-0000-0000-000000000000')).toBe(false);
  });

  it('isValid returns false for non-UUID strings', () => {
    expect(isValid('not-a-token')).toBe(false);
    expect(isValid('')).toBe(false);
  });

  it('detokenize throws for unknown token (never silently returns PHI)', () => {
    expect(() => detokenize('00000000-0000-0000-0000-000000000000')).toThrow();
  });

  it('revoke makes token invalid immediately', () => {
    const token = tokenize('PATIENT-REVOKE-001');
    expect(isValid(token)).toBe(true);
    revoke(token);
    expect(isValid(token)).toBe(false);
  });

  it('detokenize throws after revocation', () => {
    const token = tokenize('PATIENT-REVOKE-002');
    revoke(token);
    expect(() => detokenize(token)).toThrow();
  });

  it('revoking a non-existent token does not throw', () => {
    expect(() => revoke('00000000-0000-0000-0000-000000000000')).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section C — Input Validation
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 04-C — Input validation', () => {
  it('tokenize throws for empty string (no-PHI guard)', () => {
    expect(() => tokenize('')).toThrow();
  });

  it('tokenize accepts alphanumeric patient IDs', () => {
    expect(() => tokenize('PATIENT-123-ABC')).not.toThrow();
  });

  it('tokenize accepts UUID-format patient IDs', () => {
    expect(() => tokenize('550e8400-e29b-41d4-a716-446655440000')).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section D — Bulk Tokenization (Vapi batch dispatch safety)
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 04-D — Bulk tokenization', () => {
  it('100 distinct patients each get a unique token', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const token = tokenize(`PATIENT-BULK-${i.toString().padStart(4, '0')}`);
      tokens.add(token);
    }
    expect(tokens.size).toBe(100);
  });

  it('no token in a bulk batch contains raw patient data', () => {
    for (let i = 0; i < 20; i++) {
      const patientId = `SMITH-${i}`;
      const token = tokenize(patientId);
      expect(token).not.toContain('SMITH');
    }
  });

  it('re-tokenizing same 50 patients returns same 50 tokens (stable mapping)', () => {
    const patients = Array.from({ length: 50 }, (_, i) => `STABLE-PATIENT-${i}`);
    const round1 = patients.map(tokenize);
    const round2 = patients.map(tokenize);
    for (let i = 0; i < 50; i++) {
      expect(round1[i]).toBe(round2[i]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section E — Purge / Maintenance Safety
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 04-E — Purge safety', () => {
  it('purgeExpired returns a non-negative number', () => {
    tokenize('PATIENT-PURGE-SAFETY-001');
    const purged = purgeExpired();
    expect(purged).toBeGreaterThanOrEqual(0);
  });

  it('purgeExpired does not remove fresh tokens', () => {
    const patientId = 'PATIENT-FRESH-PURGE-001';
    const token = tokenize(patientId);
    purgeExpired();
    expect(isValid(token)).toBe(true);
    expect(detokenize(token)).toBe(patientId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section F — PHI Boundary Contract Assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 04-F — PHI boundary contract', () => {
  it('a Vapi payload constructed from a token contains no raw PHI', () => {
    const rawPhi = {
      patientName: 'Jane Smith',
      dateOfBirth: '1985-03-15',
      healthCardNumber: 'ON-1234567',
    };

    // Simulate tokenizing before dispatching to Vapi
    const vapiToken = tokenize(JSON.stringify(rawPhi));
    const vapiPayload = { patientToken: vapiToken, carrier: 'sun_life' };

    const payloadString = JSON.stringify(vapiPayload);
    expect(payloadString).not.toContain('Jane');
    expect(payloadString).not.toContain('Smith');
    expect(payloadString).not.toContain('1985');
    expect(payloadString).not.toContain('ON-1234567');
  });

  it('detokenization on backend recovers full PHI from Vapi token', () => {
    const rawPhi = { patientName: 'Jane Smith', dateOfBirth: '1985-03-15' };
    const token = tokenize(JSON.stringify(rawPhi));

    const recovered = JSON.parse(detokenize(token));
    expect(recovered.patientName).toBe('Jane Smith');
    expect(recovered.dateOfBirth).toBe('1985-03-15');
  });
});
