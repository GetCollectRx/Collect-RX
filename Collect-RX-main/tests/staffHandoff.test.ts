import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  HANDOFF_RESULT,
  createPrismaStaffHandoffStore,
  handleStaffHandoff,
  markStaleStaffHandoffsUnknown,
  type CallAuthorization,
  type StaffHandoffDeps,
  type StaffHandoffState,
  type StaffHandoffStore,
} from '../src/webhooks/staffHandoff.js';

const CALL = 'call_123';
const PRACTICE = 'practice_A';

/** In-memory store with the same semantics as the Prisma adapter:
 *  unique vapiCallId on create, and conditional updateMany for FAILED reclaim. */
function memoryStore() {
  const rows = new Map<string, { state: StaffHandoffState; reasonCode: string | null; practiceId: string }>();
  const store: StaffHandoffStore = {
    async claim(vapiCallId, practiceId) {
      if (!rows.has(vapiCallId)) {
        rows.set(vapiCallId, { state: 'REQUESTED', reasonCode: null, practiceId });
        return { kind: 'claimed' };
      }
      const row = rows.get(vapiCallId);
      if (!row) throw new Error('row missing');
      if (row.state === 'FAILED') {
        row.state = 'REQUESTED';
        row.reasonCode = null;
        return { kind: 'claimed' };
      }
      return { kind: 'existing', state: row.state };
    },
    async settle(vapiCallId, state, reasonCode) {
      const row = rows.get(vapiCallId);
      if (row && row.state === 'REQUESTED') {
        row.state = state;
        row.reasonCode = reasonCode;
      }
    },
  };
  return { store, rows };
}

function ambiguousError(): Error {
  const e = new Error('no response');
  e.name = 'VapiAmbiguousOutcomeError';
  return e;
}

function build(opts: {
  auth?: CallAuthorization | null;
  phone?: string | null;
  transfer?: StaffHandoffDeps['transfer'];
  notify?: StaffHandoffDeps['notifyStaff'];
  store?: StaffHandoffStore;
}) {
  const mem = memoryStore();
  const transfer = vi.fn(opts.transfer ?? (async () => undefined));
  const notify = vi.fn(opts.notify ?? (async () => undefined));
  const logError = vi.fn();
  const findCallAuthorization = vi.fn(async () =>
    opts.auth === undefined ? { isHumanAssisted: true, practiceId: PRACTICE } : opts.auth,
  );
  const deps: StaffHandoffDeps = {
    store: opts.store ?? mem.store,
    findCallAuthorization,
    getEscalationPhone: async () => (opts.phone === undefined ? '+15555550100' : opts.phone),
    transfer,
    isAmbiguousTransferError: (err) => err instanceof Error && err.name === 'VapiAmbiguousOutcomeError',
    notifyStaff: notify,
    missedHandoffScript: async () => 'MISSED_SCRIPT',
    logError,
    lookupAttempts: 3,
    lookupDelayMs: 0,
    sleep: async () => undefined,
  };
  const run = () => handleStaffHandoff(deps, { vapiCallId: CALL, practiceId: PRACTICE });
  return { deps, run, transfer, notify, logError, findCallAuthorization, rows: mem.rows };
}

