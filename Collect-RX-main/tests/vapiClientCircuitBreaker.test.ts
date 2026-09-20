/**
 * Confirms the circuit breaker is actually wired into src/vapi/client.ts's
 * real request path (vapiRequest()), not just unit-tested in isolation.
 * Mocks global fetch to simulate Vapi failing, and proves the breaker opens
 * and then fails fast without calling fetch again — the literal "mock Vapi
 * timeout/5xx, verify circuit opens" integration test from the backlog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('vapi client — circuit breaker wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VAPI_API_KEY', 'test-key');
    vi.stubEnv('VAPI_CB_FAILURE_THRESHOLD', '5');
    vi.doMock('../src/server/observability/opsAlerts.js', () => ({
      dispatchOpsAlert: vi.fn().mockResolvedValue({ sent: false, channels: [], skippedCooldown: false }),
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('opens after 5 consecutive Vapi timeouts and then fails fast without hitting fetch again', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      return Promise.reject(err);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('../src/vapi/client.js');
    const { vapiCircuitBreaker } = await import('../src/vapi/circuitBreaker.js');

    for (let i = 0; i < 5; i++) {
      await expect(client.getCallStatus('call-1')).rejects.toThrow();
    }
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(vapiCircuitBreaker.getState()).toBe('OPEN');
    expect(vapiCircuitBreaker.getMetrics().failureReasons.timeout).toBe(5);

    // Breaker OPEN — the 6th call must fail immediately without calling fetch.
    await expect(client.getCallStatus('call-1')).rejects.toThrow('circuit breaker is OPEN');
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('classifies a 503 response as a 5xx failure and still opens the breaker at the threshold', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('../src/vapi/client.js');
    const { vapiCircuitBreaker } = await import('../src/vapi/circuitBreaker.js');

    for (let i = 0; i < 5; i++) {
      await expect(client.getCallStatus('call-1')).rejects.toThrow('503');
    }
    expect(vapiCircuitBreaker.getState()).toBe('OPEN');
    expect(vapiCircuitBreaker.getMetrics().failureReasons['5xx']).toBe(5);
  });

  it('a real successful response flows through the breaker as a success and keeps it CLOSED', async () => {
    vi.stubEnv('VAPI_CB_FAILURE_THRESHOLD', '3');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ vapiCallId: 'call-1', status: 'in-progress', startedAt: null, endedAt: null, durationSeconds: null, transcript: null, recordingUrl: null }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' });
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('../src/vapi/client.js');
    const { vapiCircuitBreaker } = await import('../src/vapi/circuitBreaker.js');

    // threshold is 3: fail, fail, SUCCESS (resets streak), fail, fail — must
    // never reach 3 consecutive failures, so the breaker stays CLOSED.
    await expect(client.getCallStatus('call-1')).rejects.toThrow();
    await expect(client.getCallStatus('call-1')).rejects.toThrow();
    await expect(client.getCallStatus('call-1')).resolves.toMatchObject({ vapiCallId: 'call-1' });
    await expect(client.getCallStatus('call-1')).rejects.toThrow();
    await expect(client.getCallStatus('call-1')).rejects.toThrow();

    expect(vapiCircuitBreaker.getState()).toBe('CLOSED');
    expect(vapiCircuitBreaker.getMetrics().totalSuccesses).toBe(1);
    expect(vapiCircuitBreaker.getMetrics().consecutiveFailures).toBe(2);
  });
});
