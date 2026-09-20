import {
  parseGithubReleaseAssets,
  PILOT_DESKTOP_RELEASE,
  PILOT_RELEASE_TAG,
  proxyDesktopAssetUrl,
  type DesktopReleaseInfo,
} from '../../lib/desktopReleases.js';
import { logger } from '../observability/logger.js';

const GITHUB_REPO = 'GetCollectRx/Collect-RX';
const PINNED_RELEASE_TAG = process.env.DESKTOP_RELEASE_TAG?.trim() || '';
const CACHE_MS = 5 * 60 * 1000;

/**
 * Serve the latest published release by default so the download page tracks new
 * versions automatically. Set DESKTOP_RELEASE_TAG to pin a specific tag (e.g. a
 * controlled pilot rollout).
 */
function primaryReleaseUrl(): string {
  return PINNED_RELEASE_TAG
    ? `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${PINNED_RELEASE_TAG}`
    : `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
}

/**
 * Last-resort release used when the primary lookup returns nothing. When
 * tracking "latest", `/releases/latest` 404s if only pre-release/draft releases
 * exist — fall back to the known pilot tag so downloads never regress. When a
 * tag is explicitly pinned, the primary already targets it, so no fallback.
 */
function fallbackReleaseUrl(): string | null {
  return PINNED_RELEASE_TAG
    ? null
    : `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${PILOT_RELEASE_TAG}`;
}

type GithubAsset = { id: number; name: string; size?: number; browser_download_url: string };
type GithubRelease = {
  tag_name?: string;
  published_at?: string;
  html_url?: string;
  assets?: GithubAsset[];
};

let cachedRelease: { at: number; release: GithubRelease } | null = null;

function githubToken(): string | undefined {
  const raw =
    process.env.GITHUB_RELEASES_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.COLLECTRX;
  const trimmed = raw?.trim();
  return trimmed || undefined;
}

function githubHeaders(accept = 'application/vnd.github+json'): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'CollectRx-Desktop-Releases',
  };
  const token = githubToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchGithubRelease(url: string): Promise<GithubRelease | null> {
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) {
    logger.error('[desktop/releases] GitHub API', { status: res.status, url: url.replace(GITHUB_REPO, '***') });
    return null;
  }
  return (await res.json()) as GithubRelease;
}

async function fetchReleaseWithAssets(): Promise<GithubRelease | null> {
  const token = githubToken();
  if (!token) return null;

  const cached = await resolveGithubRelease();
  if (cached?.assets?.length) return cached;

  const byTag = await fetchGithubRelease(primaryReleaseUrl());
  if (byTag?.assets?.length) {
    cachedRelease = { at: Date.now(), release: byTag };
    return byTag;
  }

  const fb = fallbackReleaseUrl();
  if (fb) {
    const fbRelease = await fetchGithubRelease(fb);
    if (fbRelease?.assets?.length) {
      cachedRelease = { at: Date.now(), release: fbRelease };
      return fbRelease;
    }
  }

  return null;
}

async function resolveGithubRelease(): Promise<GithubRelease | null> {
  const now = Date.now();
  if (cachedRelease && now - cachedRelease.at < CACHE_MS) {
    return cachedRelease.release;
  }

  const token = githubToken();
  let release: GithubRelease | null = null;

  if (token) {
    release = await fetchGithubRelease(primaryReleaseUrl());
    if (!release?.assets?.length) {
      const fb = fallbackReleaseUrl();
      if (fb) release = await fetchGithubRelease(fb);
    }
  }

  if (release?.assets?.length) {
    cachedRelease = { at: now, release };
    return release;
  }

  return null;
}

function toReleaseInfo(release: GithubRelease): DesktopReleaseInfo {
  const version = (release.tag_name || '').replace(/^v/, '') || PILOT_DESKTOP_RELEASE.version;
  const releasePageUrl = release.html_url || PILOT_DESKTOP_RELEASE.releasePageUrl;
  const assets = release.assets ?? [];
  const parsed = parseGithubReleaseAssets(version, release.published_at ?? null, releasePageUrl, assets);
  return {
    ...parsed,
    assets: parsed.assets.map((a) => ({
      ...a,
      downloadUrl: proxyDesktopAssetUrl(a.fileName),
    })),
  };
}

/** Public release metadata — uses GitHub API when token is set, else pinned pilot manifest. */
export async function getDesktopReleaseInfo(): Promise<DesktopReleaseInfo> {
  const release = await resolveGithubRelease();
  if (release) return toReleaseInfo(release);
  return PILOT_DESKTOP_RELEASE;
}

export async function findGithubAsset(fileName: string): Promise<GithubAsset | null> {
  const release = await fetchReleaseWithAssets();
  if (!release?.assets?.length) return null;
  return release.assets.find((a) => a.name === fileName) ?? null;
}

/** Stream a release asset through CollectRx (required when the GitHub repo is private). */
export async function streamGithubReleaseAsset(
  fileName: string,
): Promise<{ status: number; headers: Headers; body: ReadableStream<Uint8Array> } | null> {
  const token = githubToken();
  if (!token) return null;

  const asset = await findGithubAsset(fileName);
  if (!asset) {
    logger.error('[desktop/releases] asset not in release', { error: fileName });
    return null;
  }

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/assets/${asset.id}`,
    { headers: githubHeaders('application/octet-stream'), redirect: 'follow' },
  );
  if (!res.ok || !res.body) {
    logger.error('[desktop/releases] asset stream', { status: res.status, fileName });
    return null;
  }

  return { status: res.status, headers: res.headers, body: res.body };
}

export function isDesktopReleaseDownloadConfigured(): boolean {
  return Boolean(githubToken());
}

export async function canResolveDesktopRelease(): Promise<boolean> {
  if (!githubToken()) return false;
  const release = await fetchReleaseWithAssets();
  return Boolean(release?.assets?.length);
}

/** Safe prod check — never exposes the token. */
export async function getDesktopReleaseDiagnostics(): Promise<{
  tokenPresent: boolean;
  tokenLength: number;
  githubStatus: number | null;
  assetCount: number;
  message: string | null;
}> {
  const token = githubToken();
  if (!token) {
    return { tokenPresent: false, tokenLength: 0, githubStatus: null, assetCount: 0, message: 'No token' };
  }

  const url = primaryReleaseUrl();
  const res = await fetch(url, { headers: githubHeaders() });
  const body = (await res.json().catch(() => ({}))) as {
    message?: string;
    assets?: unknown[];
  };

  return {
    tokenPresent: true,
    tokenLength: token.length,
    githubStatus: res.status,
    assetCount: body.assets?.length ?? 0,
    message: body.message ?? null,
  };
}
