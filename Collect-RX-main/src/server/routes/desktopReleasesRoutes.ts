import { Router } from 'express';
import {
  DESKTOP_RELEASES_PAGE,
  parseGithubReleaseAssets,
  type DesktopReleaseInfo,
} from '../../lib/desktopReleases.js';

const GITHUB_REPO = 'GetCollectRx/Collect-RX';

async function fetchLatestGithubRelease(): Promise<DesktopReleaseInfo | null> {
  const token = process.env.GITHUB_RELEASES_TOKEN || process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'CollectRx-Desktop-Releases',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers });
  if (!res.ok) return null;

  const body = (await res.json()) as {
    tag_name?: string;
    published_at?: string;
    html_url?: string;
    assets?: { name: string; browser_download_url: string; size?: number }[];
  };

  const version = (body.tag_name || 'latest').replace(/^v/, '');
  const releasePageUrl = body.html_url || DESKTOP_RELEASES_PAGE;
  const assets = body.assets ?? [];
  if (assets.length === 0) return null;

  return parseGithubReleaseAssets(version, body.published_at ?? null, releasePageUrl, assets);
}

export function createDesktopReleasesRouter(): Router {
  const router = Router();

  /** Public — download page uses this to list signed GitHub release assets when a token is configured. */
  router.get('/desktop/releases', async (_req, res) => {
    try {
      const data = await fetchLatestGithubRelease();
      if (!data) {
        return res.json({
          success: true,
          data: null,
          message: 'No release metadata available — use the GitHub releases page.',
        });
      }
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[desktop/releases]', (err as Error).message);
      return res.status(500).json({ success: false, error: 'Failed to load release metadata' });
    }
  });

  return router;
}
