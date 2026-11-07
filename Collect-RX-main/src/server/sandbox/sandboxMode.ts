/**
 * Live sandbox mode (staging only).
 *
 * SANDBOX_MODE=1 turns a deployment into a contained copy of the product: the
 * real app, queue engine and webhooks run against synthetic practices, and a
 * carrier simulator stands in for Vapi. Nothing may leave the process except
 * traffic to itself, so the guard below blocks every outbound HTTP request to
 * a non-local host, whatever keys happen to be configured.
 *
 * The guard is installed on import, before any client library loads, and the
 * process refuses to start if Vapi is not pointed at the in-process mock.
 */
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isSandboxMode(): boolean {
  return process.env.SANDBOX_MODE === '1';
}

/** Where the in-process mock Vapi API is mounted. */
export const SANDBOX_VAPI_PATH = '/__sandbox/vapi';

export function sandboxLocalOrigin(): string {
  return `http://127.0.0.1:${process.env.PORT ?? '3000'}`;
}

export function expectedSandboxVapiBaseUrl(): string {
  return `${sandboxLocalOrigin()}${SANDBOX_VAPI_PATH}`;
}

export class SandboxOutboundBlockedError extends Error {
  constructor(host: string) {
    super(`[sandbox] outbound request to ${host} blocked: SANDBOX_MODE allows local traffic only`);
    this.name = 'SandboxOutboundBlockedError';
  }
}

export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return LOCAL_HOSTS.has(host.toLowerCase());
}

function hostOfFetchInput(input: unknown): string | null {
  try {
    if (typeof input === 'string') return new URL(input).hostname;
    if (input instanceof URL) return input.hostname;
    if (typeof input === 'object' && input !== null && 'url' in input && typeof (input as { url: unknown }).url === 'string') {
      return new URL((input as { url: string }).url).hostname;
    }
  } catch {
    return null;
  }
  return null;
}

function hostOfRequestArgs(args: unknown[]): string | null {
  const [first, second] = args;
  try {
    if (typeof first === 'string') return new URL(first).hostname;
    if (first instanceof URL) return first.hostname;
  } catch {
    return null;
  }
  const opts = (typeof first === 'object' && first !== null ? first : second) as
    | { hostname?: unknown; host?: unknown }
    | undefined;
  if (!opts) return 'localhost';
  if (typeof opts.hostname === 'string') return opts.hostname;
  if (typeof opts.host === 'string') return opts.host.replace(/:\d+$/u, '');
  return 'localhost';
}

let restore: (() => void) | null = null;

/** Blocks fetch and node http/https requests to any non-local host. Idempotent. */
export function installOutboundBlock(): void {
  if (restore) return;
  const originalFetch = globalThis.fetch;
  const originals = [http, https].map((mod) => ({ mod, request: mod.request, get: mod.get }));
  restore = () => {
    globalThis.fetch = originalFetch;
    for (const o of originals) {
      Object.defineProperty(o.mod, 'request', { value: o.request, configurable: true, writable: true });
      Object.defineProperty(o.mod, 'get', { value: o.get, configurable: true, writable: true });
    }
  };

  const realFetch = originalFetch.bind(globalThis);
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const host = hostOfFetchInput(input);
    if (!isLocalHost(host)) throw new SandboxOutboundBlockedError(host ?? 'an unparsable URL');
    return realFetch(input, init);
  }) as typeof fetch;

  for (const mod of [http, https]) {
    const realRequest = mod.request.bind(mod) as (...args: unknown[]) => http.ClientRequest;
    const realGet = mod.get.bind(mod) as (...args: unknown[]) => http.ClientRequest;
    const guard =
      (real: (...args: unknown[]) => http.ClientRequest) =>
      (...args: unknown[]): http.ClientRequest => {
        const host = hostOfRequestArgs(args);
        if (!isLocalHost(host)) throw new SandboxOutboundBlockedError(host ?? 'an unparsable URL');
        return real(...args);
      };
    Object.defineProperty(mod, 'request', { value: guard(realRequest), configurable: true, writable: true });
    Object.defineProperty(mod, 'get', { value: guard(realGet), configurable: true, writable: true });
  }
}

/** Tests only: removes the block so it cannot leak into other test files. */
export function uninstallOutboundBlock(): void {
  restore?.();
  restore = null;
}

/**
 * Configuration the sandbox cannot run safely without. Returns the problems
 * found; an empty list means the process may start.
 */
export function sandboxConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const base = (env.VAPI_BASE_URL ?? '').replace(/\/$/u, '');
  if (base !== expectedSandboxVapiBaseUrl()) {
    problems.push(`VAPI_BASE_URL must be ${expectedSandboxVapiBaseUrl()} so dispatch reaches the carrier simulator`);
  }
  if (!env.VAPI_WEBHOOK_SECRET) problems.push('VAPI_WEBHOOK_SECRET must be set so simulated webhooks can be signed');
  if ((env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live_')) problems.push('STRIPE_SECRET_KEY is a live key');
  return problems;
}

/**
 * Fills Vapi settings the sandbox needs when the deployment has none. Only
 * unset values are filled; a key that is set stays as it is, and it can only
 * ever reach the in-process mock because of the outbound block.
 */
export function applySandboxDefaults(env: NodeJS.ProcessEnv = process.env): void {
  env.VAPI_BASE_URL ||= expectedSandboxVapiBaseUrl();
  env.VAPI_API_KEY ||= 'sandbox-placeholder-not-a-key';
  env.VAPI_SQUAD_ID ||= 'sandbox-autonomous-squad';
  env.VAPI_HUMAN_ASSISTED_SQUAD_ID ||= 'sandbox-hold-sentinel-squad';
  env.VAPI_PHONE_NUMBER_ID ||= 'sandbox-phone-number-id';
  // Signer and verifier are the same process, so a per-process secret works
  // when none is configured.
  env.VAPI_WEBHOOK_SECRET ||= randomBytes(32).toString('hex');
}