describe('request_staff_handoff authorization', () => {
  it('refuses an autonomous call and never reaches the provider', async () => {
    const t = build({ auth: { isHumanAssisted: false, practiceId: PRACTICE } });
    expect(await t.run()).toBe(HANDOFF_RESULT.REFUSED);
    expect(t.transfer).not.toHaveBeenCalled();
    expect(t.notify).not.toHaveBeenCalled();
  });

  it('refuses when the call has no server-side record after all lookups', async () => {
    const t = build({ auth: null });
    expect(await t.run()).toBe(HANDOFF_RESULT.REFUSED);
    expect(t.findCallAuthorization).toHaveBeenCalledTimes(3);
    expect(t.transfer).not.toHaveBeenCalled();
  });

  it('refuses when the authorized call belongs to a different practice', async () => {
    const t = build({ auth: { isHumanAssisted: true, practiceId: 'practice_B' } });
    expect(await t.run()).toBe(HANDOFF_RESULT.REFUSED);
    expect(t.transfer).not.toHaveBeenCalled();
  });

  it('accepts a legitimate human-assisted call and transfers once', async () => {
    const t = build({});
    expect(await t.run()).toBe(HANDOFF_RESULT.INITIATED);
    expect(t.transfer).toHaveBeenCalledTimes(1);
    expect(t.transfer).toHaveBeenCalledWith(CALL, '+15555550100');
    expect(t.rows.get(CALL)?.state).toBe('PROVIDER_ACCEPTED');
  });

  it('finds a human-assisted row that appears on a later lookup attempt', async () => {
    let calls = 0;
    const t = build({});
    t.findCallAuthorization.mockImplementation(async () => {
      calls += 1;
      return calls < 2 ? null : { isHumanAssisted: true, practiceId: PRACTICE };
    });
    expect(await t.run()).toBe(HANDOFF_RESULT.INITIATED);
    expect(t.transfer).toHaveBeenCalledTimes(1);
  });

  it('does not treat a missing escalation number as a transfer', async () => {
    const t = build({ phone: null });
    expect(await t.run()).toBe('MISSED_SCRIPT');
    expect(t.transfer).not.toHaveBeenCalled();
    expect(t.rows.size).toBe(0);
  });

  it('rejects missing call or practice context without lookups', async () => {
    const t = build({});
    const out = await handleStaffHandoff(t.deps, { vapiCallId: undefined, practiceId: PRACTICE });
    expect(out).toBe(HANDOFF_RESULT.CONTEXT_MISSING);
    expect(t.findCallAuthorization).not.toHaveBeenCalled();
  });
});

describe('duplicate and concurrent invocations', () => {
  it('a second sequential request after acceptance does not transfer again', async () => {
    const t = build({});
    expect(await t.run()).toBe(HANDOFF_RESULT.INITIATED);
    expect(await t.run()).toBe(HANDOFF_RESULT.ALREADY_INITIATED);
    expect(t.transfer).toHaveBeenCalledTimes(1);
  });

  it('concurrent requests produce exactly one provider transfer', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = build({ transfer: async () => { await gate; } });
    const results = Promise.all([t.run(), t.run(), t.run()]);
    release();
    const out = await results;
    expect(t.transfer).toHaveBeenCalledTimes(1);
    expect(out.filter((r) => r === HANDOFF_RESULT.INITIATED)).toHaveLength(1);
    expect(out.filter((r) => r === HANDOFF_RESULT.UNKNOWN_DO_NOT_RETRY)).toHaveLength(2);
  });
});

describe('notification failure after provider acceptance', () => {
  it('still reports INITIATED and records the accepted transfer', async () => {
    const t = build({
      notify: async () => {
        throw new Error('dashboard down');
      },
    });
    expect(await t.run()).toBe(HANDOFF_RESULT.INITIATED);
    expect(t.rows.get(CALL)?.state).toBe('PROVIDER_ACCEPTED');
    expect(t.logError).toHaveBeenCalledWith(
      expect.stringContaining('transfer result unchanged'),
      expect.any(Error),
    );
    expect(t.transfer).toHaveBeenCalledTimes(1);
  });

  it('a failed state write after acceptance does not turn success into a failure', async () => {
    const mem = memoryStore();
    const flaky: StaffHandoffStore = {
      claim: mem.store.claim,
      settle: async () => {
        throw new Error('db blip');
      },
    };
    const t = build({ store: flaky });
    expect(await t.run()).toBe(HANDOFF_RESULT.INITIATED);
    expect(t.transfer).toHaveBeenCalledTimes(1);
  });
});

