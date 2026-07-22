// ─────────────────────────────────────────────────────────────────────────────
// Agent 07 — Recovery Gate & Safety Protocol Validator
//
// Validates the dispatch gate logic that prevents unsafe carrier calls:
//   - STOP, WAIT_SYNC, OPEN_CDCP, PRACTICE_GATE routes block all calls
//   - BLOCKING recovery actions prevent dispatch
//   - ON_HOLD status blocks dispatch
//   - Scheduled recall that is not yet due blocks dispatch
//   - CALL_CARRIER route with no blocking gates allows dispatch
//
// Also validates claim router decisions for standard recovery scenarios.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { checkRecoveryDispatchGate } from '../../src/server/recovery/dispatchGate.js';
import { routeClaimRecovery, CLAIM_ROUTER_DECISION_TABLE } from '../../src/server/recovery/claimRouter.js';
import type { PrismaClient } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type MockClaim = {
  recoveryRoute: string;
  status: string;
  queueEntry: { scheduledFor: Date; status: string } | null;
};

function mockPrisma(claim: MockClaim | null, blocking: { title: string; actionType: string } | null) {
  return {
    insuranceClaim: {
      findUnique: vi.fn().mockResolvedValue(claim),
    },
    claimRecoveryAction: {
      findFirst: vi.fn().mockResolvedValue(blocking),
    },
  } as unknown as PrismaClient;
}

const PAST_DATE = new Date(Date.now() - 3_600_000); // 1 hour ago
const FUTURE_DATE = new Date(Date.now() + 3_600_000); // 1 hour from now

