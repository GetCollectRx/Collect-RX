/**
 * Drives mock rep scenarios through the real product units:
 *   normalizeVapiWebhook        (src/webhooks/vapiNormalizer.ts)
 *   transcriptSignalsCarrierBlock (src/server/frontDesk/carrierBlockPhrases.ts)
 *   CallLifecycleMachine        (src/services/arEngine/stateMachine.ts)
 *   checkCarrierBlock           (src/carriers/adapter.ts)
 *
 * The reference driver is the product's intended wiring. Each seeded flaw is
 * a deliberately broken copy of that wiring. The evaluation passes only when
 * the reference driver meets every expectation and every flaw is caught by at
 * least one scenario, which proves the scenarios can actually fail.
 */
import type { CarrierId, PrismaClient } from '@prisma/client';
import { normalizeVapiWebhook } from '../../src/webhooks/vapiNormalizer.js';
import { matchedCarrierBlockPhrase } from '../../src/server/frontDesk/carrierBlockPhrases.js';
import {
  CallLifecycleMachine,
  InMemoryCallLifecycleStore,
  type CallLifecycleState,
} from '../../src/services/arEngine/stateMachine.js';
import { checkCarrierBlock } from '../../src/carriers/adapter.js';
import type { MockEvent, MockScenario } from './mockRep.js';

export type FlawId = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7';

export const FLAWS: ReadonlyArray<{ id: FlawId; title: string }> = [
  { id: 'F1', title: 'Treats our own assistant speech as the carrier talking' },
  { id: 'F2', title: 'Acts on partial transcripts, so one refusal blocks several times' },
  { id: 'F3', title: 'Waits for end-of-call before applying a live refusal' },
  { id: 'F4', title: 'Treats the call connecting as a rep picking up' },
  { id: 'F5', title: 'Blocks on generic IVR wording such as automated system' },
  { id: 'F6', title: 'Skips the CARRIER_BLOCK check when redialling' },
  { id: 'F7', title: 'Applies a block to every practice instead of the practice that tripped it' },
];

interface BlockRow {
  practiceId: string;
  carrierId: string;
  blockedAt: Date;
  resumedAt: Date | null;
}

export interface CallResult {
  scenarioId: string;
  blockEvents: number;
  blockedWhileLive: boolean;
  reachedAgentConnected: boolean;
  finalState: CallLifecycleState;
  followUp: {
    samePracticeSameCarrier: 'allowed' | 'blocked';
    siblingSameCarrier: 'allowed' | 'blocked';
    unrelatedPracticeSameCarrier: 'allowed' | 'blocked';
    samePracticeOtherCarrier: 'allowed' | 'blocked';
  };
}

function fakePrisma(rows: BlockRow[], orgMembers: Map<string, string[]>): PrismaClient {
  const matches = (where: { practiceId?: unknown; carrierId?: unknown; resumedAt?: unknown }): BlockRow | null => {
    const found = rows.find((r) => {
      if (r.resumedAt !== null) return false;
      if (where.carrierId !== undefined && r.carrierId !== where.carrierId) return false;
      const p = where.practiceId;
      if (typeof p === 'string') return r.practiceId === p;
      if (p && typeof p === 'object' && 'in' in p) return (p as { in: string[] }).in.includes(r.practiceId);
      return true;
    });
    return found ?? null;
  };
  return {
    carrierBlockEvent: {
      findFirst: async ({ where }: { where: { practiceId?: unknown; carrierId?: unknown; resumedAt?: unknown } }) =>
        matches(where),
    },
    organizationPractice: {
      findMany: async ({ where }: { where: { practiceId?: unknown; organizationId?: unknown } }) => {
        if (typeof where.practiceId === 'string') {
          const out: Array<{ organizationId: string }> = [];
          for (const [org, members] of orgMembers) if (members.includes(where.practiceId)) out.push({ organizationId: org });
          return out;
        }
        const ids = (where.organizationId as { in: string[] }).in;
        const notId = (where.practiceId as { not: string } | undefined)?.not;
        const out: Array<{ practiceId: string }> = [];
        for (const org of ids) for (const m of orgMembers.get(org) ?? []) if (m !== notId) out.push({ practiceId: m });
        return out;
      },
    },
  } as unknown as PrismaClient;
}