describe('ambiguous and definitive provider responses', () => {
  it('a timeout settles as OUTCOME_UNKNOWN and is never retried automatically', async () => {
    const t = build({
      transfer: async () => {
        throw ambiguousError();
      },
    });
    expect(await t.run()).toBe(HANDOFF_RESULT.UNKNOWN_DO_NOT_RETRY);
    expect(t.rows.get(CALL)?.state).toBe('OUTCOME_UNKNOWN');
    expect(await t.run()).toBe(HANDOFF_RESULT.UNKNOWN_DO_NOT_RETRY);
    expect(t.transfer).toHaveBeenCalledTimes(1);
  });

  it('an ambiguous outcome still notifies staff as unconfirmed', async () => {
    const t = build({
      transfer: async () => {
        throw ambiguousError();
      },
    });
    await t.run();
    expect(t.notify).toHaveBeenCalledWith(PRACTICE, CALL, 'unconfirmed');
  });

  it('a definitive provider rejection settles as FAILED and a later request may retry', async () => {
    let attempt = 0;
    const t = build({
      transfer: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('VapiClient POST → 422: bad destination');
      },
    });
    expect(await t.run()).toBe('MISSED_SCRIPT');
    expect(t.rows.get(CALL)?.state).toBe('FAILED');
    expect(await t.run()).toBe(HANDOFF_RESULT.INITIATED);
    expect(t.transfer).toHaveBeenCalledTimes(2);
    expect(t.rows.get(CALL)?.state).toBe('PROVIDER_ACCEPTED');
  });

  it('a stale REQUESTED row (crash mid-transfer) is treated as unknown, never retried', async () => {
    const t = build({});
    t.rows.set(CALL, { state: 'REQUESTED', reasonCode: null, practiceId: PRACTICE });
    expect(await t.run()).toBe(HANDOFF_RESULT.UNKNOWN_DO_NOT_RETRY);
    expect(t.transfer).not.toHaveBeenCalled();
  });
});

type Row = { vapiCallId: string; isHumanAssisted: boolean; practiceId: string; staffHandoffState: StaffHandoffState | null; staffHandoffAt: Date | null };
type Where = Record<string, unknown>;

/** Fake callAttempt delegate that evaluates the WHERE clauses this module uses.
 *  An unrecognised clause throws, so a test cannot pass by accident. */
