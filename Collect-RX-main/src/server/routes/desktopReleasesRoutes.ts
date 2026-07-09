import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import {
  getDesktopReleaseInfo,
  isDesktopReleaseDownloadConfigured,
  streamGithubReleaseAsset,
} from '../services/desktopReleaseService.js';

export function createDesktopReleasesRouter(): Router {
  const router = Router();

  /** Public — lists desktop installers (proxied URLs when GitHub repo is private). */
  router.get('/desktop/releases', async (_req, res) => {
    try {
      const data = await getDesktopReleaseInfo();
      return res.json({
        success: true,
        data,
        downloadsConfigured: isDesktopReleaseDownloadConfigured(),
      });
    } catch (err) {
      console.error('[desktop/releases]', (err as Error).message);
      return res.status(500).json({ success: false, error: 'Failed to load release metadata' });
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
        return res.status(404).json({ success: false, error: 'Installer not found' });
      }

      const contentType = streamed.headers.get('content-type') || 'application/octet-stream';
      const contentLength = streamed.headers.get('content-length');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      if (contentLength) res.setHeader('Content-Length', contentLength);

      await pipeline(Readable.fromWeb(streamed.body as import('stream/web').ReadableStream), res);
      return undefined;
    } catch (err) {
      console.error('[desktop/releases/assets]', fileName, (err as Error).message);
      if (!res.headersSent) {
        return res.status(502).json({ success: false, error: 'Failed to download installer' });
      }
      return undefined;
    }
  });

  return router;
}
