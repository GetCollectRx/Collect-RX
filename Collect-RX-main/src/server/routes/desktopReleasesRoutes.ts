import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import { logger } from '../observability/logger.js';
import {
  getDesktopReleaseInfo,
  canResolveDesktopRelease,
  getDesktopReleaseDiagnostics,
  isDesktopReleaseDownloadConfigured,
  streamGithubReleaseAsset,
} from '../services/desktopReleaseService.js';

export function createDesktopReleasesRouter(): Router {
  const router = Router();

  /** Public — lists desktop installers (proxied URLs when GitHub repo is private). */
  router.get('/desktop/releases', async (_req, res) => {
    try {
      const data = await getDesktopReleaseInfo();
      const downloadsConfigured =
        isDesktopReleaseDownloadConfigured() && (await canResolveDesktopRelease());
      return res.json({
        success: true,
        data,
        downloadsConfigured,
      });
    } catch (err) {
      logger.error('[desktop/releases]', { error: err });
      return res.status(500).json({ success: false, error: 'Failed to load release metadata' });
    }
  });

  /** Public — debug Fly ↔ GitHub (no secrets exposed). */
  router.get('/desktop/releases/diagnostics', async (_req, res) => {
    try {
      const diagnostics = await getDesktopReleaseDiagnostics();
      return res.json({ success: true, ...diagnostics });
    } catch (err) {
      return res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  /** Public — streams a GitHub release asset (requires GITHUB_RELEASES_TOKEN on the server). */
  router.get('/desktop/releases/assets/:fileName', async (req, res) => {
    const fileName = decodeURIComponent(String(req.params.fileName ?? ''));
    if (!fileName || fileName.includes('..') || fileName.includes('/')) {
      return res.status(400).json({ success: false, error: 'Invalid file name' });
    }

    if (!isDesktopReleaseDownloadConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Desktop downloads are not configured on this server. Contact support@collectrx.ca.',
      });
    }

    try {
      const streamed = await streamGithubReleaseAsset(fileName);
      if (!streamed) {
        logger.error('[desktop/releases/assets] not found or GitHub denied', { error: fileName });
        return res.status(404).json({
          success: false,
          error:
            'Installer not found. Check GITHUB_RELEASES_TOKEN on Fly has Contents read for GetCollectRx/Collect-RX.',
        });
      }

      const contentType = streamed.headers.get('content-type') || 'application/octet-stream';
      const contentLength = streamed.headers.get('content-length');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      if (contentLength) res.setHeader('Content-Length', contentLength);

      await pipeline(Readable.fromWeb(streamed.body as import('stream/web').ReadableStream), res);
      return undefined;
    } catch (err) {
      logger.error('[desktop/releases/assets]', { fileName, error: err });
      if (!res.headersSent) {
        return res.status(502).json({ success: false, error: 'Failed to download installer' });
      }
      return undefined;
    }
  });

  return router;
}