// ─────────────────────────────────────────────────────────────────────────────
// Section A — Routes That Block All Calls
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 07-A — Recovery routes that block all calls', () => {
  const BLOCKING_ROUTES = ['STOP', 'WAIT_SYNC', 'OPEN_CDCP', 'PRACTICE_GATE'];

  for (const route of BLOCKING_ROUTES) {
    it(`Route "${route}" blocks carrier dispatch`, async () => {
      const prisma = mockPrisma(
        { recoveryRoute: route, status: 'IN_QUEUE', queueEntry: null },
        null,
      );
      const gate = await checkRecoveryDispatchGate(prisma, 'claim-1');
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toContain(route);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section B — Blocking Recovery Actions
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 07-B — BLOCKING recovery actions prevent dispatch', () => {
  const BLOCKING_ACTION_TYPES = [
    'HUMAN_ESCALATION',
    'PRACTICE_RESUBMIT',
    'PAYMENT_INVESTIGATION',
    'CDCP_RECONSIDERATION',
  ];

  for (const actionType of BLOCKING_ACTION_TYPES) {
    it(`Action type "${actionType}" blocks carrier dispatch`, async () => {
      const prisma = mockPrisma(
        { recoveryRoute: 'CALL_CARRIER', status: 'IN_QUEUE', queueEntry: { scheduledFor: PAST_DATE, status: 'PENDING' } },
        { title: `Blocking: ${actionType}`, actionType },
      );
      const gate = await checkRecoveryDispatchGate(prisma, 'claim-1');
      expect(gate.allowed).toBe(false);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section C — Status-Based Blocks
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 07-C — Status-based dispatch blocks', () => {
  it('ON_HOLD status blocks dispatch', async () => {
    const prisma = mockPrisma(
      { recoveryRoute: 'CALL_CARRIER', status: 'ON_HOLD', queueEntry: { scheduledFor: PAST_DATE, status: 'ON_HOLD' } },
      null,
    );
    const gate = await checkRecoveryDispatchGate(prisma, 'claim-1');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/on.?hold/i);
  });

  it('Non-existent claim blocks dispatch', async () => {
    const prisma = mockPrisma(null, null);
    const gate = await checkRecoveryDispatchGate(prisma, 'claim-999');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/not found/i);
  });

  it('ESCALATED status with non-CALL_CARRIER route blocks dispatch', async () => {
    const prisma = mockPrisma(
      { recoveryRoute: 'PRACTICE_GATE', status: 'ESCALATED', queueEntry: null },
      null,
    );
    const gate = await checkRecoveryDispatchGate(prisma, 'claim-1');
    expect(gate.allowed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section D — Recall Timing
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 07-D — Recall timing enforcement', () => {
  it('Future recall date blocks dispatch (not yet due)', async () => {
    const prisma = mockPrisma(
      { recoveryRoute: 'CALL_CARRIER', status: 'IN_QUEUE', queueEntry: { scheduledFor: FUTURE_DATE, status: 'PENDING' } },
      null,
    );
    const gate = await checkRecoveryDispatchGate(prisma, 'claim-1');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/not yet due/i);
  });

  it('Past recall date allows dispatch', async () => {
    const prisma = mockPrisma(
      { recoveryRoute: 'CALL_CARRIER', status: 'IN_QUEUE', queueEntry: { scheduledFor: PAST_DATE, status: 'PENDING' } },
      null,
    );
    const gate = await checkRecoveryDispatchGate(prisma, 'claim-1');
    expect(gate.allowed).toBe(true);
  });

  it('No queue entry (no recall scheduled) allows dispatch', async () => {
    const prisma = mockPrisma(
      { recoveryRoute: 'CALL_CARRIER', status: 'IN_QUEUE', queueEntry: null },
      null,
    );
    const gate = await checkRecoveryDispatchGate(prisma, 'claim-1');
    expect(gate.allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section E — Claim Router Standard Scenarios
// ─────────────────────────────────────────────────────────────────────────────

const BASE = {
  outstandingCents: 50_000,
  carrierId: 'manulife',
  daysOutstanding: 45,
  attemptCount: 1,
  hasBlockingPracticeGate: false,
  hasOpenCdcpCase: false,
  paymentCorroborated: false,
  outcomeDetail: null,
  gatedClaimStatus: 'IN_QUEUE' as const,
  proposedClaimStatus: 'IN_QUEUE' as const,
};

describe('Agent 07-E — Claim router standard scenarios', () => {
  it('PENDING outcome schedules 72h recall on CALL_CARRIER route', () => {
    const result = routeClaimRecovery({
      ...BASE,
      callOutcome: 'PENDING',
      outcomeDetail: 'Claim still processing',
      gatedClaimStatus: 'IN_QUEUE',
      proposedClaimStatus: 'IN_QUEUE',
    });
    expect(result.route).toBe('CALL_CARRIER');
    expect(result.queueStatus).toBe('PENDING');
    expect(result.scheduledRecallAt).not.toBeNull();
    const hoursUntilRecall = (result.scheduledRecallAt!.getTime() - Date.now()) / 3_600_000;
    expect(hoursUntilRecall).toBeGreaterThan(71);
    expect(hoursUntilRecall).toBeLessThan(73);
  });

  it('ESCALATED outcome with resubmit detail creates PRACTICE_GATE and stops calling', () => {
    const result = routeClaimRecovery({
      ...BASE,
      callOutcome: 'ESCALATED',
      outcomeDetail: 'Claim not on file (legacy: resubmit_required)',
      gatedClaimStatus: 'ESCALATED',
      proposedClaimStatus: 'ESCALATED',
    });
    expect(result.route).toBe('PRACTICE_GATE');
    expect(result.claimStatus).toBe('ON_HOLD');
    expect(result.stopCalling).toBe(true);
  });

  it('DENIED outcome from Sun Life for CDCP opens CDCP path', () => {
    const result = routeClaimRecovery({
      ...BASE,
      carrierId: 'sun_life',
      callOutcome: 'DENIED',
      outcomeDetail: 'CDCP claim denied — not covered',
      gatedClaimStatus: 'DENIED',
      proposedClaimStatus: 'DENIED',
    });
    expect(result.route).toBe('OPEN_CDCP');
    expect(result.openCdcpCase).toBe(true);
    expect(result.stopCalling).toBe(true);
  });

  it('RESOLVED + corroborated outcome stops calling and routes to WAIT_SYNC', () => {
    const result = routeClaimRecovery({
      ...BASE,
      callOutcome: 'RESOLVED',
      outcomeDetail: 'Payment confirmed with reference number',
      gatedClaimStatus: 'RESOLVED',
      proposedClaimStatus: 'RESOLVED',
      paymentCorroborated: true,
    });
    expect(result.stopCalling).toBe(true);
    expect(result.route).toBe('WAIT_SYNC');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section F — Decision Table Completeness
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 07-F — Claim router decision table completeness', () => {
  it('decision table is exported and non-empty', () => {
    expect(CLAIM_ROUTER_DECISION_TABLE).toBeDefined();
    expect(Array.isArray(CLAIM_ROUTER_DECISION_TABLE)).toBe(true);
    expect(CLAIM_ROUTER_DECISION_TABLE.length).toBeGreaterThan(0);
  });

  it('every decision table entry has the required ClaimRouterDecisionRow fields', () => {
    for (const entry of CLAIM_ROUTER_DECISION_TABLE) {
      expect(entry).toHaveProperty('when');
      expect(entry).toHaveProperty('route');
      expect(entry).toHaveProperty('claimStatus');
      expect(entry).toHaveProperty('queueStatus');
      expect(entry).toHaveProperty('recall');
      expect(entry).toHaveProperty('gate');
      expect(entry).toHaveProperty('notes');
    }
  });

  it('STOP route entries have claimStatus of DENIED, RESOLVED, or BLOCKED', () => {
    const VALID_STOP_STATUSES = ['DENIED', 'RESOLVED', 'BLOCKED'];
    const stopEntries = CLAIM_ROUTER_DECISION_TABLE.filter((e: { route: string }) => e.route === 'STOP');
    expect(stopEntries.length).toBeGreaterThan(0);
    for (const entry of stopEntries) {
      expect(VALID_STOP_STATUSES).toContain((entry as { claimStatus: string }).claimStatus);
    }
  });

  it('CALL_CARRIER entries have recall field that is not "none"', () => {
    const callEntries = CLAIM_ROUTER_DECISION_TABLE.filter((e: { route: string }) => e.route === 'CALL_CARRIER');
    for (const entry of callEntries) {
      expect((entry as { recall: string }).recall).not.toBe('none');
    }
  });

  it('all routes in the table are valid recovery routes', () => {
    const VALID_ROUTES = ['STOP', 'CALL_CARRIER', 'WAIT_SYNC', 'OPEN_CDCP', 'PRACTICE_GATE'];
    for (const entry of CLAIM_ROUTER_DECISION_TABLE) {
      expect(VALID_ROUTES).toContain((entry as { route: string }).route);
    }
  });
});
