import {
  parseGithubReleaseAssets,
  PILOT_DESKTOP_RELEASE,
  proxyDesktopAssetUrl,
  type DesktopReleaseInfo,
} from '../../lib/desktopReleases.js';

const GITHUB_REPO = 'GetCollectRx/Collect-RX';
const DEFAULT_RELEASE_TAG = process.env.DESKTOP_RELEASE_TAG?.trim() || 'v1.0.0-pilot';
const CACHE_MS = 5 * 60 * 1000;

type GithubAsset = { id: number; name: string; size?: number; browser_download_url: string };
type GithubRelease = {
  tag_name?: string;
  published_at?: string;
  html_url?: string;
  assets?: GithubAsset[];
};

let cachedRelease: { at: number; release: GithubRelease } | null = null;

function githubToken(): string | undefined {
  return process.env.GITHUB_RELEASES_TOKEN || process.env.GITHUB_TOKEN;
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
  if (!res.ok) return null;
  return (await res.json()) as GithubRelease;
}

async function resolveGithubRelease(): Promise<GithubRelease | null> {
  const now = Date.now();
  if (cachedRelease && now - cachedRelease.at < CACHE_MS) {
    return cachedRelease.release;
  }

  const token = githubToken();
  let release: GithubRelease | null = null;

  if (token) {
    release = await fetchGithubRelease(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    if (!release) {
      release = await fetchGithubRelease(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${DEFAULT_RELEASE_TAG}`,
      );
    }
  }

  if (release?.assets?.length) {
    cachedRelease = { at: now, release };
    return release;
  }

  return null;
}

function toReleaseInfo(release: GithubRelease): DesktopReleaseInfo {
  const version = (release.tag_name || DEFAULT_RELEASE_TAG).replace(/^v/, '');
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
  const release = await resolveGithubRelease();
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
  if (!asset) return null;

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/assets/${asset.id}`,
    { headers: githubHeaders('application/octet-stream'), redirect: 'follow' },
  );
  if (!res.ok || !res.body) return null;

  return { status: res.status, headers: res.headers, body: res.body };
}

export function isDesktopReleaseDownloadConfigured(): boolean {
  return Boolean(githubToken());
}
