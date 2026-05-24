import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertEmrSyncWebhookUrlAllowed } from '../src/server/emrWebhookUrl.js';

describe('emrWebhookUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows http localhost in non-production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(() => assertEmrSyncWebhookUrlAllowed('http://127.0.0.1:8787/hook')).not.toThrow();
  });

  it('rejects http localhost in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertEmrSyncWebhookUrlAllowed('http://127.0.0.1:8787/hook')).toThrow(/https/);
  });

  it('rejects private IPv4 in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertEmrSyncWebhookUrlAllowed('https://10.0.0.5/webhook')).toThrow(/private/);
  });

  it('allows public https in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() =>
      assertEmrSyncWebhookUrlAllowed('https://bridge.example.com/collectrx/emr'),
    ).not.toThrow();
  });

  it('rejects URLs with embedded credentials', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() =>
      assertEmrSyncWebhookUrlAllowed('https://user:pass@bridge.example.com/hook'),
    ).toThrow(/credentials/);
  });

  it('rejects metadata host even in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(() => assertEmrSyncWebhookUrlAllowed('https://metadata.google.internal/')).toThrow();
  });
});