function toNative(ev: MockEvent, callId: string, practiceId: string, carrierId: string): unknown {
  const call = {
    id: callId,
    assistantOverrides: { metadata: { claimId: 'claim-1', carrierId, patientToken: 'token-1', practiceId } },
  };
  switch (ev.kind) {
    case 'status':
      return { message: { type: 'status-update', status: ev.status, call } };
    case 'call-started':
      return { message: { type: 'call.started', startedAt: '2026-11-27T14:00:00.000Z', call } };
    case 'speech':
      return {
        message: {
          type: 'transcript',
          role: ev.speaker === 'carrier' ? 'user' : 'assistant',
          transcriptType: ev.final ? 'final' : 'partial',
          transcript: ev.text,
          call,
        },
      };
    case 'end-of-call':
      return {
        message: {
          type: 'end-of-call-report',
          startedAt: '2026-11-27T14:00:00.000Z',
          endedAt: '2026-11-27T14:06:00.000Z',
          call,
        },
      };
    case 'agent-transition':
      return null;
  }
}

const AGENT_TO_STATE: Record<string, CallLifecycleState> = {
  IVR_Navigator: 'IVR_Navigation',
  Hold_Sentinel: 'Queue_Hold',
  Claims_Agent: 'Agent_Connected',
  Resolution_Closer: 'Adjudication_Extracting',
};

const GENERIC_IVR = ['automated system', 'bot menu'];

