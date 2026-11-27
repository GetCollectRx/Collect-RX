/**
 * Offline tests for the live glue. The sink is the real twin /sink route (so
 * message formats match what a live Vapi call would produce), and the twin
 * events are hand built. A fake fetch stands in for the network.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createCarrierTwin, type TwinEvent } from './carrierTwin.js';
import { baselineScenario } from './scenarios.js';
import { failures, scoreCall } from './scoring.js';
import { collectObservation, joinCall, type GlueDeps } from './liveGlue.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CARRIERS_DIR = path.resolve(here, '../../../carriers');
const TOKEN = 'twin-control-token-for-tests';
const SECRET = 'sink-secret-for-tests-only';
const SC = baselineScenario(CARRIERS_DIR, 'rbc');
const VAPI_ID = 'vapi-call-1';
const SID = 'CA00000000000000000000000000000001';

interface Clock {
  t: number;
}

function makeSink(clock: Clock): ReturnType<typeof createCarrierTwin> {
  const twin = createCarrierTwin({ scenarios: [SC], controlToken: TOKEN, sinkSecret: SECRET, timeScale: 0.001, now: () => clock.t });
  twin.arm(SC.id);
  return twin;
}

async function sinkPost(twin: ReturnType<typeof createCarrierTwin>, clock: Clock, at: number, message: Record<string, unknown>): Promise<void> {
  clock.t = at;
  const res = await request(twin.app).post('/sink').set('x-vapi-secret', SECRET).send({ message: { ...message, call: { id: VAPI_ID } } });
  expect(res.status).toBe(200);
}

function toolCall(name: string, args?: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'tool-calls',
    toolWithToolCallList: [{ toolCall: { id: `tc-${name}`, function: { name, arguments: JSON.stringify(args ?? {}) } } }],
  };
}

const ev = (at: number, kind: TwinEvent['kind'], detail = '', callSid = SID): TwinEvent => ({ at, callSid, scenarioId: SC.id, kind, detail });

function fakeDeps(events: TwinEvent[], seen?: { auth: string[] }): GlueDeps {
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    seen?.auth.push(headers.get('authorization') ?? '');
    if (String(input).endsWith('/twin/events') && headers.get('authorization') === `Bearer ${TOKEN}`) {
      return new Response(JSON.stringify(events), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 401 });
  };
  return { fetchImpl, twinBaseUrl: 'https://twin.example.test', controlToken: TOKEN };
}

/** A clean human-assisted call: hold, a rep answers at 100000, handoff requested 4 s later, report at 130000. */
async function cleanCall(): Promise<TwinEvent[]> {
  const clock: Clock = { t: 0 };
  const sink = makeSink(clock);
  await sinkPost(sink, clock, 101_000, { type: 'status-update', status: 'in-progress' });
  await sinkPost(sink, clock, 104_000, toolCall('request_staff_handoff'));
  await sinkPost(sink, clock, 125_000, toolCall('log_call_outcome', { scenario: 'TRANSFER' }));
  await sinkPost(sink, clock, 130_000, { type: 'end-of-call-report', endedReason: 'customer-ended-call', cost: 0.42, startedAt: '2026-11-10T20:00:00Z', endedAt: '2026-11-10T20:02:00Z' });
  const twinSide = [ev(1_000, 'call_start', SC.title), ev(50_000, 'hold_start', '60s scripted'), ev(100_000, 'rep_answer', 'rep')];
  return [...twinSide, ...sink.events()];
}

