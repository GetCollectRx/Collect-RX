/**
 * Stage 1 outbound interceptor.
 *
 * Stage 1 adds no seam to production code (decision D1). Instead every
 * outbound network path the product can use is intercepted here, so the
 * real Vapi allowlist guard in src/vapi/client.ts still runs and every dial
 * is recorded but never sent.
 *
 * Fail-closed by design: any request to a host this module does not
 * recognise throws, and the attempt is recorded so the run report can show
 * it. A real carrier number appearing in a dial payload is recorded too;
 * reaching the interceptor is the only thing standing between that payload
 * and a real call, which is exactly what the report must state.
 */
import http from 'node:http';
import https from 'node:https';

export interface InterceptedRequest {
  seq: number;
  at: string;
  method: string;
  url: string;
  host: string;
  path: string;
  body: unknown;
  idempotencyKey: string | null;
  disposition: 'vapi_stub' | 'vapi_control_stub' | 'anthropic_stub' | 'recording_delete_stub' | 'blocked';
}

export interface ScriptedLessonResponse {
  lessons: Array<{ category: string; observation: string; recommendation: string; confidence: number }>;
}

const VAPI_HOST = 'api.vapi.ai';
/** Stands in for the per-call control host Vapi returns in call.monitor.controlUrl. */
const SIM_CONTROL_HOST = 'sim-control.vapi.ai';
const ANTHROPIC_HOST = 'api.anthropic.com';
const TWILIO_HOST = 'api.twilio.com';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '']);

export class OutboundInterceptor {
  readonly requests: InterceptedRequest[] = [];
  private seq = 0;
  private callCounter = 0;
  private lessonQueue: ScriptedLessonResponse[] = [];
  private originalFetch: typeof fetch | null = null;
  private originalHttpRequest: typeof http.request | null = null;
  private originalHttpsRequest: typeof https.request | null = null;
  readonly blockedNodeRequests: string[] = [];

  queueLessonResponse(response: ScriptedLessonResponse): void {
    this.lessonQueue.push(response);
  }

  install(): void {
    this.originalFetch = globalThis.fetch;
    globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      this.handleFetch(input, init);

    this.originalHttpRequest = http.request;
    this.originalHttpsRequest = https.request;
    const guard = (original: typeof http.request, scheme: string): typeof http.request => {
      const wrapped = ((...args: Parameters<typeof http.request>) => {
        const host = hostFromNodeArgs(args);
        if (!LOCAL_HOSTS.has(host)) {
          this.blockedNodeRequests.push(`${scheme}://${host}`);
          throw new Error(`[sim-harness] blocked non-local ${scheme} request to ${host}`);
        }
        return original(...args);
      }) as typeof http.request;
      return wrapped;
    };
    http.request = guard(this.originalHttpRequest, 'http');
    https.request = guard(this.originalHttpsRequest, 'https') as typeof https.request;
  }

  uninstall(): void {
    if (this.originalFetch) globalThis.fetch = this.originalFetch;
    if (this.originalHttpRequest) http.request = this.originalHttpRequest;
    if (this.originalHttpsRequest) https.request = this.originalHttpsRequest;
  }

  dials(): InterceptedRequest[] {
    return this.requests.filter((r) => r.host === VAPI_HOST && r.method === 'POST' && r.path === '/call');
  }

  /** Live-call transfer commands sent to a call's control URL (Vapi live call control). */
  transfers(): InterceptedRequest[] {
    return this.controlCommands('transfer');
  }

  controlCommands(type: string): InterceptedRequest[] {
    return this.requests.filter((r) => {
      if (r.disposition !== 'vapi_control_stub') return false;
      const body = r.body as { type?: unknown } | null;
      return typeof body === 'object' && body !== null && body.type === type;
    });
  }

  blocked(): InterceptedRequest[] {
    return this.requests.filter((r) => r.disposition === 'blocked');
  }

  private record(entry: Omit<InterceptedRequest, 'seq' | 'at'>): InterceptedRequest {
    this.seq += 1;
    const full: InterceptedRequest = { seq: this.seq, at: new Date().toISOString(), ...entry };
    this.requests.push(full);
    return full;
  }

  private async handleFetch(
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = parseBody(init?.body);
    const idempotencyKey = new Headers(init?.headers).get('Idempotency-Key');

    if (url.hostname === VAPI_HOST) {
      if (method === 'DELETE' && /\/recording$/u.test(url.pathname)) {
        this.record({ method, url: url.href, host: url.hostname, path: url.pathname, body, idempotencyKey, disposition: 'recording_delete_stub' });
        return new Response(null, { status: 204 });
      }
      this.record({ method, url: url.href, host: url.hostname, path: url.pathname, body, idempotencyKey, disposition: 'vapi_stub' });
      const getCall = /^\/call\/([^/]+)$/u.exec(url.pathname);
      if (method === 'GET' && getCall) {
        // Shape of Vapi's call object as far as live call control needs it.
        const id = getCall[1] ?? '';
        return jsonResponse({ id, status: 'in-progress', monitor: { controlUrl: `https://${SIM_CONTROL_HOST}/${id}/control` } });
      }
      if (method === 'POST' && url.pathname === '/call') {
        this.callCounter += 1;
        const id = `sim-call-${String(this.callCounter).padStart(3, '0')}`;
        return jsonResponse({ id, status: 'queued' });
      }
      return jsonResponse({ ok: true });
    }

    if (url.hostname === SIM_CONTROL_HOST && method === 'POST' && url.pathname.endsWith('/control')) {
      this.record({ method, url: url.href, host: url.hostname, path: url.pathname, body, idempotencyKey, disposition: 'vapi_control_stub' });
      return jsonResponse({ status: 'ok' });
    }

    if (url.hostname === TWILIO_HOST && method === 'DELETE') {
      this.record({ method, url: url.href, host: url.hostname, path: url.pathname, body, idempotencyKey, disposition: 'recording_delete_stub' });
      return new Response(null, { status: 204 });
    }

    if (url.hostname === ANTHROPIC_HOST) {
      this.record({ method, url: url.href, host: url.hostname, path: url.pathname, body, idempotencyKey, disposition: 'anthropic_stub' });
      const next = this.lessonQueue.shift() ?? { lessons: [] };
      return jsonResponse({ content: [{ type: 'text', text: JSON.stringify(next) }] });
    }

    this.record({ method, url: url.href, host: url.hostname, path: url.pathname, body, idempotencyKey, disposition: 'blocked' });
    throw new Error(`[sim-harness] blocked outbound request to ${url.hostname}`);
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') return body ?? null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function hostFromNodeArgs(args: Parameters<typeof http.request>): string {
  const first: unknown = args[0];
  if (typeof first === 'string') return new URL(first).hostname;
  if (first instanceof URL) return first.hostname;
  if (typeof first === 'object' && first !== null) {
    const opts = first as { hostname?: unknown; host?: unknown };
    const raw = typeof opts.hostname === 'string' ? opts.hostname : typeof opts.host === 'string' ? opts.host : '';
    return raw.replace(/:\d+$/u, '');
  }
  return '';
}
