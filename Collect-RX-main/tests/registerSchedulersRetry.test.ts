/**
 * Before this change, every repeatable added here had no `attempts`/`backoff`
 * — a single transient failure meant the job silently didn't run again until
 * its next scheduled fire (BullMQ default: attempts=1, no backoff). This
 * verifies every registered repeatable now carries real retry options.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('registerArJobSchedulers — retry options', () => {
  const addCalls: Array<{ name: string; opts: Record<string, unknown> }> = [];

  beforeEach(() => {
    vi.resetModules();
    addCalls.length = 0;
    vi.doMock('../src/server/jobs/arQueue.js', () => ({
      getArQueue: () => ({
        getRepeatableJobs: async () => [],
        removeRepeatableByKey: async () => undefined,
        add: async (name: string, _data: unknown, opts: Record<string, unknown>) => {
          addCalls.push({ name, opts });
        },
      }),
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('registers RULES_TICK and TRIAGE_CREDENTIAL_HEALTH with attempts + exponential backoff', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv('DISABLE_SCHEDULER', '');
    vi.stubEnv('MARKETING_LOOP_ENABLED', '0');
    vi.stubEnv('LEARNING_LOOP_ENABLED', '');

    const { registerArJobSchedulers } = await import('../src/server/jobs/registerSchedulers.js');
    await registerArJobSchedulers();

    const rulesTick = addCalls.find((c) => c.name === 'RULES_TICK');
    const triage = addCalls.find((c) => c.name === 'TRIAGE_CREDENTIAL_HEALTH');
    const dlqSweep = addCalls.find((c) => c.name === 'DLQ_RETENTION_SWEEP');

    expect(rulesTick).toBeDefined();
    expect(rulesTick?.opts.attempts).toBe(3);
    expect(rulesTick?.opts.backoff).toEqual({ type: 'exponential', delay: 5000 });

    expect(dlqSweep).toBeDefined();
    expect(dlqSweep?.opts.attempts).toBe(3);

    expect(triage).toBeDefined();
    expect(triage?.opts.attempts).toBe(3);
    expect(triage?.opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
  });

  it('does nothing when REDIS_URL is unset (in-process fallback mode)', async () => {
    vi.stubEnv('REDIS_URL', '');
    const { registerArJobSchedulers } = await import('../src/server/jobs/registerSchedulers.js');
    await registerArJobSchedulers();
    expect(addCalls).toHaveLength(0);
  });

  it('does nothing when DISABLE_SCHEDULER is set', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv('DISABLE_SCHEDULER', '1');
    const { registerArJobSchedulers } = await import('../src/server/jobs/registerSchedulers.js');
    await registerArJobSchedulers();
    expect(addCalls).toHaveLength(0);
  });
});