describe('liveGlue', () => {
  it('builds an observation from twin and sink events and scoreCall passes a clean call', async () => {
    const events = await cleanCall();
    const seen = { auth: [] as string[] };
    const joined = await collectObservation(fakeDeps(events, seen), { scenarioId: SC.id, vapiCallId: VAPI_ID });

    expect(seen.auth).toEqual([`Bearer ${TOKEN}`]);
    expect(joined.twilioCallSid).toBe(SID);
    expect(joined.observation).toMatchObject({ mode: 'human_assisted', dialedAt: 1_000, endedAt: 130_000, transferRequestedAt: 104_000, claimMarkedResolved: false });
    expect(joined.cost).toBe(0.42);
    expect(joined.endedReason).toBe('customer-ended-call');
    expect(joined.vapiStartedAt).toBe('2026-11-10T20:00:00Z');
    expect(joined.limitations.length).toBeGreaterThan(0);

    const checks = scoreCall(SC, joined.twinEvents, joined.observation);
    expect(failures(checks)).toEqual([]);
    const latency = checks.find((c) => c.name.startsWith('Pickup to staff transfer'));
    expect(latency?.status).toBe('PASS');
    expect(latency?.evidence).toContain('4000 ms');
  });

  it('reports no transfer when the handoff tool was never called, and scoring fails the latency check', async () => {
    const clock: Clock = { t: 0 };
    const sink = makeSink(clock);
    await sinkPost(sink, clock, 125_000, { type: 'end-of-call-report', endedReason: 'hangup', cost: 0.1, startedAt: 'a', endedAt: 'b' });
    const events = [ev(1_000, 'call_start'), ev(50_000, 'hold_start'), ev(100_000, 'rep_answer', 'rep'), ...sink.events()];
    const joined = joinCall(events, { scenarioId: SC.id, vapiCallId: VAPI_ID });
    expect(joined.observation.transferRequestedAt).toBeNull();
    const bad = failures(scoreCall(SC, joined.twinEvents, joined.observation)).map((c) => c.name);
    expect(bad).toContain('Pickup to staff transfer within threshold');
  });

  it('flags a claim marked resolved from log_call_outcome CLAIM_PAID', async () => {
    const clock: Clock = { t: 0 };
    const sink = makeSink(clock);
    await sinkPost(sink, clock, 110_000, toolCall('log_call_outcome', { scenario: 'CLAIM_PAID' }));
    await sinkPost(sink, clock, 125_000, { type: 'end-of-call-report', endedReason: 'x', cost: 0, startedAt: 'a', endedAt: 'b' });
    const joined = joinCall([ev(1_000, 'call_start'), ...sink.events()], { scenarioId: SC.id, vapiCallId: VAPI_ID });
    expect(joined.observation.claimMarkedResolved).toBe(true);
    expect(joined.cost).toBe(0);
  });

  it('takes assistant utterances from twin agent_speech and uses the first handoff only', async () => {
    const clock: Clock = { t: 0 };
    const sink = makeSink(clock);
    await sinkPost(sink, clock, 104_000, toolCall('request_staff_handoff'));
    await sinkPost(sink, clock, 105_000, toolCall('request_staff_handoff'));
    await sinkPost(sink, clock, 125_000, { type: 'end-of-call-report', endedReason: 'x', cost: 0.2, startedAt: 'a', endedAt: 'b' });
    const events = [ev(1_000, 'call_start'), ev(60_000, 'agent_speech', 'hello'), ...sink.events()];
    const joined = joinCall(events, { scenarioId: SC.id, vapiCallId: VAPI_ID });
    expect(joined.observation.transferRequestedAt).toBe(104_000);
    expect(joined.observation.assistantUtterances).toEqual([{ at: 60_000, text: 'hello' }]);
  });

  it('leaves cost null when the report has no usable cost', async () => {
    const clock: Clock = { t: 0 };
    const sink = makeSink(clock);
    await sinkPost(sink, clock, 125_000, { type: 'end-of-call-report', endedReason: 'x', startedAt: 'a', endedAt: 'b' });
    const joined = joinCall([ev(1_000, 'call_start'), ...sink.events()], { scenarioId: SC.id, vapiCallId: VAPI_ID });
    expect(joined.cost).toBeNull();
  });

  describe('strict failures', () => {
    it('aborts when there is no end-of-call-report', async () => {
      const clock: Clock = { t: 0 };
      const sink = makeSink(clock);
      await sinkPost(sink, clock, 104_000, toolCall('request_staff_handoff'));
      expect(() => joinCall([ev(1_000, 'call_start'), ...sink.events()], { scenarioId: SC.id, vapiCallId: VAPI_ID })).toThrow(/end-of-call-report/u);
    });

    it('aborts when the twin never saw the call', async () => {
      const clock: Clock = { t: 0 };
      const sink = makeSink(clock);
      await sinkPost(sink, clock, 125_000, { type: 'end-of-call-report', endedReason: 'x', cost: 0, startedAt: 'a', endedAt: 'b' });
      expect(() => joinCall(sink.events(), { scenarioId: SC.id, vapiCallId: VAPI_ID })).toThrow(/no twin call_start/u);
    });

    it('aborts when there are no sink events for the Vapi call id', () => {
      expect(() => joinCall([ev(1_000, 'call_start')], { scenarioId: SC.id, vapiCallId: VAPI_ID })).toThrow(/no sink events/u);
    });

    it('aborts when two twin calls match, and sinceMs selects the later one', async () => {
      const clock: Clock = { t: 0 };
      const sink = makeSink(clock);
      await sinkPost(sink, clock, 225_000, { type: 'end-of-call-report', endedReason: 'x', cost: 0, startedAt: 'a', endedAt: 'b' });
      const events = [ev(1_000, 'call_start', '', 'CA_OLD'), ev(200_000, 'call_start', '', 'CA_NEW'), ...sink.events()];
      expect(() => joinCall(events, { scenarioId: SC.id, vapiCallId: VAPI_ID })).toThrow(/2 twin calls/u);
      expect(joinCall(events, { scenarioId: SC.id, vapiCallId: VAPI_ID, sinceMs: 150_000 }).twilioCallSid).toBe('CA_NEW');
    });

    it('aborts when sink events were recorded under another scenario', async () => {
      const clock: Clock = { t: 0 };
      const sink = makeSink(clock);
      await sinkPost(sink, clock, 125_000, { type: 'end-of-call-report', endedReason: 'x', cost: 0, startedAt: 'a', endedAt: 'b' });
      const wrong = sink.events().map((e) => ({ ...e, scenarioId: 'rbc.other' }));
      expect(() => joinCall([ev(1_000, 'call_start'), ...wrong], { scenarioId: SC.id, vapiCallId: VAPI_ID })).toThrow(/recorded under scenario/u);
    });

    it('rejects a non array or malformed /twin/events body and a failed fetch', async () => {
      const deps = (body: unknown, status = 200): GlueDeps => ({
        fetchImpl: async () => new Response(JSON.stringify(body), { status }),
        twinBaseUrl: 'https://twin.example.test',
        controlToken: TOKEN,
      });
      await expect(collectObservation(deps({ nope: true }), { scenarioId: SC.id, vapiCallId: VAPI_ID })).rejects.toThrow(/array/u);
      await expect(collectObservation(deps([{ at: 'x' }]), { scenarioId: SC.id, vapiCallId: VAPI_ID })).rejects.toThrow(/missing/u);
      await expect(collectObservation(deps([], 401), { scenarioId: SC.id, vapiCallId: VAPI_ID })).rejects.toThrow(/401/u);
    });
  });
});
