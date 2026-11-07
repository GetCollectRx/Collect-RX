import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VapiControlUnavailableError,
  initiateCall,
  transferVapiCall,
  type VapiCallParams,
} from '../src/vapi/client.js';

const CONTROL_URL = 'https://phone-call-websocket.vapi.ai/00000000-0000-4000-8000-000000000001/control';

type FetchCall = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Scripted fetch: the first reply answers GET /call/{id}, later ones answer the control POST. */
function stubFetch(replies: Array<Response | Error>): FetchCall[] {
  const calls: FetchCall[] = [];
  const queue = [...replies];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      const next = queue.shift();
      if (!next) throw new Error('unexpected extra fetch');
      if (next instanceof Error) throw next;
      return next;
    }),
  );
  return calls;
}

const callWithControl = (controlUrl: string | undefined) =>
  jsonResponse({ id: 'vapi-call-1', status: 'in-progress', monitor: controlUrl ? { controlUrl } : {} });

beforeEach(() => {
  process.env.VAPI_API_KEY = 'test-key-not-real';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.VAPI_LIVE_CONTROL_ENABLED;
});

describe('transferVapiCall (Vapi live call control)', () => {
  it('reads controlUrl from the call and POSTs the documented transfer message to it', async () => {
    const calls = stubFetch([callWithControl(CONTROL_URL), jsonResponse({ ok: true })]);

    await transferVapiCall('vapi-call-1', '+14165550101');

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toMatch(/\/call\/vapi-call-1$/);
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[1]?.url).toBe(CONTROL_URL);
    expect(calls[1]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      type: 'transfer',
      destination: { type: 'number', number: '+14165550101' },
    });
  });

  it('never sends the Vapi API key to the control URL', async () => {
    const calls = stubFetch([callWithControl(CONTROL_URL), jsonResponse({})]);
    await transferVapiCall('vapi-call-1', '+14165550101');
    const headers = new Headers(calls[1]?.init.headers);
    expect(headers.get('authorization')).toBeNull();
  });

  it.each([
    ['4165550101', '+14165550101'],
    ['(416) 555-0101', '+14165550101'],
    ['1-416-555-0101', '+14165550101'],
    ['+1 416 555 0101', '+14165550101'],
  ])('normalizes %s to E.164', async (input, expected) => {
    const calls = stubFetch([callWithControl(CONTROL_URL), jsonResponse({})]);
    await transferVapiCall('vapi-call-1', input);
    expect(JSON.parse(String(calls[1]?.init.body)).destination.number).toBe(expected);
  });

  it.each(['', 'not a number', '12345', '+0123456789', '416555010'])(
    'rejects destination %j before any network call',
    async (input) => {
      const calls = stubFetch([]);
      await expect(transferVapiCall('vapi-call-1', input)).rejects.toMatchObject({ reason: 'bad_destination' });
      expect(calls).toHaveLength(0);
    },
  );

  it('fails with not_enabled when Vapi issued no control URL, and sends no transfer', async () => {
    const calls = stubFetch([callWithControl(undefined)]);
    await expect(transferVapiCall('vapi-call-1', '+14165550101')).rejects.toMatchObject({
      name: 'VapiControlUnavailableError',
      reason: 'not_enabled',
    });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['a non-Vapi host', 'https://control.example.test/abc/control'],
    ['a lookalike suffix', 'https://notvapi.ai/abc/control'],
    ['plain http on a Vapi host', 'http://phone-call-websocket.vapi.ai/abc/control'],
    ['an unparsable value', 'not a url'],
  ])('refuses to POST to %s', async (_label, url) => {
    const calls = stubFetch([callWithControl(url)]);
    await expect(transferVapiCall('vapi-call-1', '+14165550101')).rejects.toMatchObject({
      reason: 'untrusted_url',
    });
    expect(calls).toHaveLength(1);
  });

  it('reports a non-2xx control response as rejected with the status and no URL in the message', async () => {
    stubFetch([callWithControl(CONTROL_URL), jsonResponse({ message: 'nope' }, 400)]);
    const err = await transferVapiCall('vapi-call-1', '+14165550101').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VapiControlUnavailableError);
    expect((err as VapiControlUnavailableError).reason).toBe('rejected');
    expect((err as VapiControlUnavailableError).status).toBe(400);
    expect((err as Error).message).not.toContain(CONTROL_URL);
    expect((err as Error).message).not.toContain('5550101');
  });

  it('treats a 200 carrying an error body as rejected', async () => {
    stubFetch([callWithControl(CONTROL_URL), jsonResponse({ statusCode: 400, message: ['bad shape'] })]);
    await expect(transferVapiCall('vapi-call-1', '+14165550101')).rejects.toMatchObject({ reason: 'rejected' });
  });

  it('reports a network failure as unreachable without leaking the URL', async () => {
    stubFetch([callWithControl(CONTROL_URL), new Error(`connect ECONNRESET ${CONTROL_URL}`)]);
    const err = await transferVapiCall('vapi-call-1', '+14165550101').catch((e: unknown) => e);
    expect((err as VapiControlUnavailableError).reason).toBe('unreachable');
    expect((err as Error).message).not.toContain(CONTROL_URL);
  });
});

describe('live control opt-in on call creation', () => {
  const params: VapiCallParams = {
    claimId: '00000000-0000-4000-8000-0000000000aa',
    carrierId: 'sun_life',
    practiceId: '00000000-0000-4000-8000-0000000000bb',
    patientToken: '00000000-0000-4000-8000-0000000000cc',
    patientName: 'Synthetic Patient',
    patientDob: '1900-01-01',
    policyNumber: 'SYN-0001',
    carrierPhone: '+18009619356',
    claimNumber: 'SYN-CLM-1',
    daysOutstanding: 40,
    billedAmount: 100,
    outstandingAmount: 100,
    practiceName: 'Synthetic Practice',
    providerNumber: 'SYN-PRV-1',
    practicePhone: '+14165550100',
  };

  async function sentOverrides(): Promise<Record<string, unknown>> {
    process.env.VAPI_SQUAD_ID = 'squad-test';
    process.env.VAPI_PHONE_NUMBER_ID = 'phone-test';
    const calls = stubFetch([jsonResponse({ id: 'vapi-call-9', status: 'queued', createdAt: '2026-01-01T00:00:00Z' })]);
    await initiateCall(params);
    return (JSON.parse(String(calls[0]?.init.body)) as { assistantOverrides: Record<string, unknown> })
      .assistantOverrides;
  }

  it('does not request live control by default', async () => {
    expect(await sentOverrides()).not.toHaveProperty('monitorPlan');
  });

  it('requests live control when VAPI_LIVE_CONTROL_ENABLED is true', async () => {
    process.env.VAPI_LIVE_CONTROL_ENABLED = 'true';
    expect((await sentOverrides()).monitorPlan).toEqual({ controlEnabled: true });
  });
});
