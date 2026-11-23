/**
 * Live call control goes through the call's control URL, as Vapi documents it
 * (docs.vapi.ai/calls/call-features): read call.monitor.controlUrl from
 * GET /call/{id}, then POST {type:'transfer'} or {type:'end-call'} to it.
 * The previous code posted to /call/{id}/transfer and /call/{id}/end, which
 * are not in Vapi's API reference.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { endVapiCall, transferVapiCall } from '../src/vapi/client.js';

const CONTROL_URL = 'https://phone-call-websocket.aws-us-west-2-backend-production1.vapi.ai/call-123/control';

interface Recorded { url: string; method: string; headers: Record<string, string>; body: unknown }

const savedKey = process.env.VAPI_API_KEY;
const savedPublicKey = process.env.VAPI_PUBLIC_KEY;
let recorded: Recorded[] = [];

function stubVapi(call: Record<string, unknown>, controlStatus = 200): void {
  recorded = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    recorded.push({ url, method: init?.method ?? 'GET', headers, body: init?.body ? JSON.parse(String(init.body)) as unknown : null });
    if (url === 'https://api.vapi.ai/call/call-123' && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify(call), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === CONTROL_URL) {
      return new Response(JSON.stringify({ status: 'ok' }), { status: controlStatus });
    }
    return new Response('not found', { status: 404 });
  });
}

describe('Vapi live call control uses the call control URL', () => {
  beforeAll(() => {
    process.env.VAPI_API_KEY = 'vapi-control-test-placeholder';
    delete process.env.VAPI_PUBLIC_KEY;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VAPI_PUBLIC_KEY;
  });
  afterAll(() => {
    if (savedKey === undefined) delete process.env.VAPI_API_KEY;
    else process.env.VAPI_API_KEY = savedKey;
    if (savedPublicKey === undefined) delete process.env.VAPI_PUBLIC_KEY;
    else process.env.VAPI_PUBLIC_KEY = savedPublicKey;
  });

  it('transfers by posting the documented transfer command to the control URL', async () => {
    stubVapi({ id: 'call-123', status: 'in-progress', monitor: { controlUrl: CONTROL_URL } });
    await transferVapiCall('call-123', '+16135550150');
    expect(recorded.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET https://api.vapi.ai/call/call-123',
      `POST ${CONTROL_URL}`,
    ]);
    expect(recorded[1]?.body).toEqual({ type: 'transfer', destination: { type: 'number', number: '+16135550150' } });
    expect(recorded[1]?.headers.authorization).toBeUndefined();
    expect(recorded.some((r) => r.url.endsWith('/transfer'))).toBe(false);
  });

  it('sends the public key, never the private key, when control authentication is configured', async () => {
    process.env.VAPI_PUBLIC_KEY = 'vapi-public-test-placeholder';
    stubVapi({ id: 'call-123', status: 'in-progress', monitor: { controlUrl: CONTROL_URL } });
    await transferVapiCall('call-123', '+16135550150');
    expect(recorded[1]?.headers.authorization).toBe('Bearer vapi-public-test-placeholder');
  });

  it('ends a live call with the documented end-call command', async () => {
    stubVapi({ id: 'call-123', status: 'in-progress', monitor: { controlUrl: CONTROL_URL } });
    await endVapiCall('call-123');
    expect(recorded[1]).toMatchObject({ method: 'POST', url: CONTROL_URL, body: { type: 'end-call' } });
    expect(recorded.some((r) => r.url.endsWith('/end'))).toBe(false);
  });

  it('treats ending a call that already ended as done, without a control command', async () => {
    stubVapi({ id: 'call-123', status: 'ended', monitor: { controlUrl: CONTROL_URL } });
    await endVapiCall('call-123');
    expect(recorded).toHaveLength(1);
  });

  it('refuses to transfer a call that is not in progress', async () => {
    stubVapi({ id: 'call-123', status: 'ended', monitor: { controlUrl: CONTROL_URL } });
    await expect(transferVapiCall('call-123', '+16135550150')).rejects.toThrow(/cannot be transferred/);
    expect(recorded).toHaveLength(1);
  });

  it.each([
    'http://phone-call-websocket.vapi.ai/call-123/control',
    'https://attacker.example.com/control',
    'https://vapi.ai.attacker.example.com/control',
  ])('never sends a command to a control URL that is not https on a vapi.ai host: %s', async (badUrl) => {
    stubVapi({ id: 'call-123', status: 'in-progress', monitor: { controlUrl: badUrl } });
    await expect(transferVapiCall('call-123', '+16135550150')).rejects.toThrow(/control URL/);
    expect(recorded.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('keeps the control URL out of the error when Vapi rejects a command', async () => {
    stubVapi({ id: 'call-123', status: 'in-progress', monitor: { controlUrl: CONTROL_URL } }, 400);
    const err = await transferVapiCall('call-123', '+16135550150').then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/400/);
    expect((err as Error).message).not.toContain('phone-call-websocket');
  });
});
