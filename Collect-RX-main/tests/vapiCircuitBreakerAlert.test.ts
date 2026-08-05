/**
 * The exported vapiCircuitBreaker singleton (not a fresh test instance) must
 * dispatch a critical ops alert the moment it transitions to OPEN — this is
 * the acceptance criterion "OPEN state transition triggers critical alert."
 * Mocks opsAlerts.js so no real SMS/email/webhook attempt happens in tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('vapiCircuitBreaker singleton — OPEN alert wiring', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches a vapi_circuit_open alert exactly once when transitioning to OPEN', async () => {
    const dispatchOpsAlert = vi.fn().mockResolvedValue({ sent: true, channels: [], skippedCooldown: false });
    vi.doMock('../src/server/observability/opsAlerts.js', () => ({ dispatchOpsAlert }));
    vi.stubEnv('VAPI_CB_FAILURE_THRESHOLD', '2');

    const { vapiCircuitBreaker } = await import('../src/vapi/circuitBreaker.js');

    await expect(vapiCircuitBreaker.execute(() => Promise.reject(new Error('one')))).rejects.toThrow();
    expect(dispatchOpsAlert).not.toHaveBeenCalled();

    await expect(vapiCircuitBreaker.execute(() => Promise.reject(new Error('two')))).rejects.toThrow();
    expect(vapiCircuitBreaker.getState()).toBe('OPEN');

    // dispatchOpsAlert is called fire-and-forget (void), give its microtask a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(dispatchOpsAlert).toHaveBeenCalledTimes(1);
    expect(dispatchOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({ alertId: 'vapi_circuit_open', source: 'vapi-circuit-breaker' }),
    );
  });

  it('does not dispatch again on repeated failures while already OPEN', async () => {
    const dispatchOpsAlert = vi.fn().mockResolvedValue({ sent: true, channels: [], skippedCooldown: false });
    vi.doMock('../src/server/observability/opsAlerts.js', () => ({ dispatchOpsAlert }));
    vi.stubEnv('VAPI_CB_FAILURE_THRESHOLD', '1');

    const { vapiCircuitBreaker } = await import('../src/vapi/circuitBreaker.js');
    await expect(vapiCircuitBreaker.execute(() => Promise.reject(new Error('boom')))).rejects.toThrow();
    expect(vapiCircuitBreaker.getState()).toBe('OPEN');

    // Further calls while OPEN are rejected without invoking fn() and without
    // a state change, so no additional alert should fire.
    await expect(vapiCircuitBreaker.execute(() => Promise.reject(new Error('unused')))).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(dispatchOpsAlert).toHaveBeenCalledTimes(1);
  });
});
