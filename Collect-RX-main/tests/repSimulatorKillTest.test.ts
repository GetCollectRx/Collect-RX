// Smoke-tests the Rep Simulator ("Kill Test 1") harness's guard chain and
// arg parsing WITHOUT a live Vapi credential or any network access — it must
// fail loud with a clear, specific error rather than faking a call or a
// success path. The cost-ceiling guard itself hits the real local Postgres
// (see tests/testCallCostGuard.test.ts for its dedicated coverage); here we
// only confirm the harness wires it up first, in the documented order.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma.js';
import {
  MissingVapiApiKeyError,
  parseArgs,
  runKillTest,
  UsageError,
} from '../scripts/rep-simulator/run-kill-test.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch {
  dbReady = false;
}

const ORIGINAL_VAPI_API_KEY = process.env.VAPI_API_KEY;

beforeEach(() => {
  delete process.env.VAPI_API_KEY;
});

afterEach(() => {
  if (ORIGINAL_VAPI_API_KEY === undefined) {
    delete process.env.VAPI_API_KEY;
  } else {
    process.env.VAPI_API_KEY = ORIGINAL_VAPI_API_KEY;
  }
});

describe('parseArgs', () => {
  it('requires --carrier', () => {
    expect(() => parseArgs([])).toThrow(UsageError);
    expect(() => parseArgs([])).toThrow(/--carrier is required/);
  });

  it('rejects an unsupported carrier instead of guessing', () => {
    expect(() => parseArgs(['--carrier', 'blue_cross'])).toThrow(UsageError);
    expect(() => parseArgs(['--carrier', 'blue_cross'])).toThrow(/Unknown carrier/);
  });

  it('accepts a supported carrier and generates a testRunId when none is given', () => {
    const parsed = parseArgs(['--carrier', 'green_shield']);
    expect(parsed.carrierId).toBe('green_shield');
    expect(parsed.testRunId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses the caller-supplied --run-id verbatim', () => {
    const runId = randomUUID();
    const parsed = parseArgs(['--carrier', 'green_shield', '--run-id', runId]);
    expect(parsed.testRunId).toBe(runId);
  });
});

describe.skipIf(!dbReady)('runKillTest — guard chain without a live Vapi credential', () => {
  it('fails loud with MissingVapiApiKeyError, not a fake success, when VAPI_API_KEY is unset', async () => {
    const runId = randomUUID();
    await expect(runKillTest(['--carrier', 'green_shield', '--run-id', runId])).rejects.toBeInstanceOf(
      MissingVapiApiKeyError,
    );
  });

  it('names the missing env var and the run/carrier in the failure message', async () => {
    const runId = randomUUID();
    await expect(runKillTest(['--carrier', 'green_shield', '--run-id', runId])).rejects.toThrow(
      /VAPI_API_KEY not set, cannot dispatch a live call/,
    );
  });

  it('checks the cost ceiling before the missing-key check — a bad --carrier still fails on args first', async () => {
    await expect(runKillTest(['--carrier', 'not_a_real_carrier'])).rejects.toBeInstanceOf(UsageError);
  });
});

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});
