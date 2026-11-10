/**
 * Parity and safety for the Stage 2 live runner. No keys, no network: the
 * product's own initiateCall() runs under the outbound interceptor, and the
 * live path is exercised against a local fake of the two Vapi endpoints.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CarrierId } from '@prisma/client';
import { initiateCall, CARRIER_PHONE_MAP, CDCP_CONTACT_CENTRE_PHONE, type VapiCallParams } from '../../../src/vapi/client.js';
import { OutboundInterceptor } from '../outboundInterceptor.js';
import {
  assertTwinNumberSafe,
  authorizeLive,
  parseArgs,
  placeAndWait,
  planRun,
  readCallRecord,
  retarget,
  type DialPayload,
} from './liveRunner.js';

// The interceptor replaces global fetch for the product code; the local fake server needs the real one.
const realFetch = globalThis.fetch;
const TWIN = '+16135550177';
const savedKey = process.env.VAPI_API_KEY;
const interceptor = new OutboundInterceptor();

beforeAll(() => {
  process.env.VAPI_API_KEY = 'stage2-placeholder-not-a-key';
  process.env.VAPI_PHONE_NUMBER_ID = 'stage2-phone-number-id';
  process.env.VAPI_SQUAD_ID = 'stage2-squad';
  interceptor.install();
});

afterAll(() => {
  interceptor.uninstall();
  if (savedKey === undefined) delete process.env.VAPI_API_KEY;
  else process.env.VAPI_API_KEY = savedKey;
});

function params(carrierId: CarrierId): VapiCallParams {
  return {
    claimId: `claim-${carrierId}`,
    carrierId,
    practiceId: 'practice-stage2',
    patientToken: '3b241101-e2bb-4255-8caf-4136c566a962',
    patientName: 'Zephyrine Quillfeather',
    patientDob: '1984-03-17',
    policyNumber: 'SUBXSTAGE277',
    carrierPhone: CARRIER_PHONE_MAP[carrierId as Exclude<CarrierId, 'other'>],
    claimNumber: 'OFC-STAGE2-1',
    daysOutstanding: 45,
    billedAmount: 1180,
    outstandingAmount: 742.5,
    practiceName: 'SYNTHETIC ONLY Stage 2 Dental',
    providerNumber: 'SYN-PROV-0001',
    practicePhone: '+16135550101',
    idempotencyKey: `stage2-${carrierId}`,
  };
}

async function capture(carrierId: CarrierId): Promise<DialPayload> {
  const before = interceptor.dials().length;
  await initiateCall(params(carrierId));
  const dial = interceptor.dials().slice(before)[0];
  return JSON.parse(JSON.stringify(dial?.body)) as DialPayload;
}

describe('Stage 2 payload parity', () => {
  it('retargeting changes only customer.number, for every carrier', async () => {
    for (const carrierId of Object.keys(CARRIER_PHONE_MAP) as CarrierId[]) {
      const original = await capture(carrierId);
      const aimed = retarget(original, TWIN, TWIN);
      const strip = (p: DialPayload): unknown => {
        const copy = JSON.parse(JSON.stringify(p)) as DialPayload;
        copy.customer = { number: '' };
        return copy;
      };
      expect(strip(aimed)).toEqual(strip(original));
      expect(aimed.customer.number).toBe(TWIN);
      expect(original.customer.number).toBe(CARRIER_PHONE_MAP[carrierId as Exclude<CarrierId, 'other'>]);
    }
  });

  it('keeps PHI inside variableValues and out of metadata after retargeting', async () => {
    const aimed = retarget(await capture('sun_life'), TWIN, TWIN);
    const overrides = aimed.assistantOverrides as { metadata?: unknown; variableValues?: Record<string, unknown> };
    expect(JSON.stringify(overrides.metadata)).not.toMatch(/Quillfeather|1984-03-17|SUBXSTAGE277/u);
    expect(overrides.variableValues?.patient_name).toBe('Zephyrine Quillfeather');
  });
});

describe('Stage 2 destination safety', () => {
  it('refuses every real carrier line, the CDCP line, emergency numbers, malformed numbers and any number not configured', () => {
    for (const n of [...Object.values(CARRIER_PHONE_MAP), CDCP_CONTACT_CENTRE_PHONE]) {
      expect(() => assertTwinNumberSafe(n, n)).toThrow(/real carrier line/u);
    }
    expect(() => assertTwinNumberSafe('+1911', '+1911')).toThrow();
    expect(() => assertTwinNumberSafe('6135550177', '6135550177')).toThrow(/E\.164/u);
    expect(() => assertTwinNumberSafe(TWIN, undefined)).toThrow(/STAGE2_TWIN_NUMBER/u);
    expect(() => assertTwinNumberSafe(TWIN, '+16135550178')).toThrow(/STAGE2_TWIN_NUMBER/u);
    expect(() => assertTwinNumberSafe(TWIN, TWIN)).not.toThrow();
  });
});

describe('Stage 2 spend gate', () => {
  const scenarios = [{ id: 'a', maxCallSeconds: 2700 }, { id: 'b', maxCallSeconds: 120 }];
  it('defaults to a dry run and demands a cap and a rate', () => {
    const plan = planRun(scenarios, 0.2, 20);
    expect(plan.maxMinutes).toBe(47);
    expect(authorizeLive(parseArgs([]), plan)).toEqual({ ok: false, reason: 'dry run: pass --live to place calls' });
    expect(authorizeLive(parseArgs(['--live']), plan).ok).toBe(false);
    expect(authorizeLive(parseArgs(['--live', '--max-spend-usd', '20']), plan).ok).toBe(false);
    expect(authorizeLive(parseArgs(['--live', '--max-spend-usd', '20', '--rate-per-minute-usd', '0.2']), plan).ok).toBe(true);
  });
  it('refuses when the worst case exceeds the cap', () => {
    const plan = planRun(scenarios, 0.5, 10);
    const decision = authorizeLive(parseArgs(['--live', '--max-spend-usd', '10', '--rate-per-minute-usd', '0.5']), plan);
    expect(decision.ok).toBe(false);
  });
});

describe('Stage 2 live path against a local fake of Vapi', () => {
  it('creates a call, polls until ended, and reads the record strictly', async () => {
    let polls = 0;
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url} auth=${req.headers.authorization ?? 'none'}`);
      if (req.method === 'POST' && req.url === '/call') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ id: 'fake-call-1' }));
        return;
      }
      polls += 1;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(polls < 3 ? { id: 'fake-call-1', status: 'in-progress' } : {
        id: 'fake-call-1', status: 'ended', endedReason: 'customer-ended-call',
        startedAt: '2026-11-10T21:00:00.000Z', endedAt: '2026-11-10T21:10:00.000Z', artifact: { transcript: 'Rep: hello' },
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const record = await placeAndWait(
      { fetchImpl: realFetch.bind(globalThis), baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k', sleep: async () => undefined, pollMs: 0, timeoutMs: 5000 },
      retarget(await capture('manulife'), TWIN, TWIN),
    );
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(record.endedReason).toBe('customer-ended-call');
    expect(polls).toBe(3);
    expect(seen[0]).toContain('POST /call');
  });

  it('aborts on a record with missing fields instead of scoring a guess', () => {
    expect(() => readCallRecord({ id: 'x', status: 'ended' })).toThrow(/startedAt/u);
    expect(() => readCallRecord(null)).toThrow();
  });
});
