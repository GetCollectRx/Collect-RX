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

// PHI_VAULT_MAX_TOKENS is floored at 1_000 by the module (see pii-vault.ts),
// so every scenario below fills a 1_000-token vault rather than trying to
// go lower.
const MAX = '1000';

describe('PIIVault capacity enforcement (enforceVaultLimit)', () => {
  it('throws once the vault is full and GC purges nothing (all tokens still live)', async () => {
    const vault = await freshVault({ PHI_VAULT_MAX_TOKENS: MAX });
    for (let i = 0; i < 1000; i++) {
      vault.tokenize(PHI, 'fill', `practice-${i}`);
    }
    expect(vault.stats().activeTokens).toBe(1000);
    expect(() => vault.tokenize(PHI, 'overflow', 'practice-overflow')).toThrow(
      /PIIVault capacity exceeded/,
    );
  });

  it('throws when GC purges some expired tokens but the vault is still at capacity — regression for the && / || bug', async () => {
    const vault = await freshVault({ PHI_VAULT_MAX_TOKENS: MAX });

    // Seed the internal map directly so the vault starts already over
    // capacity: 5 expired entries plus 1000 still-live ones (1005 total).
    // This is the state the old `&&` bug could drift into over time, since
    // it only ever blocked tokenize() when GC purged *nothing at all* —
    // once even a handful of entries were expired, the check let growth
    // continue unbounded past MAX_VAULT_SIZE.
    const internalVault = (vault as unknown as { vault: Map<string, unknown> }).vault;
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      internalVault.set(`expired-${i}`, {
        token: `expired-${i}`,
        practiceId: 'practice-expired',
        phi: PHI,
        createdAt: new Date(now - 1000),
        expiresAt: new Date(now - 1), // already expired
        accessLog: [],
      });
    }
    for (let i = 0; i < 1000; i++) {
      internalVault.set(`live-${i}`, {
        token: `live-${i}`,
        practiceId: 'practice-live',
        phi: PHI,
        createdAt: new Date(now),
        expiresAt: new Date(now + 24 * 60 * 60 * 1000), // still live
        accessLog: [],
      });
    }
    expect(internalVault.size).toBe(1005);

    // A single tokenize() call triggers enforceVaultLimit(): GC purges the
    // 5 expired entries (purged = 5, not 0), but 1000 live entries remain —
    // still at MAX_VAULT_SIZE. It must still reject, not silently add an
    // additional entry on top of an already-full vault.
    expect(() => vault.tokenize(PHI, 'overflow', 'practice-overflow')).toThrow(
      /PIIVault capacity exceeded/,
    );
    // The 5 expired entries were reclaimed; the 1000 live ones remain intact.
    expect(internalVault.size).toBe(1000);
    expect(vault.stats().activeTokens).toBe(1000);
  });

  it('lets tokenize proceed once GC reclaims enough room to drop below the cap', async () => {
    vi.useFakeTimers();
    const vault = await freshVault({ PHI_VAULT_MAX_TOKENS: MAX, PHI_VAULT_TTL_DAYS: '1' });

    for (let i = 0; i < 1000; i++) {
      vault.tokenize(PHI, 'fill', `practice-${i}`);
    }
    vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);

    // All 1000 are now expired — GC during enforceVaultLimit() should
    // reclaim the whole vault and let the next tokenize() succeed.
    expect(() => vault.tokenize(PHI, 'after-gc', 'practice-after-gc')).not.toThrow();
    expect(vault.stats().activeTokens).toBe(1);
  });

  it('does not lose unexpired PHI when GC runs — only expired entries are purged', async () => {
    vi.useFakeTimers();
    const vault = await freshVault({ PHI_VAULT_MAX_TOKENS: MAX, PHI_VAULT_TTL_DAYS: '1' });

    const survivor = vault.tokenize(PHI, 'survivor', 'practice-survivor');

    for (let i = 0; i < 5; i++) {
      vault.tokenize(PHI, 'fill-expiring', `practice-expiring-${i}`);
    }
    vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);

    // Re-tokenize the survivor so its TTL is refreshed past the ones
    // about to be GC'd out from under it.
    const refreshedSurvivor = vault.tokenize(PHI, 'refresh', 'practice-survivor-2');

    // The original survivor token shares the same 1-day TTL as the 5
    // filler tokens, so it is expired too by this point — only the
    // freshly re-tokenized entry created after the time advance survives.
    const purged = vault.gc();
    expect(purged).toBe(6);

    const original = vault.detokenize(survivor, 'check', { practiceId: 'practice-survivor' });
    expect(original.success).toBe(false);
    // gc() deletes expired entries outright, so a lookup after GC reports
    // "not found" rather than "expired" (that error path is for entries
    // still in the map whose expiresAt has merely passed).
    expect(original.error).toBe('TOKEN_NOT_FOUND');

    const stillLive = vault.detokenize(refreshedSurvivor, 'check', {
      practiceId: 'practice-survivor-2',
    });
    expect(stillLive.success).toBe(true);
    expect(stillLive.phi?.subscriberId).toBe('SUB-1');
  });

  it('does not leak memory across many tokenize/detokenize/expire cycles', async () => {
    const vault = await freshVault({ PHI_VAULT_MAX_TOKENS: MAX });

    for (let i = 0; i < 10_000; i++) {
      const token = vault.tokenize(PHI, 'cycle', `practice-${i % 50}`);
      vault.detokenize(token, 'cycle-read', { practiceId: `practice-${i % 50}` });
      vault.expireToken(token, 'cycle-cleanup');
    }

    expect(vault.stats().activeTokens).toBe(0);
  });
});
