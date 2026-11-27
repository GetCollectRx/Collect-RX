import { beforeAll, describe, expect, it } from 'vitest';
import type { ClaimStatus, PrismaClient } from '@prisma/client';
import { CARRIER_CONFIGS, isWithinCallWindow, validateDispatch } from '../../src/carriers/adapter';
import { defaultPracticeSettings } from '../../src/server/services/practiceSettingsService';
import {
  resolveOutcomeFromHumanAssistedLog,
  resolveStaffHandoffWithoutLog,
} from '../../src/outcome/humanAssistedOutcomeResolver';
import { redactNarrativePhi, redactPhiPatterns } from '../../src/services/guardrails/transcriptRedaction';
import { CARRIERS, DEFAULT_PARAMS, SCENARIOS, easternParts, rng, type SimParams } from './simHarness';

const SEEDS = Array.from({ length: 25 }, (_, i) => 1000 + i * 7919);

function allAuthorizedSettings() {
  const base = defaultPracticeSettings();
  return {
    ...base,
    voiceAgentEnabled: true,
    carrierConfigs: base.carrierConfigs.map((c) => ({
      ...c,
      enabled: true,
      authorizationSubmitted: true,
      authorizationSubmittedAt: '2026-06-01T00:00:00.000Z',
      providerNumber: 'ON-123456',
    })),
  };
}

function makePrisma(blocked: boolean) {
  return {
    carrierBlockEvent: {
      findFirst: async () => (blocked ? { blockedAt: new Date('2026-01-01T00:00:00Z') } : null),
    },
    organizationPractice: { findMany: async () => [] },
    insuranceClaim: {
      findUnique: async () => ({
        recoveryRoute: 'CALL_CARRIER',
        status: 'IN_QUEUE',
        queueEntry: { scheduledFor: new Date('2020-01-01'), status: 'PENDING' },
      }),
    },
    claimRecoveryAction: { findFirst: async () => null },
    practice: { findUnique: async () => ({ settings: allAuthorizedSettings() }) },
  } as unknown as PrismaClient;
}

beforeAll(() => {
  delete process.env.COLLECTRX_FORCE_CALL_WINDOW;
});

