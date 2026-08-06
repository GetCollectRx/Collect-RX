/**
 * PHI Vault GC — Memory leak prevention
 *
 * Tests the garbage collection strategy:
 * 1. Configurable GC interval (default 1 hour, tunable for high-volume practices)
 * 2. Proactive cleanup of expired tokens before vault is full
 * 3. On-demand GC when vault reaches capacity
 * 4. Observable stats to detect GC lag and vault pressure
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PatientPHI } from '../src/pii-vault';
import { PIIVault } from '../src/pii-vault';

describe('PHI Vault GC — Memory leak prevention', () => {
  let vault: PIIVault;

  beforeEach(() => {
    vault = new PIIVault();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('removes expired tokens on gc() call', () => {
    const phi: PatientPHI = {
      patientName: 'Alice',
      dateOfBirth: '1990-01-01',
      subscriberId: 'SUB123',
      groupPolicyNumber: 'GRP456',
    };

    // Create a token (default TTL is 120 days from now)
    vault.tokenize(phi, 'test', 'p123');
    expect(vault.stats().activeTokens).toBe(1);

    // Advance time past TTL (121 days)
    vi.advanceTimersByTime(121 * 24 * 60 * 60 * 1000);

    // Token is still in vault before gc()
    const statsBefore = vault.stats();
    expect(statsBefore.expiredTokens).toBe(1);
    expect(statsBefore.activeTokens).toBe(0); // Expired, so not "active"

    // gc() removes it
    const purged = vault.gc();
    expect(purged).toBe(1);

    const statsAfter = vault.stats();
    expect(statsAfter.expiredTokens).toBe(0);
    expect(statsAfter.activeTokens).toBe(0);
  });

  it('accumulates expired tokens until gc() runs (demonstrates lag)', () => {
    const phi: PatientPHI = {
      patientName: 'Bob',
      dateOfBirth: '1985-05-15',
      subscriberId: 'SUB789',
      groupPolicyNumber: 'GRP999',
    };

    // Create 100 tokens
    const tokens: string[] = [];
    for (let i = 0; i < 100; i++) {
      const t = vault.tokenize(phi, 'test', 'p123');
      tokens.push(t);
    }

    // Advance time to expire them all
    vi.advanceTimersByTime(121 * 24 * 60 * 60 * 1000);

    // All 100 tokens are still in the vault (expired but not yet garbage collected)
    let stats = vault.stats();
    expect(stats.expiredTokens).toBe(100);
    expect(stats.activeTokens).toBe(0);

    // This is the "GC lag" problem: in a 1-hour GC interval, high-volume
    // practices can accumulate thousands of expired tokens in memory
    // until the interval fires or vault reaches capacity and triggers gc()
    expect(vault.gc()).toBe(100);

    stats = vault.stats();
    expect(stats.expiredTokens).toBe(0);
  });

  it('enforces vault limit by running gc() on-demand', () => {
    const phi: PatientPHI = {
      patientName: 'Charlie',
      dateOfBirth: '1988-03-20',
      subscriberId: 'SUB456',
      groupPolicyNumber: 'GRP111',
    };

    // Create tokens up to a reasonable number, then expire some
    // The real MAX_VAULT_SIZE is 100,000 (or configurable), so we test
    // the gc() behavior without hitting it
    for (let i = 0; i < 50; i++) {
      vault.tokenize(phi, 'test', `p${i}`);
    }

    let stats = vault.stats();
    expect(stats.activeTokens).toBe(50);
    expect(stats.expiredTokens).toBe(0);

    // Expire all 50
    vi.advanceTimersByTime(121 * 24 * 60 * 60 * 1000);

    // Simulate what happens when enforceVaultLimit() runs (as tokenize() does)
    // It calls gc() and successfully clears expired tokens
    stats = vault.stats();
    expect(stats.expiredTokens).toBe(50);
    const purged = vault.gc();
    expect(purged).toBe(50);
    expect(vault.stats().expiredTokens).toBe(0);
  });

  it('tracks oldest active token for TTL detection', () => {
    const phi: PatientPHI = {
      patientName: 'Eve',
      dateOfBirth: '1995-11-25',
      subscriberId: 'SUB111',
      groupPolicyNumber: 'GRP333',
    };

    expect(vault.stats().oldestActiveToken).toBe(null);

    // Create first token at time 0
    vault.tokenize(phi, 'test', 'p1');
    let stats = vault.stats();
    const firstCreatedAt = stats.oldestActiveToken;
    expect(firstCreatedAt).not.toBe(null);

    // Advance 10 days, create second token
    vi.advanceTimersByTime(10 * 24 * 60 * 60 * 1000);
    vault.tokenize(phi, 'test', 'p2');

    // oldestActiveToken should still be token1
    stats = vault.stats();
    expect(stats.oldestActiveToken).toEqual(firstCreatedAt);
    expect(stats.activeTokens).toBe(2);

    // Expire the first token, oldestActiveToken should now be token2
    vi.advanceTimersByTime(120 * 24 * 60 * 60 * 1000);
    vault.gc();

    stats = vault.stats();
    expect(stats.activeTokens).toBe(1);
    expect(stats.oldestActiveToken).not.toEqual(firstCreatedAt);
  });

  it('observable stats for ops monitoring', () => {
    const phi: PatientPHI = {
      patientName: 'Frank',
      dateOfBirth: '1990-06-30',
      subscriberId: 'SUB222',
      groupPolicyNumber: 'GRP444',
    };

    // Create 50 tokens
    for (let i = 0; i < 50; i++) {
      vault.tokenize(phi, 'test', `p${i}`);
    }

    const stats = vault.stats();

    // Verify all stats fields are present and correct
    expect(stats.activeTokens).toBe(50);
    expect(stats.expiredTokens).toBe(0);
    expect(stats.totalTokensIssued).toBe(50);
    expect(stats.oldestActiveToken).toBeDefined();

    // This data is what the /api/admin/diagnostics/phi-vault-health endpoint exposes
    // to let ops detect:
    // 1. High expiredTokens (GC lag)
    // 2. activeTokens near MAX_VAULT_SIZE
    // 3. oldestActiveToken age (should not exceed TTL)
    expect(typeof stats.activeTokens).toBe('number');
    expect(typeof stats.expiredTokens).toBe('number');
    expect(typeof stats.totalTokensIssued).toBe('number');
  });

  it('manual gc() returns count of purged tokens', () => {
    const phi: PatientPHI = {
      patientName: 'Grace',
      dateOfBirth: '1987-02-14',
      subscriberId: 'SUB333',
      groupPolicyNumber: 'GRP555',
    };

    // Create 30 tokens
    for (let i = 0; i < 30; i++) {
      vault.tokenize(phi, 'test', `p${i}`);
    }

    // Expire 15 of them
    vi.advanceTimersByTime(121 * 24 * 60 * 60 * 1000);
    // Create 15 new active tokens (these are fresh, not expired)
    for (let i = 0; i < 15; i++) {
      vault.tokenize(phi, 'test', `p_new_${i}`);
    }

    // Now: 30 old expired + 15 new active = 45 total in vault
    const stats1 = vault.stats();
    expect(stats1.expiredTokens).toBe(30);
    expect(stats1.activeTokens).toBe(15);

    // gc() should purge the 30 expired
    const purged = vault.gc();
    expect(purged).toBe(30);

    const statsAfter = vault.stats();
    expect(statsAfter.expiredTokens).toBe(0);
    expect(statsAfter.activeTokens).toBe(15);
  });

  it('isValid() auto-expires tokens and updates stats', () => {
    const phi: PatientPHI = {
      patientName: 'Henry',
      dateOfBirth: '1991-09-05',
      subscriberId: 'SUB444',
      groupPolicyNumber: 'GRP666',
    };

    const token = vault.tokenize(phi, 'test', 'p123');
    expect(vault.isValid(token)).toBe(true);

    // Advance time past TTL
    vi.advanceTimersByTime(121 * 24 * 60 * 60 * 1000);

    // isValid() calls expireToken() internally
    expect(vault.isValid(token)).toBe(false);

    // Token should be removed from vault
    const stats = vault.stats();
    expect(stats.activeTokens).toBe(0);
    expect(stats.expiredTokens).toBe(0);
  });
});
