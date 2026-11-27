import { describe, expect, it } from 'vitest';
import { buildSpaIndexHtml } from '../src/server/spaShell.js';

const RAW =
  '<html><head><meta name="crx-public-api-origin" content="" /></head><body></body></html>';

describe('buildSpaIndexHtml', () => {
  it('leaves the API-origin meta empty by default, even when PUBLIC_API_BASE_URL is set', () => {
    // Regression: injecting https://collect-rx.fly.dev made www.collectrx.ca call a different
    // site, the SameSite=Lax auth cookie was not sent, and sign-in looped back to the login page.
    const out = buildSpaIndexHtml(RAW, { PUBLIC_API_BASE_URL: 'https://collect-rx.fly.dev' });
    expect(out).toBe(RAW);
    expect(out).toContain('content=""');
  });

  it('injects the origin only when explicitly enabled for a split deployment', () => {
    const out = buildSpaIndexHtml(RAW, {
      SPA_INJECT_API_ORIGIN: 'true',
      PUBLIC_API_BASE_URL: 'https://api.example.com/',
    });
    expect(out).toContain('content="https://api.example.com"');
    expect(out).not.toContain('content=""');
  });

  it('does nothing when enabled but no origin is configured', () => {
    expect(buildSpaIndexHtml(RAW, { SPA_INJECT_API_ORIGIN: 'true' })).toBe(RAW);
  });

  it('adds the meta when the shell has none, and escapes attribute characters', () => {
    const out = buildSpaIndexHtml('<head></head>', {
      SPA_INJECT_API_ORIGIN: 'true',
      PUBLIC_API_BASE_URL: 'https://x.example.com/"><script>',
    });
    expect(out).toContain('&quot;&gt;'.replace('&gt;', '>'));
    expect(out).not.toContain('"><script>');
  });
});