describe('S3 dispatch gates match an independent oracle', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}`, async () => {
      const r = rng(seed);
      const start = Date.UTC(2026, 0, 1);
      const span = 365 * 24 * 3600 * 1000;
      for (let i = 0; i < 120; i++) {
        const carrierId = r.pick(CARRIERS);
        const daysOutstanding = r.int(0, 150);
        const attemptsSoFar = r.int(0, 5);
        const blocked = r.chance(0.1);
        const claimStatus = r.chance(0.1) ? 'APPROVED_PENDING_PAYMENT' : 'IN_QUEUE';
        const when = new Date(start + Math.floor(r.next() * span));
        const { weekday, hour } = easternParts(when);
        const inWindow = weekday >= 1 && weekday <= 5 && hour >= 8 && hour < 17;

        let expected: string;
        if (blocked) expected = 'CARRIER_BLOCK';
        else if (claimStatus === 'APPROVED_PENDING_PAYMENT') expected = 'APPROVED_PENDING_PAYMENT';
        else if (daysOutstanding < 30) expected = 'CLAIM_TOO_YOUNG';
        else if (daysOutstanding > 90) expected = 'ESCALATE_OVER_90';
        else if (attemptsSoFar >= 3) expected = 'MAX_ATTEMPTS';
        else if (!inWindow) expected = 'OUTSIDE_CALL_WINDOW';
        else expected = 'ALLOWED';

        const res = await validateDispatch(makePrisma(blocked), {
          practiceId: 'p1', claimId: 'c1', carrierId, daysOutstanding, attemptsSoFar,
          scheduledFor: when, claimStatus: claimStatus as ClaimStatus,
        });
        const got = res.allowed ? 'ALLOWED' : res.code;
        expect(got, JSON.stringify({ carrierId, daysOutstanding, attemptsSoFar, blocked, claimStatus, when })).toBe(expected);
        expect(isWithinCallWindow(when)).toBe(inWindow);
      }
    });
  }

  it('a blocked carrier is never dialable, regardless of every other input', async () => {
    const r = rng(42);
    for (let i = 0; i < 200; i++) {
      const res = await validateDispatch(makePrisma(true), {
        practiceId: 'p1', claimId: 'c1', carrierId: r.pick(CARRIERS),
        daysOutstanding: r.int(30, 90), attemptsSoFar: 0,
        scheduledFor: new Date('2026-03-04T15:00:00Z'), claimStatus: 'IN_QUEUE' as ClaimStatus,
      });
      expect(res.allowed ? 'ALLOWED' : res.code).toBe('CARRIER_BLOCK');
    }
  });

  it('per-carrier minimum waits are documented but not enforced (known gap, HUMAN-DECISIONS item 1)', async () => {
    // TELUS documents day 21. A 25 day old claim must currently be rejected by the flat 30 day floor.
    const res = await validateDispatch(makePrisma(false), {
      practiceId: 'p1', claimId: 'c1', carrierId: 'telus_adjudicare', daysOutstanding: 25,
      attemptsSoFar: 0, scheduledFor: new Date('2026-03-04T15:00:00Z'), claimStatus: 'IN_QUEUE' as ClaimStatus,
    });
    expect(res.allowed ? 'ALLOWED' : res.code).toBe('CLAIM_TOO_YOUNG');
    expect(CARRIER_CONFIGS.telus_adjudicare.minWaitDays).toBe(21);
  });
});

function fakeLog(scenario: string, matches: boolean | null) {
  return {
    scenario, callSummary: 'summary', unresolvedFields: 'none', repName: 'unknown',
    referenceNumber: 'REF123', matchesExpectedAmount: matches, automationSuspicionFlag: false,
  } as unknown as Parameters<typeof resolveOutcomeFromHumanAssistedLog>[0];
}

describe('S8 outcome resolution invariants', () => {
  const meta = { transcriptUrl: null, durationSeconds: 60 };

  it('only a confirmed-amount CLAIM_PAID can resolve a claim', () => {
    for (const scenario of [...SCENARIOS, 'staff_unavailable', 'SOMETHING_NEW']) {
      for (const matches of [true, false, null]) {
        const { structuredClaimStatus } = resolveOutcomeFromHumanAssistedLog(fakeLog(scenario, matches), meta);
        if (structuredClaimStatus === 'RESOLVED') {
          expect(scenario).toBe('CLAIM_PAID');
          expect(matches).not.toBe(false);
        }
      }
    }
  });

  it('ambiguous scenarios and unknown scenarios always escalate', () => {
    for (const scenario of ['TRANSFER', 'UNCLEAR', 'NEED_INFORMATION', 'PARTIAL_PAYMENT', 'staff_unavailable', 'SOMETHING_NEW']) {
      expect(resolveOutcomeFromHumanAssistedLog(fakeLog(scenario, true), meta).structuredClaimStatus).toBe('ESCALATED');
    }
  });

  it('a handoff with no log never invents an outcome and never hides a block', () => {
    for (const block of [true, false]) {
      for (const inferred of ['RESOLVED', 'DENIED', 'PENDING', 'ESCALATED']) {
        const res = resolveStaffHandoffWithoutLog(
          { outcome: inferred, outcomeDetail: 'x', repName: 'Bob', referenceNumber: 'R1',
            transcriptUrl: null, durationSeconds: 5, carrierBlockDetected: block } as unknown as Parameters<typeof resolveStaffHandoffWithoutLog>[0], meta);
        expect(res.structuredClaimStatus).toBe('ESCALATED');
        expect(res.processed.outcome).toBe('ESCALATED');
        expect(res.processed.carrierBlockDetected).toBe(block);
        expect(res.processed.repName).toBeNull();
        expect(res.processed.referenceNumber).toBeNull();
      }
    }
  });
});

describe('S7 PHI scrub benchmark', () => {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');

  it('documented patterns are always redacted (seeded)', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      for (let i = 0; i < 40; i++) {
        const ten = String(r.int(2000000000, 9999999999));
        const iso = `${r.int(1930, 2012)}-${pad(r.int(1, 12))}-${pad(r.int(1, 28))}`;
        const us = `${pad(r.int(1, 12))}/${pad(r.int(1, 28))}/${r.int(1930, 2012)}`;
        const out = redactPhiPatterns(`call ${ten} dob ${iso} or ${us} done`);
        for (const secret of [ten, iso, us]) expect(out).not.toContain(secret);
      }
    }
  });

  it('narrative scrub catches phone and date formats the base patterns miss (gate)', () => {
    const r = rng(11);
    const makers: Array<(x: ReturnType<typeof rng>) => string> = [
      (x) => `${x.int(200, 999)}-${x.int(200, 999)}-${x.int(1000, 9999)}`,
      (x) => `(${x.int(200, 999)}) ${x.int(200, 999)}-${x.int(1000, 9999)}`,
      (x) => `${x.int(200, 999)}.${x.int(200, 999)}.${x.int(1000, 9999)}`,
      (x) => `${x.int(200, 999)} ${x.int(200, 999)} ${x.int(1000, 9999)}`,
      (x) => `May ${x.int(1, 28)}, ${x.int(1930, 2012)}`,
      (x) => `${x.int(1, 28)}th March ${x.int(1930, 2012)}`,
      (x) => `Sept. ${x.int(1, 28)} ${x.int(1930, 2012)}`,
    ];
    for (const make of makers) {
      for (let i = 0; i < 100; i++) {
        const secret = make(r);
        expect(redactNarrativePhi(`rep said ${secret} on file`)).not.toContain(secret);
      }
    }
  });

  it('narrative scrub leaves ordinary dollar amounts and short numbers alone', () => {
    const text = 'Paid $245.50 on claim 4821, 3 attempts, 38 minutes on hold';
    expect(redactNarrativePhi(text)).toBe(text);
  });

  it('measures recall on formats outside the documented patterns (report, not a gate)', () => {
    const r = rng(7);
    const formats: Array<[string, (r: ReturnType<typeof rng>) => string]> = [
      ['dashed phone', (x) => `${x.int(200, 999)}-${x.int(200, 999)}-${x.int(1000, 9999)}`],
      ['spoken month dob', (x) => `May ${x.int(1, 28)}, ${x.int(1930, 2012)}`],
      ['spaced digits', (x) => `${x.int(200, 999)} ${x.int(200, 999)} ${x.int(1000, 9999)}`],
    ];
    const table: Record<string, string> = {};
    for (const [name, make] of formats) {
      let caught = 0;
      const n = 200;
      for (let i = 0; i < n; i++) {
        const secret = make(r);
        if (!redactPhiPatterns(`ref ${secret} end`).includes(secret)) caught++;
      }
      table[name] = `${((caught / n) * 100).toFixed(0)}%`;
    }
    console.info('[bench] redaction recall outside documented patterns (SIMULATED formats):', table);
    expect(Object.keys(table).length).toBe(3);
  });
});

interface SimResult {
  calls: number; handoffs: number; logged: number; unlogged: number;
  resolvedWithoutEvidence: number; blockPreserved: number; blocksSeen: number; minutesBilled: number;
}

function simulate(seed: number, n: number, p: SimParams, architecture: 'blind' | 'conference'): SimResult {
  const r = rng(seed);
  const res: SimResult = { calls: n, handoffs: 0, logged: 0, unlogged: 0, resolvedWithoutEvidence: 0, blockPreserved: 0, blocksSeen: 0, minutesBilled: 0 };
  for (let i = 0; i < n; i++) {
    const carrier = r.pick(CARRIERS);
    const hold = Math.max(1, p.holdMinutesMean[carrier] * (0.5 + r.next()));
    res.minutesBilled += 2 + hold;
    const block = r.chance(p.carrierBlockRate);
    if (block) res.blocksSeen++;
    if (!r.chance(p.humanDetected)) continue;
    if (!r.chance(p.staffAnswers) || !r.chance(p.repStays)) continue;
    res.handoffs++;
    const listenerOk = r.chance(architecture === 'conference' ? p.listenerLogs : p.blindTransferListenerLogs);
    const meta = { transcriptUrl: null, durationSeconds: 100 };
    let status: string; let carrierBlockDetected: boolean;
    if (listenerOk) {
      res.logged++;
      const scenario = r.pick(SCENARIOS);
      const out = resolveOutcomeFromHumanAssistedLog(fakeLog(scenario, r.chance(0.8)), meta);
      status = out.structuredClaimStatus; carrierBlockDetected = block;
    } else {
      res.unlogged++;
      const out = resolveStaffHandoffWithoutLog(
        { outcome: 'RESOLVED', outcomeDetail: 'x', repName: null, referenceNumber: null,
          transcriptUrl: null, durationSeconds: 1, carrierBlockDetected: block } as unknown as Parameters<typeof resolveStaffHandoffWithoutLog>[0], meta);
      status = out.structuredClaimStatus; carrierBlockDetected = out.processed.carrierBlockDetected;
      if (status === 'RESOLVED') res.resolvedWithoutEvidence++;
    }
    if (block && carrierBlockDetected) res.blockPreserved++;
  }
  return res;
}

describe('end-to-end simulation (SIMULATED assumptions, logic checks only)', () => {
  it('is deterministic for a given seed', () => {
    expect(simulate(5, 500, DEFAULT_PARAMS, 'conference')).toEqual(simulate(5, 500, DEFAULT_PARAMS, 'conference'));
  });

  it('invariants hold across seeds and architectures', () => {
    for (const seed of SEEDS) {
      for (const arch of ['blind', 'conference'] as const) {
        const s = simulate(seed, 1000, DEFAULT_PARAMS, arch);
        expect(s.resolvedWithoutEvidence).toBe(0);
        expect(s.logged + s.unlogged).toBe(s.handoffs);
        expect(s.blockPreserved).toBeLessThanOrEqual(s.blocksSeen);
        if (arch === 'blind') expect(s.logged).toBe(0);
      }
    }
  });

  it('prints the break-even table: playbook logs per 100 calls vs listener success', () => {
    const rows: Record<string, string> = {};
    for (const q of [0, 0.25, 0.5, 0.75, 0.9, 1]) {
      let logged = 0; let total = 0;
      for (const seed of SEEDS) {
        const s = simulate(seed, 1000, { ...DEFAULT_PARAMS, listenerLogs: q }, 'conference');
        logged += s.logged; total += s.calls;
      }
      rows[`listener success ${q}`] = ((logged / total) * 100).toFixed(1);
    }
    console.info('[bench] playbook logs per 100 calls (SIMULATED):', rows);
    const vals = Object.values(rows).map(Number);
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1]);
  });
});

describe('S10 documented pricing arithmetic (ADR 0004)', () => {
  it('in-plan cost stays under the 40 percent throttle line at 1,000 minutes', () => {
    const price = 399; const perMin = 0.135;
    const line = 0.4 * price;
    expect(1000 * perMin).toBeLessThan(line);
    expect(Math.floor(line / perMin)).toBe(1182);
    expect(1200 * perMin).toBeGreaterThan(line);
  });
});

describe('opt-in dispatch policies (B-25, B-18)', () => {
  const tue10am = new Date(Date.UTC(2026, 10, 10, 15, 0)); // 10:00 Eastern
  const run = (days: number, carrierId: Parameters<typeof validateDispatch>[1]['carrierId'], settings: object, env?: string) => {
    if (env) process.env.ENFORCE_CARRIER_MIN_WAIT = env; else delete process.env.ENFORCE_CARRIER_MIN_WAIT;
    const prisma = Object.assign(makePrisma(false), {
      practice: { findUnique: async () => ({ settings: { ...allAuthorizedSettings(), ...settings } }) },
    }) as unknown as PrismaClient;
    return validateDispatch(prisma, {
      practiceId: 'p1', claimId: 'c1', carrierId, daysOutstanding: days, attemptsSoFar: 0,
      scheduledFor: tue10am, claimStatus: 'IN_QUEUE' as ClaimStatus,
    });
  };
  it('per-carrier minimum wait is off by default and stricter when on', async () => {
    const off = await run(31, 'sun_life', {});
    expect(off, JSON.stringify(off)).toMatchObject({ allowed: true });
    const on = await run(31, 'sun_life', {}, 'true');
    expect(CARRIER_CONFIGS.sun_life.minWaitDays).toBeGreaterThanOrEqual(32);
    expect(on.allowed).toBe(false);
    delete process.env.ENFORCE_CARRIER_MIN_WAIT;
  });
  it('90-day ceiling holds unless a human-assisted practice opts out', async () => {
    const base = await run(120, 'sun_life', {});
    expect(base, JSON.stringify(base)).toMatchObject({ allowed: false, code: 'ESCALATE_OVER_90' });
    expect((await run(120, 'sun_life', { humanAssistedAllowsOldClaims: true })).allowed).toBe(true);
    expect(await run(120, 'sun_life', { humanAssistedAllowsOldClaims: true, humanAssistedMode: false }))
      .toMatchObject({ allowed: false, code: 'ESCALATE_OVER_90' });
  });
});
