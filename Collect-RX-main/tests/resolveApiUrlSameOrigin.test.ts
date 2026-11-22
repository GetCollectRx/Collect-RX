import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load() {
  vi.stubEnv('DEV', false);
  vi.stubGlobal('window', { location: { hostname: 'www.collectrx.ca', protocol: 'https:' } });
  vi.stubGlobal('document', { querySelector: () => null });
  return import('../src/lib/resolveApiUrl');
}

describe('resolveApiUrl on the CollectRx public host', () => {
  it('stays same-origin on www.collectrx.ca instead of redirecting to collect-rx.fly.dev', async () => {
    const { resolveApiUrl } = await load();
    expect(resolveApiUrl('/api/auth/login')).toBe('/api/auth/login');
  });

  it('stays same-origin on the bare collectrx.ca host', async () => {
    vi.stubEnv('DEV', false);
    vi.stubGlobal('window', { location: { hostname: 'collectrx.ca', protocol: 'https:' } });
    vi.stubGlobal('document', { querySelector: () => null });
    const { resolveApiUrl } = await import('../src/lib/resolveApiUrl');
    expect(resolveApiUrl('/api/me')).toBe('/api/me');
  });

  it('still honours an explicit meta origin for a split deployment', async () => {
    vi.stubEnv('DEV', false);
    vi.stubGlobal('window', { location: { hostname: 'static.example.com', protocol: 'https:' } });
    vi.stubGlobal('document', {
      querySelector: () => ({ getAttribute: () => 'https://api.example.com/' }),
    });
    const { resolveApiUrl } = await import('../src/lib/resolveApiUrl');
    expect(resolveApiUrl('/api/me')).toBe('https://api.example.com/api/me');
  });
});
