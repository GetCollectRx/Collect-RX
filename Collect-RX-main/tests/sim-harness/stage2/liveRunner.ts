/**
 * Stage 2 live runner: sends the product's own dial payload to a Carrier Twin
 * number, so the real Vapi squad, prompts, DTMF handling, hold detection and
 * transfer logic are exercised against a phone system we control.
 *
 * Design rules, each enforced in code and covered by parity.test.ts:
 *  - The payload is captured from the product's own initiateCall(); only
 *    customer.number changes. Any other difference is a harness bug.
 *  - The destination must be the one number named in STAGE2_TWIN_NUMBER and
 *    can never be a real carrier line, the CDCP line, or an emergency number.
 *  - Nothing is sent without --live, a spend cap, and a cost estimate under
 *    that cap. The default run is a dry run that prints the plan.
 *  - The Vapi call record is read strictly: a missing field aborts the run
 *    instead of scoring guesses.
 */
import { CARRIER_PHONE_MAP, CDCP_CONTACT_CENTRE_PHONE } from '../../../src/vapi/client.js';

export interface DialPayload {
  squadId?: string;
  phoneNumberId?: string;
  customer: { number: string };
  assistantOverrides: Record<string, unknown>;
  [key: string]: unknown;
}

const E164 = /^\+[1-9]\d{9,14}$/u;
const EMERGENCY = /^\+?1?(?:911|112|999)$/u;

export function assertTwinNumberSafe(candidate: string, configured: string | undefined): void {
  const digits = (n: string): string => n.replace(/\D/gu, '');
  if (!configured || candidate !== configured) {
    throw new Error('[stage2] destination must equal STAGE2_TWIN_NUMBER exactly');
  }
  if (!E164.test(candidate)) throw new Error('[stage2] STAGE2_TWIN_NUMBER must be E.164');
  if (EMERGENCY.test(candidate)) throw new Error('[stage2] refusing an emergency number');
  const real = new Set([...Object.values(CARRIER_PHONE_MAP), CDCP_CONTACT_CENTRE_PHONE].map(digits));
  if (real.has(digits(candidate))) throw new Error('[stage2] refusing a real carrier line');
}

/** Returns a copy of the product payload aimed at the twin. Everything else is untouched. */
export function retarget(payload: DialPayload, twinNumber: string, configured: string | undefined): DialPayload {
  assertTwinNumberSafe(twinNumber, configured);
  const copy = JSON.parse(JSON.stringify(payload)) as DialPayload;
  copy.customer = { ...copy.customer, number: twinNumber };
  return copy;
}

export interface RunPlan {
  scenarios: string[];
  maxMinutes: number;
  estimatedUsd: number;
  capUsd: number;
  withinCap: boolean;
}

/** Worst case: every call runs to its scenario budget. Rate is an input, not a guess. */
export function planRun(scenarios: Array<{ id: string; maxCallSeconds: number }>, ratePerMinuteUsd: number, capUsd: number): RunPlan {
  const maxMinutes = scenarios.reduce((sum, s) => sum + Math.ceil(s.maxCallSeconds / 60), 0);
  const estimatedUsd = Math.round(maxMinutes * ratePerMinuteUsd * 100) / 100;
  return { scenarios: scenarios.map((s) => s.id), maxMinutes, estimatedUsd, capUsd, withinCap: estimatedUsd <= capUsd };
}

export interface LiveArgs {
  live: boolean;
  capUsd: number | null;
  ratePerMinuteUsd: number | null;
}

export function parseArgs(argv: string[]): LiveArgs {
  const flag = (name: string): string | null => {
    const i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  const num = (v: string | null): number | null => {
    const n = v === null ? NaN : Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return { live: argv.includes('--live'), capUsd: num(flag('--max-spend-usd')), ratePerMinuteUsd: num(flag('--rate-per-minute-usd')) };
}

export function authorizeLive(args: LiveArgs, plan: RunPlan): { ok: true } | { ok: false; reason: string } {
  if (!args.live) return { ok: false, reason: 'dry run: pass --live to place calls' };
  if (args.capUsd === null) return { ok: false, reason: 'refusing: --max-spend-usd is required' };
  if (args.ratePerMinuteUsd === null) return { ok: false, reason: 'refusing: --rate-per-minute-usd is required (use your current Vapi plus Twilio rate)' };
  if (!plan.withinCap) return { ok: false, reason: `refusing: worst-case $${plan.estimatedUsd} exceeds cap $${plan.capUsd}` };
  return { ok: true };
}

export interface VapiCallRecord {
  id: string;
  status: string;
  endedReason: string;
  startedAt: string;
  endedAt: string;
  transcript: string;
}

function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || v === '') throw new Error(`[stage2] Vapi call record is missing "${field}"; aborting instead of scoring a guess`);
  return v;
}

/** Strict reader. The field names mirror what the product's webhook normalizer reads; they are not checked against Vapi's live API (UNVERIFIED until the first live run). */
export function readCallRecord(raw: unknown): VapiCallRecord {
  if (typeof raw !== 'object' || raw === null) throw new Error('[stage2] Vapi call record is not an object');
  const r = raw as Record<string, unknown>;
  const artifact = typeof r.artifact === 'object' && r.artifact !== null ? (r.artifact as Record<string, unknown>) : {};
  return {
    id: str(r.id, 'id'),
    status: str(r.status, 'status'),
    endedReason: typeof r.endedReason === 'string' ? r.endedReason : '',
    startedAt: str(r.startedAt, 'startedAt'),
    endedAt: str(r.endedAt, 'endedAt'),
    transcript: typeof artifact.transcript === 'string' ? artifact.transcript : '',
  };
}

export interface LiveDeps {
  fetchImpl: typeof fetch;
  baseUrl: string;
  apiKey: string;
  sleep: (ms: number) => Promise<void>;
  pollMs: number;
  timeoutMs: number;
}

export async function placeAndWait(deps: LiveDeps, payload: DialPayload): Promise<VapiCallRecord> {
  const headers = { Authorization: `Bearer ${deps.apiKey}`, 'Content-Type': 'application/json' };
  const created = await deps.fetchImpl(`${deps.baseUrl}/call`, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!created.ok) throw new Error(`[stage2] POST /call failed with ${created.status}`);
  const body = (await created.json()) as { id?: unknown };
  const id = str(body.id, 'id (create response)');
  const deadline = Date.now() + deps.timeoutMs;
  for (;;) {
    const res = await deps.fetchImpl(`${deps.baseUrl}/call/${encodeURIComponent(id)}`, { headers });
    if (!res.ok) throw new Error(`[stage2] GET /call/${id} failed with ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;
    if (json.status === 'ended') return readCallRecord(json);
    if (Date.now() > deadline) throw new Error(`[stage2] call ${id} did not end within ${deps.timeoutMs} ms`);
    await deps.sleep(deps.pollMs);
  }
}
