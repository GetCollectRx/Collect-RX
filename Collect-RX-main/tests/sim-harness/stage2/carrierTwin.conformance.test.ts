/**
 * Offline conformance for the Carrier Twin and its scoring.
 *
 * Proves, before any call is paid for:
 *  1. The twin behaves like a phone system (TwiML shape, key handling, hold,
 *     timeouts, signatures, control auth).
 *  2. Every mutation catches the kind of bad agent it was built for, while a
 *     careful reference agent passes it. A scenario no bad agent can fail is
 *     decoration, and this test fails if one is added.
 *  3. The carrier JSON the product relies on is stale and what that means.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import twilio from 'twilio';
import { afterAll, describe, expect, it } from 'vitest';
import { createCarrierTwin, type CarrierTwin, type TwinEvent } from './carrierTwin.js';
import { allScenarios, baselineScenario, MUTATIONS, TWIN_CARRIERS, type IvrStep, type Scenario } from './scenarios.js';
import { failures, scoreCall, type AgentObservation } from './scoring.js';
import { RunLog } from '../runLog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CARRIERS_DIR = path.resolve(here, '../../../carriers');
const TOKEN = 'twin-control-token-for-tests';
const log = new RunLog(`stage2-twin-${new Date().toISOString().replace(/[:.]/gu, '-')}`);

afterAll(() => {
  const reportPath = log.writeReport();
  console.warn(`[stage2-twin] verdict ${log.verdict()} report ${reportPath}`);
});

function makeTwin(scenarios: Scenario[], extra: { twilioAuthToken?: string; publicBaseUrl?: string } = {}): { twin: CarrierTwin; tick: () => number } {
  let t = 1_000_000;
  const tick = (): number => (t += 1000);
  const twin = createCarrierTwin({ scenarios, controlToken: TOKEN, timeScale: 0.001, now: tick, ...extra });
  return { twin, tick };
}

interface Move {
  digits?: string;
  speech?: string;
}
type Navigator = (step: IvrStep | undefined, prompt: string, input: string) => Move;

function parseGather(xml: string): { action: string; input: string; prompt: string } | null {
  const m = /<Gather ([^>]*)>(?:<Say[^>]*>([\s\S]*?)<\/Say>)?<\/Gather>/u.exec(xml);
  if (!m) return null;
  const attrs = m[1] ?? '';
  const action = /action="([^"]*)"/u.exec(attrs)?.[1] ?? '';
  const input = /input="([^"]*)"/u.exec(attrs)?.[1] ?? '';
  return { action: action.replace(/&amp;/gu, '&'), input, prompt: (m[2] ?? '').replace(/&apos;/gu, "'").replace(/&amp;/gu, '&') };
}

function parseRedirect(xml: string): string | null {
  const m = /<Redirect[^>]*>([^<]*)<\/Redirect>/u.exec(xml);
  return m ? (m[1] ?? '').replace(/&amp;/gu, '&') : null;
}

/** Drives the twin the way Twilio would, using a navigator to decide inputs. */
async function placeCall(twin: CarrierTwin, sc: Scenario, nav: Navigator, callSid: string): Promise<TwinEvent[]> {
  twin.arm(sc.id);
  let res = await request(twin.app).post('/twin/entry').type('form').send({ CallSid: callSid });
  for (let guard = 0; guard < 600; guard += 1) {
    const xml = res.text;
    if (res.status !== 200 || xml.includes('<Hangup/>')) break;
    const g = parseGather(xml);
    if (g) {
      const stepIdx = Number(/[?&]i=(\d+)/u.exec(g.action)?.[1] ?? '0');
      const move = nav(sc.steps[stepIdx], g.prompt, g.input);
      res = await request(twin.app).post(g.action).type('form').send({ CallSid: callSid, Digits: move.digits ?? '', SpeechResult: move.speech ?? '' });
      continue;
    }
    const next = parseRedirect(xml);
    if (!next) break;
    res = await request(twin.app).post(next).type('form').send({ CallSid: callSid, SpeechResult: '' });
  }
  return twin.events(callSid);
}

