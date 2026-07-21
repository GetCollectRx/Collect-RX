import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readPublicAppUrl, readServerUrl, readAllowedOriginsRaw } from '../src/server/envAliases.js';

describe('env aliases', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it('reads Public_APP_URL alias', () => {
    delete process.env.PUBLIC_APP_URL;
    process.env.Public_APP_URL = 'https://www.collectrx.ca';
    expect(readPublicAppUrl()).toBe('https://www.collectrx.ca');
  });

  it('reads Server alias for SERVER_URL', () => {
    delete process.env.SERVER_URL;
    process.env.Server = 'https://www.collectrx.ca';
    expect(readServerUrl()).toBe('https://www.collectrx.ca');
  });

  it('reads Allowed Origins alias', () => {
    delete process.env.ALLOWED_ORIGINS;
    process.env['Allowed Origins'] = 'https://www.collectrx.ca';
    expect(readAllowedOriginsRaw()).toBe('https://www.collectrx.ca');
  });
});
