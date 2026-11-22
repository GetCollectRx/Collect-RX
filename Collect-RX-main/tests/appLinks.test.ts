import { describe, expect, it } from 'vitest';
import { appBaseUrlFromRequest, resolveAppBaseUrl } from '../src/server/email/appLinks.js';

const prod: NodeJS.ProcessEnv = { NODE_ENV: 'production', APP_BASE_URL: 'https://app.collectrx.ca' };

describe('resolveAppBaseUrl', () => {
  it('uses the host the user is on when it is allowlisted', () => {
    expect(resolveAppBaseUrl({ origin: 'https://www.collectrx.ca' }, prod)).toBe('https://www.collectrx.ca');
    expect(resolveAppBaseUrl({ host: 'collect-rx.fly.dev' }, prod)).toBe('https://collect-rx.fly.dev');
  });

  it('prefers Origin over Host', () => {
    expect(resolveAppBaseUrl({ origin: 'https://www.collectrx.ca', host: 'collectrx.ca' }, prod)).toBe(
      'https://www.collectrx.ca',
    );
  });

  it('ignores a poisoned Host or Origin header', () => {
    expect(resolveAppBaseUrl({ host: 'evil.example.com' }, prod)).toBe('https://app.collectrx.ca');
    expect(resolveAppBaseUrl({ origin: 'https://www.collectrx.ca.evil.com' }, prod)).toBe('https://app.collectrx.ca');
    expect(resolveAppBaseUrl({ host: 'evil.com/@www.collectrx.ca' }, prod)).toBe('https://app.collectrx.ca');
    expect(resolveAppBaseUrl({ origin: 'javascript:alert(1)' }, prod)).toBe('https://app.collectrx.ca');
  });

  it('ignores plain http from the request in production', () => {
    expect(resolveAppBaseUrl({ origin: 'http://www.collectrx.ca' }, prod)).toBe('https://app.collectrx.ca');
  });

  it('falls back to APP_BASE_URL, then to www.collectrx.ca', () => {
    expect(resolveAppBaseUrl(undefined, { APP_BASE_URL: 'https://staging.collectrx.ca/' })).toBe(
      'https://staging.collectrx.ca',
    );
    expect(resolveAppBaseUrl(undefined, {})).toBe('https://www.collectrx.ca');
  });

  it('allows the configured APP_BASE_URL host when the request comes from it', () => {
    expect(resolveAppBaseUrl({ host: 'staging.collectrx.ca' }, { APP_BASE_URL: 'https://staging.collectrx.ca' })).toBe(
      'https://staging.collectrx.ca',
    );
  });
});

describe('appBaseUrlFromRequest', () => {
  it('reads origin and host headers', () => {
    const req = { get: (n: string) => ({ host: 'www.collectrx.ca' } as Record<string, string>)[n.toLowerCase()] };
    expect(appBaseUrlFromRequest(req, prod)).toBe('https://www.collectrx.ca');
  });
});
