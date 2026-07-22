import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PatientPHI } from '../src/pii-vault.js';

const PHI: PatientPHI = {
  patientName: 'Test Patient',
  dateOfBirth: '1990-01-01',
  subscriberId: 'SUB-1',
} as PatientPHI;

async function freshVault(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const mod = await import('../src/pii-vault.js');
  return new mod.PIIVault();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('PIIVault claim-lifecycle TTL', () => {
  it('keeps tokens alive far past the old 4-hour window', async () => {
    vi.useFakeTimers();
    const vault = await freshVault();
    const token = vault.tokenize(PHI, 'test', 'p1');

    vi.advanceTimersByTime(45 * 24 * 60 * 60 * 1000);

    const result = vault.detokenize(token, 'test', { practiceId: 'p1' });
    expect(result.success).toBe(true);
    expect(result.phi?.subscriberId).toBe('SUB-1');
  });

  it('honors PHI_VAULT_TTL_DAYS and expires past it', async () => {
    vi.useFakeTimers();
    const vault = await freshVault({ PHI_VAULT_TTL_DAYS: '1' });
    const token = vault.tokenize(PHI, 'test', 'p1');

    vi.advanceTimersByTime(23 * 60 * 60 * 1000);
    expect(vault.detokenize(token, 'test', { practiceId: 'p1' }).success).toBe(true);

    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    const expired = vault.detokenize(token, 'test', { practiceId: 'p1' });
    expect(expired.success).toBe(false);
    expect(expired.error).toBe('TOKEN_EXPIRED');
  });

  it('caps the in-memory access log so long-lived tokens cannot bloat memory', async () => {
    const vault = await freshVault();
    const token = vault.tokenize(PHI, 'test', 'p1');

    for (let i = 0; i < 200; i++) {
      vault.detokenize(token, `caller-${i}`, { practiceId: 'p1' });
    }

    const log = vault.getAuditLog(token, 'test-audit');
    if (!log) throw new Error('expected audit log for live token');
    expect(log.length).toBeLessThanOrEqual(51);
  });
});
