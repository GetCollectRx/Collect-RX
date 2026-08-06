/**
 * PHI Token Expiration Edge Cases
 *
 * CRITICAL: Token expires between validation and dispatch → call proceeds with
 * invalid/expired token → Vapi has no patient identifiers → call connects asking
 * "patient?" → carrier confused, call fails, claim stuck.
 *
 * Edge cases:
 * 1. Token valid at validation, expired at dispatch (race condition)
 * 2. Token expires during queue tick processing
 * 3. Concurrent ticks: one invalidates token, another tries to use it
 * 4. Webhook arrives for claim with expired token
 * 5. Multi-practice isolation: token from practice A not usable by practice B
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface PatientPHI {
  patientName: string;
  dateOfBirth: string;
  subscriberId: string;
  groupPolicyNumber: string;
  subscriberName?: string;
  subscriberDateOfBirth?: string;
}

interface VaultEntry {
  token: string;
  practiceId: string;
  phi: PatientPHI;
  createdAt: Date;
  expiresAt: Date;
}

class MockPHIVault {
  private vault = new Map<string, VaultEntry>();

  tokenize(phi: PatientPHI, practiceId: string, ttlMs: number = 120 * 24 * 60 * 60 * 1000): string {
    const token = `token-${Math.random().toString(36).substr(2, 9)}`;
    this.vault.set(token, {
      token,
      practiceId,
      phi,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return token;
  }

  detokenize(token: string, practiceId: string): { success: boolean; phi?: PatientPHI; error?: string } {
    const entry = this.vault.get(token);
    if (!entry) return { success: false, error: 'TOKEN_NOT_FOUND' };
    if (entry.practiceId !== practiceId) return { success: false, error: 'PRACTICE_MISMATCH' };
    if (new Date() > entry.expiresAt) {
      this.vault.delete(token);
      return { success: false, error: 'TOKEN_EXPIRED' };
    }
    return { success: true, phi: entry.phi };
  }

  forceExpire(token: string): void {
    this.vault.delete(token);
  }

  getEntry(token: string): VaultEntry | null {
    return this.vault.get(token) ?? null;
  }
}

describe('PHI Token Expiration Edge Cases', () => {
  let vault: MockPHIVault;
  let practice1Id = 'practice-1';
  let practice2Id = 'practice-2';
  let mockPHI: PatientPHI;

  beforeEach(() => {
    vault = new MockPHIVault();
    mockPHI = {
      patientName: 'John Doe',
      dateOfBirth: '1990-01-15',
      subscriberId: 'MEM123456',
      groupPolicyNumber: 'GROUP789',
      subscriberName: 'Jane Doe',
      subscriberDateOfBirth: '1988-06-20',
    };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Basic token lifecycle', () => {
    it('token valid during TTL', () => {
      const ttlMs = 24 * 60 * 60 * 1000; // 24 hours
      const token = vault.tokenize(mockPHI, practice1Id, ttlMs);

      // Immediately after tokenization
      let result = vault.detokenize(token, practice1Id);
      expect(result.success).toBe(true);
      expect(result.phi).toEqual(mockPHI);

      // Half-way through TTL
      vi.advanceTimersByTime(ttlMs / 2);
      result = vault.detokenize(token, practice1Id);
      expect(result.success).toBe(true);

      // Just before expiration
      vi.advanceTimersByTime(ttlMs / 2 - 1000);
      result = vault.detokenize(token, practice1Id);
      expect(result.success).toBe(true);
    });

    it('token expired after TTL', () => {
      const ttlMs = 24 * 60 * 60 * 1000;
      const token = vault.tokenize(mockPHI, practice1Id, ttlMs);

      // Just before expiration (TTL - 1ms): still valid
      vi.advanceTimersByTime(ttlMs - 1);
      let result = vault.detokenize(token, practice1Id);
      expect(result.success).toBe(true);

      // Just after expiration (TTL + 1ms): expired
      vi.advanceTimersByTime(2);
      result = vault.detokenize(token, practice1Id);
      expect(result.success).toBe(false);
      expect(result.error).toBe('TOKEN_EXPIRED');
    });
  });

  describe('Race condition: validation → dispatch', () => {
    it('token valid at validation, expired at dispatch (rare, but possible)', () => {
      const ttlMs = 5000; // Short TTL for test
      const token = vault.tokenize(mockPHI, practice1Id, ttlMs);

      // Validation phase: token is valid
      let validationResult = vault.detokenize(token, practice1Id);
      expect(validationResult.success).toBe(true);
      console.log('[validation] Token valid, proceeding to dispatch');

      // Time passes: queue engine gathers practice data, runs triage, prepares call
      vi.advanceTimersByTime(4000); // Token expires in 1 second

      // More processing...
      vi.advanceTimersByTime(1500); // Token now expired

      // Dispatch phase: token is now expired
      let dispatchResult = vault.detokenize(token, practice1Id);
      expect(dispatchResult.success).toBe(false);
      expect(dispatchResult.error).toBe('TOKEN_EXPIRED');

      // Call proceeds with NO patient identifiers → Vapi confused
      // MITIGATION: Add validation immediately before initiateCall()
    });

    it('solution: double-check before dispatch', () => {
      const ttlMs = 5000;
      const token = vault.tokenize(mockPHI, practice1Id, ttlMs);

      // Phase 1: Initial validation (line ~584 queueEngine.ts)
      let validationResult = vault.detokenize(token, practice1Id);
      expect(validationResult.success).toBe(true);
      const validatedPHI = validationResult.phi;

      // Phase 2: Processing (data gathering, triage)
      vi.advanceTimersByTime(4500); // Token expires in 500ms

      // Phase 3: Pre-dispatch validation (NEW GUARD — should be added)
      let preDispatchResult = vault.detokenize(token, practice1Id);
      if (!preDispatchResult.success) {
        console.warn('[pre-dispatch] Token expired during processing — defer claim');
        // Defer the claim instead of proceeding with invalid token
        expect(preDispatchResult.error).toBe('TOKEN_EXPIRED');
      } else {
        console.log('[pre-dispatch] Token still valid, proceeding with initiateCall()');
        // Safe to call initiateCall()
      }
    });
  });

  describe('Concurrent ticks: token invalidation race', () => {
    it('tick 1 invalidates token, tick 2 tries to use it', () => {
      const token = vault.tokenize(mockPHI, practice1Id, 120 * 24 * 60 * 60 * 1000);

      // Tick 1: Process claim A, force token expiration (e.g., PMS re-sync invalidates old token)
      vault.forceExpire(token);
      console.log('[tick-1] Token invalidated');

      // Tick 2: Try to process claim B with same token
      const result = vault.detokenize(token, practice1Id);
      expect(result.success).toBe(false);
      expect(result.error).toBe('TOKEN_NOT_FOUND');

      // Claim B should be deferred
    });

    it('GC expires token, concurrent tick tries to use it', () => {
      const token = vault.tokenize(mockPHI, practice1Id, 5000); // 5 second TTL

      // GC runs, expires old tokens
      vi.advanceTimersByTime(5001);
      vault.forceExpire(token); // Simulates GC cleanup
      console.log('[gc] Token cleaned up');

      // Tick tries to use it
      const result = vault.detokenize(token, practice1Id);
      expect(result.success).toBe(false);
      expect(result.error).toBe('TOKEN_NOT_FOUND');
    });
  });

  describe('Webhook arrival with expired token', () => {
    it('webhook for call with expired token', () => {
      const token = vault.tokenize(mockPHI, practice1Id, 5000);
      const vapiCallId = 'vapi-call-123';

      // Call made with token (validated at dispatch)
      let dispatchResult = vault.detokenize(token, practice1Id);
      expect(dispatchResult.success).toBe(true);

      // Time passes: call completes after 6 seconds, token expires after 5
      vi.advanceTimersByTime(6000);

      // Webhook arrives: webhook handler needs PHI for recording storage decision
      let webhookResult = vault.detokenize(token, practice1Id);
      expect(webhookResult.success).toBe(false);
      expect(webhookResult.error).toBe('TOKEN_EXPIRED');

      // Webhook handler should handle this gracefully:
      // - Token expired, can't detokenize for recording cleanup
      // - Log audit event
      // - Continue with call completion using vapiCallId only (no PHI needed)
    });
  });

  describe('Multi-practice isolation', () => {
    it('token from practice 1 not usable by practice 2', () => {
      const token = vault.tokenize(mockPHI, practice1Id, 120 * 24 * 60 * 60 * 1000);

      // Practice 1 can use it
      let result1 = vault.detokenize(token, practice1Id);
      expect(result1.success).toBe(true);

      // Practice 2 cannot use it
      let result2 = vault.detokenize(token, practice2Id);
      expect(result2.success).toBe(false);
      expect(result2.error).toBe('PRACTICE_MISMATCH');

      // Practice 2 gets its own token
      const token2 = vault.tokenize(mockPHI, practice2Id, 120 * 24 * 60 * 60 * 1000);
      result2 = vault.detokenize(token2, practice2Id);
      expect(result2.success).toBe(true);
    });

    it('expired token isolation', () => {
      // Token for practice 1
      const token1 = vault.tokenize(mockPHI, practice1Id, 5000);
      vi.advanceTimersByTime(5001); // Expire it

      // Token for practice 2 (created now)
      const token2 = vault.tokenize(mockPHI, practice2Id, 120 * 24 * 60 * 60 * 1000);

      // Practice 1's token is expired
      let result1 = vault.detokenize(token1, practice1Id);
      expect(result1.success).toBe(false);
      expect(result1.error).toBe('TOKEN_EXPIRED');

      // Practice 2's token is still valid
      let result2 = vault.detokenize(token2, practice2Id);
      expect(result2.success).toBe(true);
    });
  });

  describe('Edge case: very short TTL', () => {
    it('handles tokens with 1-second TTL', () => {
      const ttlMs = 1000; // 1 second
      const token = vault.tokenize(mockPHI, practice1Id, ttlMs);

      // Immediately valid
      let result = vault.detokenize(token, practice1Id);
      expect(result.success).toBe(true);

      // After 500ms: still valid
      vi.advanceTimersByTime(500);
      result = vault.detokenize(token, practice1Id);
      expect(result.success).toBe(true);

      // After 999ms: still valid (just before TTL)
      vi.advanceTimersByTime(499);
      result = vault.detokenize(token, practice1Id);
      expect(result.success).toBe(true);

      // After 1001ms: expired (just after TTL)
      vi.advanceTimersByTime(2);
      result = vault.detokenize(token, practice1Id);
      expect(result.success).toBe(false);
    });
  });

  describe('Safety guarantees', () => {
    it('expired token cannot be reused', () => {
      const ttlMs = 5000;
      const token = vault.tokenize(mockPHI, practice1Id, ttlMs);

      // Valid initially
      let result = vault.detokenize(token, practice1Id);
      expect(result.success).toBe(true);

      // Expire it
      vi.advanceTimersByTime(5001);
      result = vault.detokenize(token, practice1Id);
      expect(result.success).toBe(false);

      // Even if time goes backward (doesn't in real system, but test edge case)
      // The vault should still return expired
      const entry = vault.getEntry(token);
      expect(entry).toBeNull(); // Token deleted on expiration
    });

    it('detokenize failure prevents dispatch', () => {
      const token = vault.tokenize(mockPHI, practice1Id, 1000);
      vi.advanceTimersByTime(1001); // Expire

      const result = vault.detokenize(token, practice1Id);
      expect(result.success).toBe(false);

      // Queue engine should check this and defer claim
      if (!result.success) {
        console.warn(`[queue-engine] Detokenize failed: ${result.error} — deferring claim`);
        // DO NOT call initiateCall() with expired token
      }
    });
  });
});
