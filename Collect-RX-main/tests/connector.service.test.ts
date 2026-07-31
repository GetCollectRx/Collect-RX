import { describe, expect, it } from 'vitest';
import {
  generateConnectorToken,
  hashConnectorToken,
  verifyConnectorToken,
  connectorHealth,
} from '../src/server/services/desktopConnectorService.js';

describe('desktopConnectorService', () => {
  it('generates opaque tokens', () => {
    const a = generateConnectorToken();
    const b = generateConnectorToken();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it('hashes and verifies tokens', async () => {
    const token = generateConnectorToken();
    const hash = await hashConnectorToken(token);
    expect(await verifyConnectorToken(token, hash)).toBe(true);
    expect(await verifyConnectorToken(token + 'x', hash)).toBe(false);
  });

  it('classifies connector health', () => {
    const now = new Date();
    expect(connectorHealth({ revokedAt: now })).toBe('revoked');
    expect(connectorHealth({ lastHeartbeatAt: now, lastSyncStatus: 'ok' })).toBe('healthy');
    expect(connectorHealth({ lastHeartbeatAt: new Date(0), lastSyncStatus: 'ok' })).toBe('stale');
    expect(connectorHealth({ lastHeartbeatAt: now, lastSyncStatus: 'error' })).toBe('error');
    expect(connectorHealth({})).toBe('never');
  });
});
