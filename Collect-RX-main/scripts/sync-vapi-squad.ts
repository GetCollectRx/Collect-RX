// ─────────────────────────────────────────────────────────────────────────────
// sync-vapi-squad.ts — reconcile vapi-squad-config.json against the live
// assistants on Vapi.
//
// Why this exists: vapi-squad-config.json is edited and merged like any other
// file, but nothing ever pushed it to the live squad automatically — updating
// the live assistants was a manual PATCH via the Vapi dashboard/API, with no
// step confirming a merged change actually reached production. That let a
// merged prompt/tool change (verify_payment_amount on Claims_Agent) sit in
// the repo, un-deployed, indefinitely.
//
// Matching: the config carries no assistant IDs (it's the squad-creation
// payload shape), so members are matched to live assistants by exact
// assistant.name — case-sensitive, must be unique on both sides.
//
// Usage:
//   npm run vapi:squad-check          — read-only diff, exit 1 if any drift
//   npm run vapi:squad-push           — apply repo config onto live assistants
//   npm run vapi:squad-push -- --only Claims_Agent   — limit to one member
//
// Required env: VAPI_API_KEY. Optional: VAPI_BASE_URL (default https://api.vapi.ai).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface SquadConfig {
  squad: {
    name: string;
    members: Array<{ assistant: Record<string, unknown> & { name: string } }>;
  };
}

interface LiveAssistant {
  id: string;
  name: string;
  [key: string]: unknown;
}

const CONFIG_PATH = join(import.meta.dirname, '..', 'vapi-squad-config.json');

// Fields Vapi assigns/manages server-side — never present in our source
// config, and never something we diff or push. Anything not in this list is
// compared and, on --push, sent verbatim from the repo config.
const IGNORED_FIELDS = new Set([
  'id',
  'orgId',
  'createdAt',
  'updatedAt',
  'isServerUrlSecretSet',
]);

function getApiKey(): string {
  const key = process.env.VAPI_API_KEY;
  if (!key) throw new Error('VAPI_API_KEY environment variable is not set');
  return key;
}

const VAPI_BASE_URL = (process.env.VAPI_BASE_URL || 'https://api.vapi.ai').replace(/\/$/, '');

async function vapiRequest<T>(method: 'GET' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${VAPI_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)');
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

function loadConfig(): SquadConfig {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as SquadConfig;
}

async function listLiveAssistants(): Promise<LiveAssistant[]> {
  const all: LiveAssistant[] = [];
  let page = await vapiRequest<LiveAssistant[]>('GET', '/assistant?limit=100');
  all.push(...page);
  // Vapi paginates with a `createdAtLt` cursor keyed off the last item; stop
  // once a page comes back short of the page size.
  while (page.length === 100) {
    const cursor = page[page.length - 1]?.createdAt;
    if (!cursor) break;
    page = await vapiRequest<LiveAssistant[]>(
      'GET',
      `/assistant?limit=100&createdAtLt=${encodeURIComponent(String(cursor))}`,
    );
    all.push(...page);
  }
  return all;
}

function stripIgnored(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (IGNORED_FIELDS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function diffValues(path: string, repoVal: unknown, liveVal: unknown, out: string[]): void {
  if (JSON.stringify(repoVal) === JSON.stringify(liveVal)) return;
  const isPlainObj = (v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (isPlainObj(repoVal) && isPlainObj(liveVal)) {
    const keys = new Set([
      ...Object.keys(repoVal as object),
      ...Object.keys(liveVal as object),
    ]);
    for (const k of keys) {
      if (IGNORED_FIELDS.has(k)) continue;
      diffValues(`${path}.${k}`, (repoVal as Record<string, unknown>)[k], (liveVal as Record<string, unknown>)[k], out);
    }
    return;
  }
  const truncate = (v: unknown) => {
    if (v === undefined) return '(missing)';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 120 ? `${s.slice(0, 117)}...` : s;
  };
  out.push(`  ${path}\n    repo: ${truncate(repoVal)}\n    live: ${truncate(liveVal)}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.includes('--push') ? 'push' : 'check';
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;

  const config = loadConfig();
  const members = only
    ? config.squad.members.filter((m) => m.assistant.name === only)
    : config.squad.members;
  if (only && members.length === 0) {
    throw new Error(`--only ${only}: no such member in vapi-squad-config.json`);
  }

  const liveAssistants = await listLiveAssistants();
  const liveByName = new Map<string, LiveAssistant[]>();
  for (const a of liveAssistants) {
    const list = liveByName.get(a.name) ?? [];
    list.push(a);
    liveByName.set(a.name, list);
  }

  let driftCount = 0;
  let missingCount = 0;
  let pushedCount = 0;

  for (const member of members) {
    const name = member.assistant.name;
    const matches = liveByName.get(name) ?? [];

    if (matches.length === 0) {
      console.log(`[MISSING] ${name} — no live assistant with this name exists`);
      missingCount++;
      continue;
    }
    if (matches.length > 1) {
      console.log(`[AMBIGUOUS] ${name} — ${matches.length} live assistants share this name (ids: ${matches.map((m) => m.id).join(', ')}); skipping, resolve duplicates manually`);
      driftCount++;
      continue;
    }

    const live = matches[0];
    const repoBody = stripIgnored(member.assistant);
    const liveBody = stripIgnored(live);

    const diffs: string[] = [];
    diffValues(name, repoBody, liveBody, diffs);

    if (diffs.length === 0) {
      console.log(`[OK] ${name} — matches live (${live.id})`);
      continue;
    }

    driftCount++;
    console.log(`[DRIFT] ${name} (live id ${live.id}):`);
    console.log(diffs.join('\n'));

    if (mode === 'push') {
      await vapiRequest('PATCH', `/assistant/${live.id}`, repoBody);
      console.log(`  → pushed repo config to live assistant ${live.id}`);
      pushedCount++;
    }
  }

  console.log('');
  console.log(`Checked ${members.length} squad member(s): ${driftCount} drifted, ${missingCount} missing on Vapi.`);
  if (mode === 'push') {
    console.log(`Pushed ${pushedCount} update(s).`);
  } else if (driftCount > 0 || missingCount > 0) {
    console.log('Run with --push to apply the repo config to live assistants, or investigate live-side changes that were never committed back.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
