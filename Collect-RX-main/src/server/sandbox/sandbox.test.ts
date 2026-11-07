import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  applySandboxDefaults,
  expectedSandboxVapiBaseUrl,
  installOutboundBlock,
  isLocalHost,
  sandboxConfigProblems,
  SandboxOutboundBlockedError,
  uninstallOutboundBlock,
} from './sandboxMode';
import {
  classifyScenario,
  isCallScenario,
  loadCallScenarios,
  loadRegistry,
  parseRegistry,
  sandboxClaimNumber,
  scenarioIdFromClaimNumber,
  type CallScenario,
  type RegistryScenario,
} from './scenarioRegistry';
import { buildCallPlan, fillLine } from './callPlan';
import { CarrierSimulator, TRANSFER_WAIT_SECONDS } from './carrierSimulator';
import { createMockVapiRouter, isLoopbackRequest } from './mockVapiApi';
import { scoreCall, type ObservedState } from './scenarioScoring';
import { buildSandboxCsv, SANDBOX_PRACTICES } from './syntheticPractices';
import { resetAllowedHere } from './bootSandbox';

const base = (over: Partial<RegistryScenario>): RegistryScenario => ({
  id: 'X1', tier: 'P0', name: 'x', layer: 'conversation', harness: 'carrier_conversation',
  carrierPersonas: ['cooperative_rep'], carrierName: 'Sun Life', curveball: null, expectedOutcomeText: null, ...over,
});

