/**
 * Webhook Race Condition — Early webhook arrival before CallAttempt creation
 *
 * Race scenario: Webhook arrives between initiateCall() and callAttempt.create()
 * Solution: Buffer early webhook + retry lookup with backoff
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bufferEarlyWebhook, retrieveBufferedWebhook, clearBuffer, getBufferStats } from '../src/server/vapi/webhookBuffer';
import type { VapiWebhookPayloadValidated } from '../src/vapi/webhookValidator';

describe('Webhook Race Condition — Early Arrival Handling', () => {
  beforeEach(() => {
    clearBuffer();
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearBuffer();
    vi.useRealTimers();
  });

  const createMockWebhook = (vapiCallId: string): VapiWebhookPayloadValidated => ({
    type: 'call.ended',
    call: {
      id: vapiCallId,
      status: 'completed',
      durationSeconds: 120,
    },
    transcript: 'Test transcript',
  });

  describe('Webhook buffering', () => {
    it('buffers early webhook before CallAttempt is created', () => {
      const webhook = createMockWebhook('vapi-123');
      expect(getBufferStats().size).toBe(0);

      bufferEarlyWebhook(webhook);

      expect(getBufferStats().size).toBe(1);
      expect(getBufferStats().entries).toContain('vapi-123');
    });

    it('retrieves buffered webhook (one-time use)', () => {
      const webhook = createMockWebhook('vapi-456');
      bufferEarlyWebhook(webhook);

      const retrieved = retrieveBufferedWebhook('vapi-456');

      expect(retrieved).toEqual(webhook);
      expect(getBufferStats().size).toBe(0); // Removed after retrieval
    });

    it('returns null for non-existent buffered webhook', () => {
      const retrieved = retrieveBufferedWebhook('vapi-nonexistent');
      expect(retrieved).toBeNull();
    });

    it('buffers multiple early webhooks independently', () => {
      const webhook1 = createMockWebhook('vapi-111');
      const webhook2 = createMockWebhook('vapi-222');
      const webhook3 = createMockWebhook('vapi-333');

      bufferEarlyWebhook(webhook1);
      bufferEarlyWebhook(webhook2);
      bufferEarlyWebhook(webhook3);

      expect(getBufferStats().size).toBe(3);
      expect(getBufferStats().entries).toEqual(['vapi-111', 'vapi-222', 'vapi-333']);

      // Retrieve one
      const retrieved = retrieveBufferedWebhook('vapi-222');
      expect(retrieved).toEqual(webhook2);
      expect(getBufferStats().size).toBe(2);
      expect(getBufferStats().entries).toEqual(['vapi-111', 'vapi-333']);
    });
  });

  describe('Buffer expiration', () => {
    it('expires buffered webhook after 30 seconds (TTL)', async () => {
      const webhook = createMockWebhook('vapi-timeout');
      bufferEarlyWebhook(webhook);

      expect(getBufferStats().size).toBe(1);

      // Advance time past TTL (30s)
      vi.advanceTimersByTime(31_000);

      // Wait for timeout callback to fire
      await vi.runAllTimersAsync();

      expect(getBufferStats().size).toBe(0);
    });

    it('does not expire buffer entry if retrieved before TTL', async () => {
      const webhook = createMockWebhook('vapi-early-retrieve');
      bufferEarlyWebhook(webhook);

      // Retrieve before TTL
      vi.advanceTimersByTime(15_000); // 15s (within TTL)
      const retrieved = retrieveBufferedWebhook('vapi-early-retrieve');

      expect(retrieved).toEqual(webhook);
      expect(getBufferStats().size).toBe(0);

      // Advance past original TTL - should not error
      vi.advanceTimersByTime(20_000);
      await vi.runAllTimersAsync();

      expect(getBufferStats().size).toBe(0);
    });
  });

  describe('Scenario: Race condition handling', () => {
    it('scenario: webhook arrives 50ms after dispatch, CallAttempt created in 10ms', async () => {
      // Timeline:
      // T+0ms: initiateCall() starts
      // T+5ms: initiateCall() returns vapiCallId
      // T+10ms: callAttempt.create() completes
      // T+55ms: webhook arrives from Vapi

      const vapiCallId = 'vapi-race-test';
      const webhook = createMockWebhook(vapiCallId);

      // Simulate webhook arriving early (before CallAttempt created)
      // In reality, this would happen before the 10ms DB write
      bufferEarlyWebhook(webhook);

      expect(getBufferStats().size).toBe(1);
      expect(retrieveBufferedWebhook(vapiCallId)).toEqual(webhook);
      expect(getBufferStats().size).toBe(0);
    });

    it('scenario: Vapi call ends immediately, webhook arrives within 100ms', async () => {
      // Very quick call end (network error, immediate hangup)
      const vapiCallId = 'vapi-quick-end';
      const webhook = createMockWebhook(vapiCallId);

      // Webhook arrives 50ms after call initiation
      bufferEarlyWebhook(webhook);

      // Simulate queue engine creating CallAttempt at T+60ms
      vi.advanceTimersByTime(60);

      // Webhook handler retries lookup at T+100ms (initial + 100ms backoff)
      vi.advanceTimersByTime(40);

      // At this point, if CallAttempt was created between T+5 and T+60,
      // the retry would find it
      const buffered = retrieveBufferedWebhook(vapiCallId);
      // Buffered should still exist until explicitly retrieved by retry logic
      expect(buffered).toEqual(webhook);
    });

    it('scenario: Multiple calls in flight, some with early webhooks', async () => {
      const calls = [
        { id: 'vapi-1', webhook: createMockWebhook('vapi-1') },
        { id: 'vapi-2', webhook: createMockWebhook('vapi-2') },
        { id: 'vapi-3', webhook: createMockWebhook('vapi-3') },
      ];

      // Webhooks for calls 1 and 3 arrive early
      bufferEarlyWebhook(calls[0].webhook);
      bufferEarlyWebhook(calls[2].webhook);

      expect(getBufferStats().size).toBe(2);

      // Simulate CallAttempt creation for call 2 (not early)
      // (Call 2 webhook arrives normally after CallAttempt exists)

      // Simulate retry logic retrieving buffered webhooks
      const w1 = retrieveBufferedWebhook('vapi-1');
      expect(w1).toEqual(calls[0].webhook);

      expect(getBufferStats().size).toBe(1); // Only vapi-3 left

      const w3 = retrieveBufferedWebhook('vapi-3');
      expect(w3).toEqual(calls[2].webhook);

      expect(getBufferStats().size).toBe(0); // All retrieved
    });
  });

  describe('Safety guarantees', () => {
    it('buffer retrieval is idempotent (second retrieve returns null)', () => {
      const webhook = createMockWebhook('vapi-idempotent');
      bufferEarlyWebhook(webhook);

      const first = retrieveBufferedWebhook('vapi-idempotent');
      expect(first).toEqual(webhook);

      const second = retrieveBufferedWebhook('vapi-idempotent');
      expect(second).toBeNull(); // Already removed after first retrieval
    });

    it('clear buffer removes all entries', () => {
      bufferEarlyWebhook(createMockWebhook('vapi-1'));
      bufferEarlyWebhook(createMockWebhook('vapi-2'));
      bufferEarlyWebhook(createMockWebhook('vapi-3'));

      expect(getBufferStats().size).toBe(3);
      clearBuffer();
      expect(getBufferStats().size).toBe(0);
    });

    it('buffer does not affect non-buffered webhook retrieval', () => {
      // Buffer one webhook
      bufferEarlyWebhook(createMockWebhook('vapi-buffered'));

      // Try to retrieve a different webhook
      const other = retrieveBufferedWebhook('vapi-not-buffered');
      expect(other).toBeNull();

      // Original is still in buffer
      expect(getBufferStats().size).toBe(1);
    });
  });
});
