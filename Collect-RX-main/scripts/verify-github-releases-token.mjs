#!/usr/bin/env node
/**
 * Verify a GitHub token can read Collect-RX release assets (private repo downloads).
 * Usage: GITHUB_RELEASES_TOKEN=github_pat_... node scripts/verify-github-releases-token.mjs
 */
const token =
  process.env.GITHUB_RELEASES_TOKEN || process.env.GITHUB_TOKEN || process.env.COLLECTRX;
const tag = process.env.DESKTOP_RELEASE_TAG || 'v1.0.0-pilot';
const repo = 'GetCollectRx/Collect-RX';

if (!token) {
  console.error('Set GITHUB_RELEASES_TOKEN (or COLLECTRX) in the environment.');
  process.exit(1);
}

const url = `https://api.github.com/repos/${repo}/releases/tags/${tag}`;
const res = await fetch(url, {
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'CollectRx-Verify-GitHub-Token',
  },
});

console.log(`GET ${url}`);
console.log(`HTTP ${res.status}`);

if (!res.ok) {
  const body = await res.text();
  console.error(body.slice(0, 500));
  console.error(
    '\nToken cannot read releases. Create a fine-grained PAT with Contents: Read on GetCollectRx/Collect-RX.',
  );
  process.exit(1);
}

const data = await res.json();
const names = (data.assets ?? []).map((a) => a.name);
console.log(`Release: ${data.tag_name}`);
console.log(`Assets (${names.length}):`);
for (const n of names) console.log(`  - ${n}`);

const required = 'CollectRx.Setup.1.0.0.exe';
if (!names.includes(required)) {
  console.error(`\nMissing expected asset: ${required}`);
  process.exit(1);
}

console.log('\nToken OK — safe to set on Fly as GITHUB_RELEASES_TOKEN.');