describe('sandbox outbound block', () => {
  afterEach(() => uninstallOutboundBlock());

  it('blocks fetch and node http to any non-local host and lets local traffic through', async () => {
    installOutboundBlock();
    await expect(fetch('https://api.vapi.ai/call')).rejects.toBeInstanceOf(SandboxOutboundBlockedError);
    await expect(fetch('https://api.twilio.com/')).rejects.toBeInstanceOf(SandboxOutboundBlockedError);
    expect(() => http.request({ hostname: 'api.sendgrid.com', path: '/' })).toThrow(SandboxOutboundBlockedError);
    expect(() => http.get('http://example.com/')).toThrow(SandboxOutboundBlockedError);
    const server = http.createServer((_q, r) => r.end('ok')).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const port = (server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(await res.text()).toBe('ok');
    server.close();
  });

  it('recognises only loopback names as local', () => {
    expect(['localhost', '127.0.0.1', '::1', '[::1]'].every(isLocalHost)).toBe(true);
    expect(['api.vapi.ai', '10.0.0.1', 'collect-rx-staging.internal', '', null].some(isLocalHost)).toBe(false);
  });
});

describe('sandbox configuration', () => {
  it('fills only unset Vapi settings and points Vapi at the in-process mock', () => {
    const env: NodeJS.ProcessEnv = { PORT: '3000', VAPI_API_KEY: 'kept-as-is' };
    applySandboxDefaults(env);
    expect(env.VAPI_BASE_URL).toBe(expectedSandboxVapiBaseUrl());
    expect(env.VAPI_API_KEY).toBe('kept-as-is');
    expect(env.VAPI_WEBHOOK_SECRET).toMatch(/^[0-9a-f]{64}$/u);
    expect(sandboxConfigProblems(env)).toEqual([]);
  });

  it('refuses to start pointed at real Vapi or with a live Stripe key', () => {
    const problems = sandboxConfigProblems({ VAPI_BASE_URL: 'https://api.vapi.ai', VAPI_WEBHOOK_SECRET: 's', STRIPE_SECRET_KEY: 'sk_live_x' });
    expect(problems.join(' ')).toMatch(/VAPI_BASE_URL/u);
    expect(problems.join(' ')).toMatch(/live key/u);
  });

  it('allows the database reset only on the staging app or a local non-production run', () => {
    expect(resetAllowedHere({ FLY_APP_NAME: 'collect-rx-staging' })).toBe(true);
    expect(resetAllowedHere({ FLY_APP_NAME: 'collect-rx' })).toBe(false);
    expect(resetAllowedHere({ NODE_ENV: 'production' })).toBe(false);
    expect(resetAllowedHere({ NODE_ENV: 'development' })).toBe(true);
  });
});

describe('scenario registry', () => {
  it('loads all 248 registry scenarios and every id survives the claim number round trip', () => {
    const all = loadRegistry();
    expect(all).toHaveLength(248);
    for (const s of all) expect(scenarioIdFromClaimNumber(sandboxClaimNumber(s.id, 7))).toBe(s.id);
    expect(scenarioIdFromClaimNumber('CLM-12345')).toBeNull();
  });

  it('plays only call-shaped harnesses as calls', () => {
    const calls = loadCallScenarios();
    expect(calls.length).toBe(loadRegistry().filter(isCallScenario).length);
    expect(calls.every((s) => ['carrier_conversation', 'telephony_controlled', 'transcript_outcome'].includes(s.harness))).toBe(true);
  });

  it.each([
    [{ expectedOutcomeText: 'CLAIM_PAID' }, 'PAID'],
    [{ expectedOutcomeText: 'CARRIER_BLOCK' }, 'REFUSAL'],
    [{ carrierPersonas: ['automation_refusal_rep'] }, 'REFUSAL'],
    [{ expectedOutcomeText: 'Failed technical; safe retry' }, 'TECH_FAIL'],
    [{ expectedOutcomeText: 'NOT_COVERED' }, 'DENIED_NOT_COVERED'],
    [{ expectedOutcomeText: 'Not DENIED' }, 'PAID'],
    [{ expectedOutcomeText: 'CLAIM_NOT_RECEIVED' }, 'NOT_RECEIVED'],
    [{ expectedOutcomeText: 'UNCLEAR or supervisor' }, 'UNCLEAR'],
    [{ expectedOutcomeText: null, carrierPersonas: ['denial_explainer'] }, 'DENIED'],
  ] as const)('maps %j to %s', (over, cls) => {
    expect(classifyScenario(base(over as Partial<RegistryScenario>))).toBe(cls);
  });

  it('ignores malformed registry entries without throwing', () => {
    expect(parseRegistry({ scenarios: [null, { id: 'A' }] })).toHaveLength(2);
    expect(parseRegistry('nonsense')).toEqual([]);
  });
});

const scenario = (cls: CallScenario['outcomeClass']): CallScenario => ({ ...base({}), id: 'T1', outcomeClass: cls });

describe('call plans', () => {
  it('is deterministic per call id and holds 15 to 40 minutes', () => {
    const a = buildCallPlan({ vapiCallId: 'sbx-1', scenario: scenario('PAID'), carrierId: 'sun_life', mode: 'autonomous' });
    const b = buildCallPlan({ vapiCallId: 'sbx-1', scenario: scenario('PAID'), carrierId: 'sun_life', mode: 'autonomous' });
    expect(a).toEqual(b);
    expect(a.holdSeconds).toBeGreaterThanOrEqual(900);
    expect(a.holdSeconds).toBeLessThanOrEqual(2400);
  });

  it('plays the phone menu from the carrier config', () => {
    const plan = buildCallPlan({ vapiCallId: 'sbx-2', scenario: scenario('PAID'), carrierId: 'sun_life', mode: 'autonomous' });
    expect(plan.beforeHandoff.filter((s) => s.kind === 'line' && s.speaker === 'ivr').length).toBeGreaterThan(0);
  });

  it('splits Hold Sentinel calls at the handoff and logs the scribe outcome after the transfer', () => {
    const plan = buildCallPlan({ vapiCallId: 'sbx-3', scenario: scenario('DENIED'), carrierId: 'manulife', mode: 'hold_sentinel' });
    expect(plan.beforeHandoff.at(-1)?.kind).toBe('handoff');
    const log = plan.afterTransfer.find((s) => s.kind === 'logOutcome');
    expect(log && log.kind === 'logOutcome' ? log.args.scenario : null).toBe('CLAIM_DENIED');
    expect(plan.afterTransfer.at(-1)?.kind).toBe('end');
  });

  it('ends a technical failure during the phone menu, with no hold or rep', () => {
    const plan = buildCallPlan({ vapiCallId: 'sbx-4', scenario: scenario('TECH_FAIL'), carrierId: 'rbc', mode: 'hold_sentinel' });
    expect(plan.holdSeconds).toBe(0);
    expect(plan.beforeHandoff.some((s) => s.kind === 'handoff')).toBe(false);
    expect(plan.beforeHandoff.at(-1)).toMatchObject({ kind: 'end', endedReason: 'silence-timed-out' });
  });

  it('fills patient placeholders only from the values given', () => {
    expect(fillLine('{name} {dob} {member} {practice}', { patientName: 'A', dateOfBirth: 'B', memberId: 'C' }, 'P')).toBe('A B C P');
  });
});

interface Posted { type: string; body: Record<string, unknown> }

function dialBody(squadId: string, claimNumber: string): Record<string, unknown> {
  return {
    squadId,
    assistantOverrides: {
      metadata: { claimId: 'c1', practiceId: 'p1', carrierId: 'sun_life', patientToken: 't1' },
      variableValues: { claim_number: claimNumber, insurance_carrier: 'sun_life', patient_name: 'Avery Fictional', patient_dob: '1990-01-01', policy_number: 'SBXM1', practice_name: 'P' },
    },
  };
}

describe('carrier simulator', () => {
  let posted: Posted[];
  let sim: CarrierSimulator;
  beforeEach(() => {
    vi.useFakeTimers();
    posted = [];
    sim = new CarrierSimulator(async (body) => {
      const m = body.message as Record<string, unknown>;
      posted.push({ type: String(m.type), body });
    });
    process.env.VAPI_HUMAN_ASSISTED_SQUAD_ID = 'hs-squad';
  });
  afterEach(() => {
    sim.stopAll();
    vi.useRealTimers();
  });

  it('Hold Sentinel: asks for the staff handoff once after the hold, and only after the hold', async () => {
    const claim = sandboxClaimNumber(loadCallScenarios().find((s) => s.outcomeClass === 'PAID')?.id ?? 'S001', 1);
    sim.start('sbx-hs', dialBody('hs-squad', claim));
    await vi.advanceTimersByTimeAsync(14 * 60 * 1000);
    expect(posted.filter((p) => p.type === 'tool-calls')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(36 * 60 * 1000);
    expect(posted.filter((p) => p.type === 'tool-calls')).toHaveLength(1);
    expect(sim.get('sbx-hs')?.handoffRequestedAt).not.toBeNull();
    expect(sim.get('sbx-hs')?.status).toBe('ended');
  });

  it('Hold Sentinel: a transfer continues the call to the scribe outcome', async () => {
    const claim = sandboxClaimNumber(loadCallScenarios().find((s) => s.outcomeClass === 'PAID')?.id ?? 'S001', 1);
    sim.start('sbx-hs2', dialBody('hs-squad', claim));
    for (let i = 0; i < 300 && !sim.get('sbx-hs2')?.handoffRequestedAt; i += 1) await vi.advanceTimersByTimeAsync(10_000);
    expect(sim.transfer('sbx-hs2', '+16135550150')).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    const tools = posted.filter((p) => p.type === 'tool-calls').map((p) => JSON.stringify(p.body));
    expect(tools.some((t) => t.includes('request_staff_handoff'))).toBe(true);
    expect(tools.some((t) => t.includes('log_call_outcome') && t.includes('CLAIM_PAID'))).toBe(true);
    const report = posted.find((p) => p.type === 'end-of-call-report');
    expect(JSON.stringify(report?.body)).toContain('Avery Fictional');
    expect(sim.get('sbx-hs2')).toMatchObject({ status: 'ended', transferredTo: '+16135550150' });
  });

  it('Hold Sentinel: the rep disconnects when no transfer comes', async () => {
    const claim = sandboxClaimNumber(loadCallScenarios().find((s) => s.outcomeClass === 'PAID')?.id ?? 'S001', 1);
    sim.start('sbx-hs3', dialBody('hs-squad', claim));
    for (let i = 0; i < 300 && !sim.get('sbx-hs3')?.handoffRequestedAt; i += 1) await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync((TRANSFER_WAIT_SECONDS + 1) * 1000);
    expect(sim.get('sbx-hs3')).toMatchObject({ status: 'ended', transferredAt: null });
    expect(posted.some((p) => p.type === 'tool-calls' && JSON.stringify(p.body).includes('log_call_outcome'))).toBe(false);
  });

  it('autonomous: plays the conversation as live transcript lines and ends with the full transcript', async () => {
    const claim = sandboxClaimNumber(loadCallScenarios().find((s) => s.outcomeClass === 'DENIED')?.id ?? 'S001', 1);
    sim.start('sbx-auto', dialBody('autonomous-squad', claim));
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(posted.some((p) => p.type === 'tool-calls')).toBe(false);
    expect(posted.filter((p) => p.type === 'transcript').length).toBeGreaterThan(3);
    const report = posted.find((p) => p.type === 'end-of-call-report');
    expect(JSON.stringify(report?.body)).toMatch(/denied/iu);
  });

  it('ends at once on an end-call command and drops the patient details', async () => {
    const ended: Array<string | null> = [];
    sim.onCallEnded((_call, ctx) => ended.push(ctx.phi?.patientName ?? null));
    sim.start('sbx-end', dialBody('autonomous-squad', 'SBX-S001-0001'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sim.hangUp('sbx-end')).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sim.get('sbx-end')).toMatchObject({ status: 'ended', endedReason: 'assistant-ended-call' });
    expect(ended).toEqual(['Avery Fictional']);
    expect(sim.hangUp('sbx-end')).toBe(false);
  });

  it('resumes a call after a restart without replaying past events, ending an overdue call at once', async () => {
    sim.start('sbx-old', dialBody('autonomous-squad', 'SBX-S001-0001'), { started: new Date(Date.now() - 24 * 60 * 60 * 1000) });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(posted.map((p) => p.type)).toEqual(['end-of-call-report']);
  });
});

describe('mock Vapi API', () => {
  const app = express();
  app.use(express.json());
  const sim = new CarrierSimulator(async () => undefined);
  app.use('/v', createMockVapiRouter(sim));
  afterEach(() => sim.stopAll());

  it('serves only loopback connections from the process itself', () => {
    const req = (addr: string, headers: Record<string, string> = {}) =>
      ({ socket: { remoteAddress: addr }, header: (n: string) => headers[n.toLowerCase()] }) as unknown as Parameters<typeof isLoopbackRequest>[0];
    expect(isLoopbackRequest(req('127.0.0.1'))).toBe(true);
    expect(isLoopbackRequest(req('172.16.0.4'))).toBe(false);
    expect(isLoopbackRequest(req('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' }))).toBe(false);
  });

  it('creates a call, reports it with a control URL, and accepts control commands', async () => {
    const created = await request(app).post('/v/call').set('Authorization', 'Bearer x').send(dialBody('autonomous-squad', 'SBX-S001-0001'));
    expect(created.status).toBe(201);
    const id = String(created.body.id);
    expect(id).toMatch(/^sbx-/u);
    const got = await request(app).get(`/v/call/${id}`).set('Authorization', 'Bearer x');
    expect(got.body.monitor.controlUrl).toMatch(new RegExp(`/control/${id}$`, 'u'));
    expect((await request(app).post(`/v/control/${id}`).send({ type: 'end-call' })).status).toBe(200);
    expect((await request(app).get(`/v/call/${id}`).set('Authorization', 'Bearer x')).body.status).toBe('ended');
    expect((await request(app).post('/v/call').send({})).status).toBe(401);
    expect((await request(app).post(`/v/control/${id}`).send({ type: 'other' })).status).toBe(400);
  });
});

describe('scenario scoring', () => {
  const call = (over: Partial<Parameters<typeof scoreCall>[0]>): Parameters<typeof scoreCall>[0] => ({
    vapiCallId: 'sbx', claimNumber: 'SBX-S001-0001', scenarioId: 'S001', mode: 'autonomous', outcomeClass: 'PAID',
    carrierId: 'sun_life', practiceId: 'p', status: 'ended', startedAt: '', endedAt: '', endedReason: '',
    transferredTo: null, handoffRequestedAt: null, transferredAt: null, ...over,
  });
  const seen = (over: Partial<ObservedState>): ObservedState => ({ claimStatus: 'RESOLVED', attemptOutcome: 'RESOLVED', carrierBlocked: false, transcriptText: 'Rep: paid. Patient [REDACTED]', ...over });
  const phi = { patientName: 'Avery Fictional', dateOfBirth: '', memberId: '' };

  it('passes when the product reached the expected state', () => {
    expect(scoreCall(call({}), seen({}), phi).verdict).toBe('PASS');
  });

  it('fails on the wrong state, a leaked patient name, or a Hold Sentinel call that was never transferred', () => {
    expect(scoreCall(call({}), seen({ claimStatus: 'IN_QUEUE' }), phi).verdict).toBe('FAIL');
    expect(scoreCall(call({}), seen({ transcriptText: 'Patient Avery Fictional' }), phi).checks.find((c) => c.id === 'no-patient-name-in-stored-transcript')?.passed).toBe(false);
    expect(scoreCall(call({ mode: 'hold_sentinel' }), seen({}), phi).checks.find((c) => c.id === 'staff-transfer')?.passed).toBe(false);
  });

  it('expects CARRIER_BLOCK for a refusal', () => {
    expect(scoreCall(call({ outcomeClass: 'REFUSAL' }), seen({ carrierBlocked: true, claimStatus: 'IN_QUEUE' }), null).verdict).toBe('PASS');
    expect(scoreCall(call({ outcomeClass: 'REFUSAL' }), seen({ carrierBlocked: false }), null).verdict).toBe('FAIL');
  });
});

describe('synthetic practices', () => {
  it('builds one dispatchable claim per call scenario with invented, sandbox-marked data', () => {
    const def = SANDBOX_PRACTICES[0];
    if (!def) throw new Error('missing practice');
    const csv = buildSandboxCsv(def, loadCallScenarios());
    const lines = csv.split('\n');
    expect(lines).toHaveLength(loadCallScenarios().length + 1);
    for (const line of lines.slice(1)) {
      const cols = line.split(',');
      expect(cols[0]).toMatch(/^SBX-/u);
      const age = Number(cols[14]);
      expect(age).toBeGreaterThanOrEqual(32);
      expect(age).toBeLessThanOrEqual(88);
    }
    expect(csv).not.toMatch(/@(?!sandbox\.collectrx\.test)/u);
  });
});
