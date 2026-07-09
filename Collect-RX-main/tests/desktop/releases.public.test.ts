import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server/index.js';
import { PILOT_DESKTOP_RELEASE, proxyDesktopAssetUrl } from '../../src/lib/desktopReleases.js';

describe('GET /api/desktop/releases', () => {
  it('is public (no session required)', async () => {
    const res = await request(app).get('/api/desktop/releases');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeTruthy();
    expect(res.body.data.version).toBeTruthy();
    expect(Array.isArray(res.body.data.assets)).toBe(true);
    expect(res.body.data.assets.length).toBeGreaterThan(0);
  });

  it('returns proxied download URLs for pilot assets', async () => {
    const res = await request(app).get('/api/desktop/releases');
    const windows = res.body.data.assets.find((a: { platform: string }) => a.platform === 'windows');
    expect(windows.fileName).toBe('CollectRx.Setup.1.0.0.exe');
    expect(windows.downloadUrl).toBe(proxyDesktopAssetUrl('CollectRx.Setup.1.0.0.exe'));
  });
});

describe('GET /api/desktop/releases/assets/:fileName', () => {
  it('rejects path traversal', async () => {
    const res = await request(app).get('/api/desktop/releases/assets/..%2Fetc%2Fpasswd');
    expect(res.status).toBe(400);
  });

  it('returns 503 when GitHub token is not configured', async () => {
    const prev = process.env.GITHUB_RELEASES_TOKEN;
    const prevGh = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_RELEASES_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      const res = await request(app).get(
        `/api/desktop/releases/assets/${encodeURIComponent(PILOT_DESKTOP_RELEASE.assets[0].fileName)}`,
      );
      expect(res.status).toBe(503);
    } finally {
      if (prev !== undefined) process.env.GITHUB_RELEASES_TOKEN = prev;
      if (prevGh !== undefined) process.env.GITHUB_TOKEN = prevGh;
    }
  });
});
