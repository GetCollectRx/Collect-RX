/**
 * Carrier Twin: a scripted phone system, served as TwiML, that a real Vapi
 * squad can dial through Twilio. It is also driven directly by tests, posting
 * the same form bodies Twilio would, so its behaviour is verified offline
 * before any call costs money.
 *
 * The twin records its own ground-truth timeline (what it played, which keys
 * it received, when a "rep" answered). Scoring compares the agent's behaviour
 * against that timeline, never against the agent's own account of the call.
 *
 * Safety: control routes need a bearer token, Twilio webhooks are signature
 * checked when an auth token is supplied, and no route returns anything
 * derived from caller identifiers beyond digit counts.
 */
import { timingSafeEqual } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import twilio from 'twilio';
import { gather, hangup, pause, redirect, response, say } from './twiml.js';
import type { IvrStep, Scenario } from './scenarios.js';

export type TwinEventKind =
  | 'call_start'
  | 'prompt'
  | 'key_received'
  | 'wrong_key'
  | 'wrong_branch'
  | 'digits_entered'
  | 'identifier_in_wrong_branch'
  | 'speech_received'
  | 'silence'
  | 'rejected_entry'
  | 'disconnect_too_many_wrong'
  | 'hold_start'
  | 'hold_announcement'
  | 'hold_dropped'
  | 'rep_answer'
  | 'rep_line'
  | 'agent_speech'
  | 'voicemail_greeting'
  | 'closed_message'
  | 'hangup';

export interface TwinEvent {
  at: number;
  callSid: string;
  scenarioId: string;
  kind: TwinEventKind;
  detail: string;
}

export interface TwinOptions {
  scenarios: Scenario[];
  controlToken: string;
  /** When set, Twilio signatures are required on every webhook. */
  twilioAuthToken?: string;
  /** Public base URL as Twilio sees it; required with twilioAuthToken. */
  publicBaseUrl?: string;
  /** Multiplies hold pause lengths; tests use a small value, live runs use 1. */
  timeScale?: number;
  now?: () => number;
}

interface State {
  s: string;
  i: number;
  w: number;
  t: number;
  e: number;
  rl: number;
}