function fakeCallAttempts(rows: Map<string, Row>) {
  const matches = (row: Row, where: Where): boolean =>
    Object.entries(where).every(([key, cond]) => {
      if (key === 'OR') return (cond as Where[]).some((c) => matches(row, c));
      if (key === 'vapiCallId' || key === 'isHumanAssisted' || key === 'practiceId') return row[key] === cond;
      if (key === 'staffHandoffState') return row.staffHandoffState === (cond as StaffHandoffState | null);
      if (key === 'staffHandoffAt') return row.staffHandoffAt !== null && row.staffHandoffAt < (cond as { lt: Date }).lt;
      throw new Error(`unhandled where key: ${key}`);
    });
  return {
    updateMany: async ({ where, data }: { where: Where; data: Partial<Row> }) => {
      let count = 0;
      for (const row of rows.values()) {
        if (matches(row, where)) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
    findUnique: async ({ where }: { where: Where }) => {
      const row = [...rows.values()].find((r) => matches(r, where));
      return row ? { staffHandoffState: row.staffHandoffState } : null;
    },
  };
}

describe('Prisma store against a conditional-update database fake', () => {
  it('lets exactly one of several concurrent invocations transfer', async () => {
    const rows = new Map<string, Row>([
      ['call_9', { vapiCallId: 'call_9', isHumanAssisted: true, practiceId: 'p1', staffHandoffState: null, staffHandoffAt: null }],
    ]);
    const prisma = { callAttempt: fakeCallAttempts(rows) } as unknown as PrismaClient;
    const store = createPrismaStaffHandoffStore(prisma);
    let transfers = 0;
    const deps = (): Parameters<typeof handleStaffHandoff>[0] => ({
      store,
      findCallAuthorization: async () => ({ isHumanAssisted: true, practiceId: 'p1' }),
      getEscalationPhone: async () => '+15555550100',
      transfer: async () => {
        transfers += 1;
        await new Promise((r) => setTimeout(r, 5));
      },
      isAmbiguousTransferError: () => false,
      notifyStaff: async () => undefined,
      missedHandoffScript: async () => 'MISSED',
      logError: () => undefined,
      lookupAttempts: 1,
      sleep: async () => undefined,
    });
    const outputs = await Promise.all(
      Array.from({ length: 5 }, () => handleStaffHandoff(deps(), { vapiCallId: 'call_9', practiceId: 'p1' })),
    );
    expect(transfers).toBe(1);
    expect(outputs.filter((o) => o === HANDOFF_RESULT.INITIATED)).toHaveLength(1);
    expect(rows.get('call_9')?.staffHandoffState).toBe('PROVIDER_ACCEPTED');
  });

  it('never claims an autonomous call row, even if the store is reached directly', async () => {
    const rows = new Map<string, Row>([
      ['call_a', { vapiCallId: 'call_a', isHumanAssisted: false, practiceId: 'p1', staffHandoffState: null, staffHandoffAt: null }],
    ]);
    const store = createPrismaStaffHandoffStore({ callAttempt: fakeCallAttempts(rows) } as unknown as PrismaClient);
    const claim = await store.claim('call_a', 'p1');
    expect(claim.kind).toBe('existing');
    expect(rows.get('call_a')?.staffHandoffState).toBeNull();
  });

  it('retries a FAILED call exactly once per reclaim', async () => {
    const rows = new Map<string, Row>([
      ['call_f', { vapiCallId: 'call_f', isHumanAssisted: true, practiceId: 'p1', staffHandoffState: 'FAILED', staffHandoffAt: null }],
    ]);
    const store = createPrismaStaffHandoffStore({ callAttempt: fakeCallAttempts(rows) } as unknown as PrismaClient);
    expect((await store.claim('call_f', 'p1')).kind).toBe('claimed');
    expect((await store.claim('call_f', 'p1'))).toEqual({ kind: 'existing', state: 'REQUESTED' });
  });
});

describe('stale REQUESTED transfers', () => {
  it('moves only REQUESTED rows older than the window to OUTCOME_UNKNOWN and never re-transfers', async () => {
    const now = new Date('2026-10-10T12:00:00Z');
    const rows = new Map<string, Row>([
      ['old', { vapiCallId: 'old', isHumanAssisted: true, practiceId: 'p1', staffHandoffState: 'REQUESTED', staffHandoffAt: new Date('2026-10-10T11:00:00Z') }],
      ['fresh', { vapiCallId: 'fresh', isHumanAssisted: true, practiceId: 'p1', staffHandoffState: 'REQUESTED', staffHandoffAt: new Date('2026-10-10T11:59:00Z') }],
      ['done', { vapiCallId: 'done', isHumanAssisted: true, practiceId: 'p1', staffHandoffState: 'PROVIDER_ACCEPTED', staffHandoffAt: new Date('2026-10-10T10:00:00Z') }],
    ]);
    const prisma = { callAttempt: fakeCallAttempts(rows) } as unknown as PrismaClient;
    const count = await markStaleStaffHandoffsUnknown(prisma, now, 10 * 60 * 1000);
    expect(count).toBe(1);
    expect(rows.get('old')).toMatchObject({ staffHandoffState: 'OUTCOME_UNKNOWN', staffHandoffReason: 'STALE_REQUESTED_NO_SETTLEMENT' });
    expect(rows.get('fresh')?.staffHandoffState).toBe('REQUESTED');
    expect(rows.get('done')?.staffHandoffState).toBe('PROVIDER_ACCEPTED');
  });
});