const ID_DIGITS = '1234567890';

/** Presses what our carrier JSON says, never reads the prompt, cannot speak. */
const memorizing: Navigator = (step) => {
  if (!step) return {};
  if (step.accept.kind === 'digit' || step.accept.kind === 'anyDigit') return { digits: step.jsonDigit ?? '1' };
  if (step.accept.kind === 'digits') return { digits: ID_DIGITS };
  return {};
};

/** Reads the menu text and picks the option that matches the goal. DTMF only, like the product's IVR navigator. */
const attentive: Navigator = (step, prompt) => {
  if (!step) return {};
  if (step.accept.kind === 'speech') return {};
  if (step.accept.kind === 'digits') return { digits: ID_DIGITS };
  if (step.accept.kind === 'digit' || step.accept.kind === 'anyDigit') {
    const want = step.want?.toLowerCase();
    const re = /for ([^,.]+?),? press (\d)/giu;
    let m: RegExpExecArray | null = re.exec(prompt);
    while (m) {
      if (want && (m[1] ?? '').toLowerCase().includes(want.split(' ')[0] ?? '')) return { digits: m[2] };
      m = re.exec(prompt);
    }
    const offered = [...prompt.matchAll(/press (\d)/giu)].map((x) => x[1]);
    if (offered.length === 1 && step.accept.kind === 'digit') return { digits: offered[0] };
    return { digits: step.jsonDigit ?? '1' };
  }
  return {};
};

type BadAgent = 'gullible' | 'optimistic' | 'memorizing';

function observe(kind: 'careful' | BadAgent, sc: Scenario, events: TwinEvent[]): AgentObservation {
  const dialedAt = events[0]?.at ?? 0;
  const endedAt = events[events.length - 1]?.at ?? dialedAt;
  const holdStart = events.find((e) => e.kind === 'hold_start');
  const repAnswer = events.find((e) => e.kind === 'rep_answer');
  const firstSpeechOnHold = events.find((e) => (e.kind === 'hold_announcement' || e.kind === 'rep_answer') && holdStart && e.at >= holdStart.at);
  let transferRequestedAt: number | null = null;
  if (kind === 'gullible') transferRequestedAt = firstSpeechOnHold?.at ?? null;
  if (kind === 'careful' && repAnswer && sc.pickup === 'rep') transferRequestedAt = repAnswer.at + 1000;
  return {
    mode: 'human_assisted',
    dialedAt,
    endedAt,
    transferRequestedAt,
    claimMarkedResolved: kind === 'optimistic',
    assistantUtterances: [],
  };
}