function parseState(q: Request['query'], fallbackScenario: string): State {
  const num = (v: unknown): number => {
    const n = Number(Array.isArray(v) ? v[0] : v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  };
  const s = typeof q.s === 'string' && q.s.length > 0 ? q.s : fallbackScenario;
  return { s, i: num(q.i), w: num(q.w), t: num(q.t), e: num(q.e), rl: num(q.rl) };
}

function qs(st: State): string {
  return `s=${encodeURIComponent(st.s)}&i=${st.i}&w=${st.w}&t=${st.t}&e=${st.e}&rl=${st.rl}`;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface CarrierTwin {
  app: express.Express;
  events(callSid?: string): TwinEvent[];
  armed(): string | null;
  arm(scenarioId: string): void;
}

export function createCarrierTwin(opts: TwinOptions): CarrierTwin {
  const byId = new Map(opts.scenarios.map((s) => [s.id, s]));
  const log: TwinEvent[] = [];
  const now = opts.now ?? (() => Date.now());
  const scale = opts.timeScale ?? 1;
  let armedId: string | null = null;

  const record = (callSid: string, scenarioId: string, kind: TwinEventKind, detail = ''): void => {
    log.push({ at: now(), callSid, scenarioId, kind, detail });
  };

  const app = express();
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use(express.json({ limit: '16kb' }));

  const control = (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('authorization') ?? '';
    if (!safeEqual(header, `Bearer ${opts.controlToken}`)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };

  const webhook = (req: Request, res: Response, next: NextFunction): void => {
    if (opts.twilioAuthToken) {
      const signature = req.header('x-twilio-signature') ?? '';
      const url = `${opts.publicBaseUrl ?? ''}${req.originalUrl}`;
      const params = req.body as Record<string, string>;
      if (!opts.publicBaseUrl || !twilio.validateRequest(opts.twilioAuthToken, signature, url, params)) {
        res.status(403).type('text/plain').send('invalid signature');
        return;
      }
    }
    next();
  };

  const xml = (res: Response, body: string): void => {
    res.status(200).type('text/xml').send(body);
  };

  const scenarioOf = (id: string): Scenario | undefined => byId.get(id);
  const callSidOf = (req: Request): string => {
    const sid = (req.body as Record<string, unknown> | undefined)?.CallSid;
    return typeof sid === 'string' && sid.length > 0 ? sid : 'unknown-call';
  };

  const stepUrl = (st: State): string => `/twin/step?${qs(st)}`;

  const promptStep = (sc: Scenario, st: State, callSid: string, step: IvrStep, reprompt: boolean): string => {
    record(callSid, sc.id, 'prompt', `${reprompt ? 'reprompt ' : ''}${step.id}: ${step.prompt.slice(0, 120)}`);
    const action = stepUrl(st);
    switch (step.accept.kind) {
      case 'listen':
        return response(say(step.prompt), redirect(action));
      case 'speech':
        return response(gather({ action, input: 'speech', timeoutSeconds: 6, hints: step.accept.keywords, prompt: step.prompt }), redirect(action));
      case 'digit':
      case 'anyDigit':
        return response(gather({ action, input: 'dtmf', timeoutSeconds: 4, numDigits: 1, prompt: step.prompt }), redirect(action));
      case 'digits':
        return response(
          gather({ action, input: 'dtmf', timeoutSeconds: 5, finishOnKey: step.accept.terminator ?? '#', prompt: step.prompt }),
          redirect(action),
        );
    }
  };

  const holdResponse = (sc: Scenario, st: State, callSid: string): string => {
    const every = sc.hold.announcementEverySeconds ?? 30;
    if (sc.hold.dropAtSeconds !== null && st.e >= sc.hold.dropAtSeconds) {
      record(callSid, sc.id, 'hold_dropped', `after ${st.e}s`);
      return response(hangup());
    }
    if (st.e >= sc.hold.seconds) {
      record(callSid, sc.id, 'rep_answer', sc.pickup);
      return response(redirect(`/twin/rep?${qs({ ...st, rl: 0 })}`));
    }
    const parts: string[] = [];
    if (sc.hold.announcementEverySeconds !== null && st.e > 0) {
      record(callSid, sc.id, 'hold_announcement', sc.hold.announcement);
      parts.push(say(sc.hold.announcement));
    }
    parts.push(pause(Math.max(1, every * scale)));
    return response(...parts, redirect(`/twin/hold?${qs({ ...st, e: st.e + every })}`));
  };

  app.post('/twin/arm', control, (req: Request, res: Response) => {
    const id = (req.body as { scenarioId?: unknown }).scenarioId;
    if (typeof id !== 'string' || !byId.has(id)) {
      res.status(400).json({ error: 'unknown scenario' });
      return;
    }
    armedId = id;
    res.json({ armed: id });
  });

  app.get('/twin/events', control, (req: Request, res: Response) => {
    const sid = typeof req.query.callSid === 'string' ? req.query.callSid : undefined;
    res.json(sid ? log.filter((e) => e.callSid === sid) : log);
  });

  app.post('/twin/entry', webhook, (req: Request, res: Response) => {
    const callSid = callSidOf(req);
    const sc = armedId ? scenarioOf(armedId) : undefined;
    if (!sc) {
      res.status(409).type('text/plain').send('no scenario armed');
      return;
    }
    record(callSid, sc.id, 'call_start', sc.title);
    if (sc.closedMessage) {
      record(callSid, sc.id, 'closed_message', sc.closedMessage);
      xml(res, response(say(sc.closedMessage), hangup()));
      return;
    }
    const first = sc.steps[0];
    const st: State = { s: sc.id, i: 0, w: 0, t: 0, e: 0, rl: 0 };
    if (!first) {
      xml(res, response(redirect(`/twin/hold?${qs(st)}`)));
      return;
    }
    xml(res, promptStep(sc, st, callSid, first, false));
  });

  app.post('/twin/step', webhook, (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const callSid = callSidOf(req);
    const st = parseState(req.query, armedId ?? '');
    const sc = scenarioOf(st.s);
    if (!sc) {
      res.status(404).type('text/plain').send('unknown scenario');
      return;
    }
    const step = sc.steps[st.i];
    if (!step) {
      record(callSid, sc.id, 'hold_start', `${sc.hold.seconds}s scripted`);
      xml(res, response(redirect(`/twin/hold?${qs({ ...st, e: 0 })}`)));
      return;
    }
    const digits = typeof body.Digits === 'string' ? body.Digits : '';
    const speech = typeof body.SpeechResult === 'string' ? body.SpeechResult : '';
    const advance = (extra: Partial<State> = {}): string => {
      const next: State = { ...st, i: st.i + 1, w: 0, ...extra };
      const nextStep = sc.steps[next.i];
      if (!nextStep) {
        record(callSid, sc.id, 'hold_start', `${sc.hold.seconds}s scripted`);
        return response(redirect(`/twin/hold?${qs({ ...next, e: 0 })}`));
      }
      return promptStep(sc, next, callSid, nextStep, false);
    };
    const wrong = (why: string, countAsWrongKey = true): string => {
      if (countAsWrongKey) record(callSid, sc.id, 'wrong_key', `${step.id}: ${why}`);
      const next: State = { ...st, w: st.w + 1 };
      if (next.w > step.maxWrong) {
        record(callSid, sc.id, 'disconnect_too_many_wrong', step.id);
        return response(say('We are unable to process your request. Goodbye.'), hangup());
      }
      return promptStep(sc, next, callSid, step, true);
    };

    if (step.accept.kind === 'listen') {
      xml(res, advance());
      return;
    }
    if (digits === '' && speech === '') {
      record(callSid, sc.id, 'silence', step.id);
      xml(res, step.repromptOnSilence ? wrong('no input', false) : response(say('Goodbye.'), hangup()));
      return;
    }
    if (speech !== '') record(callSid, sc.id, 'speech_received', `${step.id}: ${speech.slice(0, 80)}`);
    if (digits !== '') record(callSid, sc.id, 'key_received', `${step.id}: ${digits.length} key(s)`);

    switch (step.accept.kind) {
      case 'listen':
        return;
      case 'anyDigit':
        xml(res, /^[1-9]$/u.test(digits) ? advance() : wrong('not a menu key'));
        return;
      case 'digit': {
        if (digits === step.accept.digit) {
          xml(res, advance());
        } else if (step.trapDigit !== undefined && digits === step.trapDigit) {
          record(callSid, sc.id, 'wrong_branch', `${step.id}: entered the wrong department`);
          xml(res, advance({ t: 1 }));
        } else {
          xml(res, wrong(`key ${digits || 'none'} not offered`));
        }
        return;
      }
      case 'speech': {
        const heard = speech.toLowerCase();
        xml(res, step.accept.keywords.some((k) => heard.includes(k)) ? advance() : wrong('speech not understood'));
        return;
      }
      case 'digits': {
        const clean = digits.replace(/[#*]/gu, '');
        if (!/^\d+$/u.test(clean) || clean.length < step.accept.min || clean.length > step.accept.max) {
          xml(res, wrong(`entry length ${clean.length}`));
          return;
        }
        record(callSid, sc.id, 'digits_entered', `${step.id}: ${clean.length} digits${st.t === 1 ? ' IN WRONG BRANCH' : ''}`);
        if (st.t === 1) record(callSid, sc.id, 'identifier_in_wrong_branch', step.id);
        if (step.rejectFirstEntry && st.w === 0) {
          record(callSid, sc.id, 'rejected_entry', step.id);
          xml(res, response(say('That number was not recognized.'), redirect(stepUrl({ ...st, w: 1 }))));
          return;
        }
        xml(res, advance());
        return;
      }
    }
  });

  app.post('/twin/hold', webhook, (req: Request, res: Response) => {
    const st = parseState(req.query, armedId ?? '');
    const sc = scenarioOf(st.s);
    if (!sc) {
      res.status(404).type('text/plain').send('unknown scenario');
      return;
    }
    xml(res, holdResponse(sc, st, callSidOf(req)));
  });

  app.post('/twin/rep', webhook, (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const callSid = callSidOf(req);
    const st = parseState(req.query, armedId ?? '');
    const sc = scenarioOf(st.s);
    if (!sc) {
      res.status(404).type('text/plain').send('unknown scenario');
      return;
    }
    if (typeof body.SpeechResult === 'string' && body.SpeechResult !== '') {
      record(callSid, sc.id, 'agent_speech', body.SpeechResult.slice(0, 200));
    }
    if (sc.pickup === 'voicemail') {
      record(callSid, sc.id, 'voicemail_greeting', sc.rep.lines[0] ?? '');
      xml(res, response(say(sc.rep.lines[0] ?? ''), pause(2), hangup()));
      return;
    }
    const line = sc.rep.lines[st.rl];
    if (line === undefined) {
      record(callSid, sc.id, 'hangup', 'rep finished');
      xml(res, response(say('Thank you for calling. Goodbye.'), hangup()));
      return;
    }
    record(callSid, sc.id, 'rep_line', line);
    const next: State = { ...st, rl: st.rl + 1 };
    xml(res, response(gather({ action: `/twin/rep?${qs(next)}`, input: 'speech', timeoutSeconds: 6, prompt: line }), redirect(`/twin/rep?${qs(next)}`)));
  });

  return {
    app,
    events: (callSid) => (callSid ? log.filter((e) => e.callSid === callSid) : [...log]),
    armed: () => armedId,
    arm: (id) => {
      if (!byId.has(id)) throw new Error(`unknown scenario ${id}`);
      armedId = id;
    },
  };
}