export async function runScenario(scenario: MockScenario, flaw?: FlawId): Promise<CallResult> {
  const { practiceId, carrierId, siblingPracticeIds } = scenario.setup;
  const rows: BlockRow[] = [];
  const orgMembers = new Map<string, string[]>([['org-1', [practiceId, ...siblingPracticeIds]]]);
  const prisma = fakePrisma(rows, orgMembers);

  const store = new InMemoryCallLifecycleStore();
  const machine = new CallLifecycleMachine(store, async (cid) =>
    rows.some((r) => r.carrierId === cid && r.resumedAt === null && (flaw === 'F7' || r.practiceId === practiceId)),
  );
  const attemptId = `attempt-${scenario.id}`;
  await machine.start(attemptId, 'claim-1', carrierId);
  await machine.transition(attemptId, 'Dialing');

  let ended = false;
  let blockedWhileLive = false;
  let sawConnected = false;
  let blockPending = false;
  const callId = `call-${scenario.id}`;

  const applyBlock = (): void => {
    if (flaw !== 'F2' && rows.some((r) => r.practiceId === practiceId && r.carrierId === carrierId && r.resumedAt === null)) return;
    rows.push({ practiceId, carrierId, blockedAt: new Date('2026-11-27T14:03:00.000Z'), resumedAt: null });
    if (!ended) blockedWhileLive = true;
  };

  const advance = async (to: CallLifecycleState): Promise<void> => {
    const rec = await store.load(attemptId);
    if (!rec || rec.currentState === to) return;
    try {
      await machine.transition(attemptId, to);
      if (to === 'Agent_Connected') sawConnected = true;
    } catch {
      // A refused or out-of-order transition is the machine doing its job.
    }
  };

  for (const ev of scenario.events) {
    if (ev.kind === 'agent-transition') {
      await advance(AGENT_TO_STATE[ev.toAgent]);
      continue;
    }
    if (ev.kind === 'call-started' && flaw === 'F4') {
      await advance('IVR_Navigation');
      await advance('Queue_Hold');
      await advance('Agent_Connected');
    }
    if (ev.kind === 'status' && ev.status === 'ended') ended = true;

    const payload = normalizeVapiWebhook(toNative(ev, callId, practiceId, carrierId));
    let text: string | undefined;
    if (payload?.type === 'transcript') text = payload.transcript;

    // F1: assistant speech is dropped by the normalizer, so the flaw reads it from the scenario directly.
    if (flaw === 'F1' && ev.kind === 'speech' && ev.speaker === 'assistant' && ev.final) text = ev.text;
    // F2: partial utterances are acted on.
    if (flaw === 'F2' && ev.kind === 'speech' && ev.speaker === 'carrier' && !ev.final) text = ev.text;

    if (text !== undefined) {
      const hit = matchedCarrierBlockPhrase(text) !== null || (flaw === 'F5' && GENERIC_IVR.some((g) => text?.toLowerCase().includes(g)));
      if (hit) {
        if (flaw === 'F3') blockPending = true;
        else applyBlock();
      }
    }
    if (ev.kind === 'end-of-call' && blockPending) applyBlock();
  }

  const finalRec = await store.load(attemptId);
  const finalState = finalRec?.currentState ?? 'Claim_Queued';

  const gate = async (p: string, c: string): Promise<'allowed' | 'blocked'> => {
    if (flaw === 'F6' && p === practiceId) return 'allowed';
    const g = await checkCarrierBlock(prisma, p, c as CarrierId);
    return g.allowed ? 'allowed' : 'blocked';
  };
  const unrelatedPracticeSameCarrierRaw = await gate('practice-unrelated', carrierId);
  const otherCarrier = carrierId === 'SUN_LIFE' ? 'MANULIFE' : 'SUN_LIFE';

  const samePracticeSameCarrier = await gate(practiceId, carrierId);
  let siblingSameCarrier = await gate(siblingPracticeIds[0], carrierId);
  const samePracticeOtherCarrier = await gate(practiceId, otherCarrier);
  let unrelatedPracticeSameCarrier = unrelatedPracticeSameCarrierRaw;
  if (flaw === 'F7' && rows.some((r) => r.carrierId === carrierId)) {
    siblingSameCarrier = 'blocked';
    unrelatedPracticeSameCarrier = 'blocked';
  }
  

  return {
    scenarioId: scenario.id,
    blockEvents: rows.length,
    blockedWhileLive,
    reachedAgentConnected: sawConnected,
    finalState,
    followUp: { samePracticeSameCarrier, siblingSameCarrier, unrelatedPracticeSameCarrier, samePracticeOtherCarrier },
  };
}

/** Returns the list of unmet expectations for one scenario result. Empty means the scenario passed. */
export function judge(scenario: MockScenario, r: CallResult): string[] {
  const e = scenario.expect;
  const fails: string[] = [];
  if ((r.blockEvents > 0) !== e.carrierBlocked) fails.push(`carrierBlocked expected ${e.carrierBlocked}, got ${r.blockEvents > 0}`);
  if (e.blockEvents !== undefined && r.blockEvents !== e.blockEvents) fails.push(`block events expected ${e.blockEvents}, got ${r.blockEvents}`);
  if (e.blockedWhileLive !== undefined && r.blockedWhileLive !== e.blockedWhileLive) fails.push(`blockedWhileLive expected ${e.blockedWhileLive}, got ${r.blockedWhileLive}`);
  if (e.noAgentConnected && r.reachedAgentConnected) fails.push('reached Agent_Connected without an explicit agent transition');
  for (const key of ['samePracticeSameCarrier', 'siblingSameCarrier', 'unrelatedPracticeSameCarrier', 'samePracticeOtherCarrier'] as const) {
    const want = e.followUp?.[key];
    if (want !== undefined && r.followUp[key] !== want) fails.push(`${key} expected ${want}, got ${r.followUp[key]}`);
  }
  return fails;
}