describe('Carrier Twin: phone system mechanics', () => {
  const scenarios = allScenarios(CARRIERS_DIR);

  it('builds baselines for all six carriers from the JSON the product uses, and measures how stale that JSON is', () => {
    expect(TWIN_CARRIERS).toHaveLength(6);
    for (const carrierId of TWIN_CARRIERS) {
      const sc = baselineScenario(CARRIERS_DIR, carrierId);
      expect(sc.steps.length).toBeGreaterThanOrEqual(3);
      const file = readFileSync(path.join(CARRIERS_DIR, `${sc.derivedFrom.split('/')[1]}`), 'utf8');
      const verified = /"last_verified":\s*"([^"]+)"/u.exec(file)?.[1] ?? 'unknown';
      const ageDays = Math.floor((Date.UTC(2026, 10, 10) - Date.parse(verified)) / 86_400_000);
      log.record('Carrier JSON', 'ivr', `${carrierId} IVR map last verified ${verified}`, ageDays > 180 ? 'FINDING' : 'PASS',
        `${ageDays} days old at 2026-11-10. Prompts are paraphrases, not recordings; no source call is attached. The baseline can only confirm the product agrees with its own file.`);
    }
  });

  it('a memorizing agent completes every baseline and the twin records a clean timeline', async () => {
    for (const carrierId of TWIN_CARRIERS) {
      const sc = baselineScenario(CARRIERS_DIR, carrierId);
      const { twin } = makeTwin([sc]);
      const events = await placeCall(twin, sc, memorizing, `CA-${carrierId}`);
      const kinds = events.map((e) => e.kind);
      const ok = kinds.includes('hold_start') && kinds.includes('rep_answer') && !kinds.includes('wrong_key');
      log.record('Twin mechanics', 'baseline', `${carrierId} baseline completes: IVR, hold, rep`, ok ? 'PASS' : 'FAIL', `${events.length} events; ${kinds.filter((k) => k === 'prompt').length} prompts`);
      expect(ok).toBe(true);
    }
  }, 120_000);

  it('rejects wrong keys, re-prompts, and disconnects after too many', async () => {
    const sc = baselineScenario(CARRIERS_DIR, 'sun_life');
    const { twin } = makeTwin([sc]);
    const events = await placeCall(twin, sc, () => ({ digits: '9' }), 'CA-wrong');
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('wrong_key');
    expect(kinds).toContain('disconnect_too_many_wrong');
    expect(kinds).not.toContain('hold_start');
  });

  it('refuses control calls without the token and webhooks without a valid Twilio signature', async () => {
    const sc = baselineScenario(CARRIERS_DIR, 'manulife');
    const { twin } = makeTwin([sc], { twilioAuthToken: 'twilio-test-auth-token', publicBaseUrl: 'https://twin.example.test' });
    const noAuth = await request(twin.app).post('/twin/arm').send({ scenarioId: sc.id });
    expect(noAuth.status).toBe(401);
    const armed = await request(twin.app).post('/twin/arm').set('Authorization', `Bearer ${TOKEN}`).send({ scenarioId: sc.id });
    expect(armed.status).toBe(200);
    const unsigned = await request(twin.app).post('/twin/entry').type('form').send({ CallSid: 'CA-unsigned' });
    expect(unsigned.status).toBe(403);
    const params = { CallSid: 'CA-signed' };
    const signature = twilio.getExpectedTwilioSignature('twilio-test-auth-token', 'https://twin.example.test/twin/entry', params);
    const signed = await request(twin.app).post('/twin/entry').set('X-Twilio-Signature', signature).type('form').send(params);
    expect(signed.status).toBe(200);
    expect(signed.text).toContain('<Gather');
    log.record('Twin mechanics', 'auth', 'Control routes need a token; webhooks need a valid Twilio signature', 'PASS', 'unsigned 403, unauthenticated control 401, signed 200');
  });

  it('the Vapi sink needs its secret, answers tool calls with production\'s exact strings, and records messages with timestamps', async () => {
    const sc = baselineScenario(CARRIERS_DIR, 'rbc');
    const { twin } = makeTwin([sc], {});
    const noSecret = await request(twin.app).post('/sink').send({ message: { type: 'status-update' } });
    expect(noSecret.status).toBe(401);
    let t = 5_000_000;
    const withSink = createCarrierTwin({ scenarios: [sc], controlToken: TOKEN, sinkSecret: 'sink-secret-for-tests-0123456789', timeScale: 0.001, now: () => (t += 1000) });
    withSink.arm(sc.id);
    const bad = await request(withSink.app).post('/sink').set('x-vapi-secret', 'wrong').send({ message: { type: 'status-update' } });
    expect(bad.status).toBe(401);
    const call = { id: 'vapi-call-1' };
    const handoff = await request(withSink.app).post('/sink').set('x-vapi-secret', 'sink-secret-for-tests-0123456789')
      .send({ message: { type: 'tool-calls', call, toolWithToolCallList: [{ name: 'request_staff_handoff', toolCall: { id: 'tc1', function: { name: 'request_staff_handoff', arguments: '{}' } } }] } });
    expect(handoff.body.results[0].result).toBe('HANDOFF INITIATED \u2014 staff have been notified and the call is transferring to them now. Stop talking; do not engage further.');
    const logged = await request(withSink.app).post('/sink').set('x-vapi-secret', 'sink-secret-for-tests-0123456789')
      .send({ message: { type: 'tool-calls', call, toolWithToolCallList: [{ name: 'log_call_outcome', toolCall: { id: 'tc2', function: { name: 'log_call_outcome', arguments: JSON.stringify({ scenario: 'CLAIM_PAID', callSummary: 'x' }) } } }] } });
    expect(logged.body.results[0].result).toBe('Logged.');
    const big = await request(withSink.app).post('/sink').set('x-vapi-secret', 'sink-secret-for-tests-0123456789')
      .send({ message: { type: 'end-of-call-report', call, endedReason: 'customer-ended-call', cost: 0.42, artifact: { transcript: 'x'.repeat(100_000) } } });
    expect(big.status).toBe(200);
    const kinds = withSink.events('vapi-call-1').map((e) => `${e.kind}:${e.detail.split(' ')[0]}`);
    expect(kinds).toEqual(['vapi_tool_call:request_staff_handoff', 'vapi_tool_call:log_call_outcome', 'vapi_message:end-of-call-report']);
    expect(withSink.events('vapi-call-1')[2]?.detail).toContain('cost=0.42');
    log.record('Twin mechanics', 'sink', 'Vapi sink: secret required, production tool strings returned, messages timestamped', 'PASS', 'unauthorized 401 twice; handoff and log results exact; 100 KB report accepted');
  });

  it('XML-escapes scenario text and never echoes caller identifiers', async () => {
    const sc = baselineScenario(CARRIERS_DIR, 'rbc');
    const risky: Scenario = { ...sc, id: 'rbc.escape', steps: [{ ...(sc.steps[0] as IvrStep), prompt: 'Press 1 for <claims> & "billing"' }, ...sc.steps.slice(1)] };
    const { twin } = makeTwin([risky]);
    twin.arm(risky.id);
    const res = await request(twin.app).post('/twin/entry').type('form').send({ CallSid: 'CA-esc' });
    expect(res.text).toContain('&lt;claims&gt; &amp; &quot;billing&quot;');
    const events = await placeCall(twin, risky, memorizing, 'CA-esc2');
    expect(JSON.stringify(events)).not.toContain(ID_DIGITS);
  });

  it('every scenario is discriminating: a careful agent passes, and at least one bad agent is caught', async () => {
    const rows: string[] = [];
    for (const sc of scenarios.filter((s) => s.category === 'mutation')) {
      const { twin } = makeTwin([sc]);
      const navCareful = await placeCall(twin, sc, attentive, `CA-careful-${sc.id}`);
      const carefulFail = failures(scoreCall(sc, navCareful, observe('careful', sc, navCareful)));

      const { twin: twinBad } = makeTwin([sc]);
      const memEvents = await placeCall(twinBad, sc, memorizing, `CA-mem-${sc.id}`);
      const caught: string[] = [];
      for (const [agent, events] of [['memorizing', memEvents], ['gullible', memEvents], ['optimistic', memEvents]] as const) {
        const obs = agent === 'memorizing' ? observe('careful', sc, events) : observe(agent, sc, events);
        if (failures(scoreCall(sc, events, obs)).length > 0) caught.push(agent);
      }
      const discriminates = caught.length > 0;
      const referencePasses = carefulFail.length === 0;
      rows.push(`${sc.id}: reference ${referencePasses ? 'passes' : `FAILS (${carefulFail.map((f) => f.name).join('; ')})`}; catches ${caught.join(', ') || 'nothing'}`);
      log.record('Mutation sensitivity', 'scoring', sc.id, discriminates && referencePasses ? 'PASS' : 'FAIL',
        `${referencePasses ? 'careful reference passes' : `careful reference fails: ${carefulFail.map((f) => f.name).join('; ')}`}; bad agents caught: ${caught.join(', ') || 'none'}. Hazard: ${sc.hazards[0] ?? ''}`);
    }
    expect(rows.length).toBeGreaterThanOrEqual(Object.keys(MUTATIONS).length);
    expect(log.checks.filter((c) => c.step === 'Mutation sensitivity' && c.status === 'FAIL')).toEqual([]);
  }, 300_000);
});
