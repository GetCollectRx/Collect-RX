#!/usr/bin/env node
/**
 * One-command local bootstrap: .env -> Postgres/Redis -> migrate -> seed -> print login.
 *
 * DoD (OUTSTANDING-FIXES-PRODUCT-READY.md P10-06): a clean clone with only Node
 * and (optionally) Docker installed reaches a running, logged-in app with one
 * command — no manual secret generation, no silent port mismatch.
 *
 * Usage:
 *   npm run setup                 — full demo practice (recommended first run)
 *   npm run setup -- --minimal    — empty baseline practice only (db:seed, not demo:seed)
 *   npm run setup -- --reset      — wipe + reseed the demo practice
 *
 * Non-interactive by design (no prompts) so it also works unattended in CI/agent
 * environments. Never overwrites a value already present in .env — safe to
 * re-run after a `git pull`.
 */
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pkgRoot, repoRoot, readEnvFromDotenv } from './free-dev-ports.mjs';
import { tcpReachable } from './ensure-dev-services.mjs';

const args = process.argv.slice(2);
const MINIMAL = args.includes('--minimal');
const RESET = args.includes('--reset');

const ENV_PATH = path.join(pkgRoot, '.env');
const ENV_EXAMPLE_PATH = path.join(pkgRoot, '.env.example');

const PG_USER = 'collectrx';
const PG_PASSWORD = 'collectrx_local_dev_only';
const PG_DB = 'collectrx';
const PG_DOCKER_PORT = 5433;
const PG_NATIVE_PORT = 5432;
const REDIS_PORT = 6379;

function log(msg) {
  console.log(`[setup] ${msg}`);
}

function warn(msg) {
  console.warn(`[setup] ${msg}`);
}

function fail(msg) {
  console.error(`[setup] ${msg}`);
  process.exit(1);
}

function hexSecret(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

function ensureDotEnvFile() {
  if (fs.existsSync(ENV_PATH)) return;
  if (!fs.existsSync(ENV_EXAMPLE_PATH)) {
    fail(`.env.example not found at ${ENV_EXAMPLE_PATH} — cannot bootstrap .env`);
  }
  fs.copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH);
  log('Created .env from .env.example');
}

/** Append KEY=value only if KEY isn't already set (commented lines don't count as set). */
function setEnvIfMissing(key, value) {
  const existing = readEnvFromDotenv(key);
  if (existing) return false;
  fs.appendFileSync(ENV_PATH, `\n${key}=${value}\n`);
  return true;
}

/** Replace an existing uncommented KEY=... line in place, or append if absent. */
function setEnvValue(key, value) {
  const content = fs.readFileSync(ENV_PATH, 'utf8');
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(content)) {
    fs.writeFileSync(ENV_PATH, content.replace(pattern, `${key}=${value}`));
  } else {
    fs.appendFileSync(ENV_PATH, `\n${key}=${value}\n`);
  }
}

/**
 * .env.example previously shipped DEV_API_TARGET=remote uncommented, directly
 * contradicting its own comment ("local ... (default)") — every fresh `cp
 * .env.example .env` pointed `npm run dev` at production and silently
 * ignored the local Postgres/migrate/seed work entirely. Fixed at the source
 * (see .env.example), but this script's whole job is a working local
 * instance, so also correct it in an existing .env from before that fix.
 */
function ensureLocalDevTarget() {
  const current = readEnvFromDotenv('DEV_API_TARGET');
  if (current && current !== 'local') {
    warn(`DEV_API_TARGET was '${current}' — forcing 'local' (this script sets up a local instance; unset it yourself after if you want remote mode).`);
  }
  setEnvValue('DEV_API_TARGET', 'local');
}

function dockerAvailable() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function waitForReachable(host, port, attempts = 20, delayMs = 500) {
  for (let i = 0; i < attempts; i++) {
    if (await tcpReachable(host, port)) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

/** Try to create the collectrx role/database on an already-running native Postgres. */
function tryProvisionNativeDatabase() {
  const commands = [
    `sudo -u postgres psql -c "CREATE ROLE ${PG_USER} LOGIN PASSWORD '${PG_PASSWORD}' SUPERUSER;"`,
    `sudo -u postgres psql -c "CREATE DATABASE ${PG_DB} OWNER ${PG_USER};"`,
  ];
  for (const cmd of commands) {
    try {
      execSync(cmd, { stdio: 'pipe' });
    } catch (err) {
      const text = String(err.stderr || err.message || '');
      if (text.includes('already exists')) continue; // idempotent re-run
      return { ok: false, error: text.trim() };
    }
  }
  return { ok: true };
}

// .env.example ships this exact line uncommented (see P10-07) so a fresh `cp
// .env.example .env` already "has" a DATABASE_URL — but it's a placeholder,
// not a real decision. Treat it the same as unset so setup can actually pick
// Docker vs native, instead of a copied boilerplate line short-circuiting
// that choice and later failing opaquely if Docker isn't running.
const UNDECIDED_DATABASE_URL = `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_DOCKER_PORT}/${PG_DB}`;

/**
 * Decide where Postgres lives and get DATABASE_URL set. Prefers Docker (the
 * role/db are baked into docker-compose.yml, zero manual provisioning); falls
 * back to a native install, attempting to provision the role/db itself; if
 * neither works, prints the exact manual commands instead of failing silently.
 */
async function ensureDatabase() {
  const existingUrl = readEnvFromDotenv('DATABASE_URL');
  const isDecided = existingUrl && existingUrl !== UNDECIDED_DATABASE_URL;

  if (isDecided) {
    let endpoint;
    try {
      const u = new URL(existingUrl);
      endpoint = { host: u.hostname || '127.0.0.1', port: parseInt(u.port || '5432', 10) };
    } catch {
      warn('DATABASE_URL in .env is not a valid URL — leaving it as-is.');
      return;
    }
    if (await tcpReachable(endpoint.host, endpoint.port)) {
      log(`DATABASE_URL already set and reachable at ${endpoint.host}:${endpoint.port} — leaving it as-is.`);
      return;
    }
    warn(`DATABASE_URL is set (${endpoint.host}:${endpoint.port}) but nothing is listening there.`);
    warn('Not touching an explicit DATABASE_URL automatically — fix it by hand, or unset it and re-run npm run setup.');
    fail('Cannot continue without a reachable database.');
  }

  // Either genuinely unset, or still the copied .env.example placeholder —
  // both mean "not yet decided," so pick Docker vs native for real.
  if (await tcpReachable('localhost', PG_DOCKER_PORT)) {
    setEnvValue('DATABASE_URL', UNDECIDED_DATABASE_URL);
    log(`Postgres already reachable on port ${PG_DOCKER_PORT} — using it.`);
    return;
  }

  if (dockerAvailable()) {
    log('Docker available — starting `docker compose up -d postgres`…');
    try {
      execSync('docker compose up -d postgres', { cwd: repoRoot, stdio: 'inherit' });
    } catch {
      fail('`docker compose up -d postgres` failed — see output above.');
    }
    const ready = await waitForReachable('localhost', PG_DOCKER_PORT);
    if (!ready) fail('Postgres did not become reachable via Docker after 10s.');
    setEnvValue('DATABASE_URL', UNDECIDED_DATABASE_URL);
    log(`Postgres ready (Docker, port ${PG_DOCKER_PORT}).`);
    return;
  }

  log('Docker not available — checking for a native Postgres on port 5432…');
  if (!(await tcpReachable('localhost', PG_NATIVE_PORT))) {
    fail(
      [
        'No Docker and nothing listening on localhost:5432.',
        'Start a local Postgres first, then re-run `npm run setup`:',
        '  • Debian/Ubuntu: sudo pg_ctlcluster 16 main start',
        '  • Mac (Homebrew): brew services start postgresql',
        '  • Or install Docker and re-run — docker-compose.yml handles the rest.',
      ].join('\n[setup] '),
    );
  }

  const candidateUrl = `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_NATIVE_PORT}/${PG_DB}`;
  try {
    execSync(`psql "${candidateUrl}" -c "SELECT 1"`, { stdio: 'pipe' });
    setEnvValue('DATABASE_URL', candidateUrl);
    log(`Postgres ready (native, port ${PG_NATIVE_PORT}, role already provisioned).`);
    return;
  } catch {
    // role/db likely doesn't exist yet — try to provision it, matching exactly
    // what a developer would type by hand on a fresh native install.
  }

  log(`Postgres is running but the '${PG_USER}' role/database don't exist yet — provisioning…`);
  const result = tryProvisionNativeDatabase();
  if (!result.ok) {
    fail(
      [
        `Could not auto-provision the '${PG_USER}' role/database (no sudo, or a different auth setup).`,
        'Create them yourself, then re-run `npm run setup`:',
        `  sudo -u postgres psql -c "CREATE ROLE ${PG_USER} LOGIN PASSWORD '${PG_PASSWORD}' SUPERUSER;"`,
        `  sudo -u postgres psql -c "CREATE DATABASE ${PG_DB} OWNER ${PG_USER};"`,
        `Error: ${result.error}`,
      ].join('\n[setup] '),
    );
  }
  setEnvValue('DATABASE_URL', candidateUrl);
  log(`Postgres ready (native, port ${PG_NATIVE_PORT}, role provisioned).`);
}

async function ensureRedis() {
  if (readEnvFromDotenv('REDIS_URL')) {
    log('REDIS_URL already set — leaving it as-is.');
    return;
  }
  if (await tcpReachable('127.0.0.1', REDIS_PORT)) {
    setEnvIfMissing('REDIS_URL', `redis://127.0.0.1:${REDIS_PORT}`);
    log('Redis already reachable on 6379 — set REDIS_URL.');
    return;
  }
  if (dockerAvailable()) {
    log('Starting `docker compose up -d redis`…');
    try {
      execSync('docker compose up -d redis', { cwd: repoRoot, stdio: 'inherit' });
      if (await waitForReachable('127.0.0.1', REDIS_PORT)) {
        setEnvIfMissing('REDIS_URL', `redis://127.0.0.1:${REDIS_PORT}`);
        log('Redis ready (Docker).');
        return;
      }
    } catch {
      /* fall through — Redis is optional */
    }
  }
  log('Redis not available — skipping REDIS_URL (background jobs run in-process; this is fine for local dev).');
}

// .env.example ships these two uncommented with literal "fill this in"
// placeholder text (unlike DATABASE_URL's placeholder, these aren't even a
// value that could work) — setEnvIfMissing would see them as "already set"
// and never generate a real secret. VAPI_API_KEY / VAPI_PHONE_NUMBER_ID have
// the same pattern but genuinely can't be auto-generated (they're issued by
// a real Vapi account), so those are left alone.
const PLACEHOLDER_VALUES = {
  JWT_SECRET: 'change_me_in_production_use_openssl_rand_hex_32',
  VAPI_WEBHOOK_SECRET: 'your_webhook_signing_token_here',
};

/** Generates and writes `key` unless it already holds a real (non-placeholder) value. */
function setSecretIfMissingOrPlaceholder(key, value) {
  const existing = readEnvFromDotenv(key);
  if (existing && existing !== PLACEHOLDER_VALUES[key]) return false;
  setEnvValue(key, value);
  return true;
}

function ensureSecrets() {
  if (setSecretIfMissingOrPlaceholder('JWT_SECRET', hexSecret())) log('Generated JWT_SECRET.');
  if (setEnvIfMissing('PHI_ENCRYPTION_KEY', hexSecret())) log('Generated PHI_ENCRYPTION_KEY.');
  if (setSecretIfMissingOrPlaceholder('VAPI_WEBHOOK_SECRET', hexSecret(16))) log('Generated VAPI_WEBHOOK_SECRET (dev placeholder).');
}

/** Returns the password that ends up in .env, whether pre-existing or newly generated. */
function ensureSeedPassword() {
  const existing = readEnvFromDotenv('SEED_PRACTICE_PASSWORD');
  if (existing) return existing;
  const generated = randomBytes(9).toString('base64url'); // 12 chars, well past the 8-char minimum
  setEnvIfMissing('SEED_PRACTICE_PASSWORD', generated);
  log('Generated SEED_PRACTICE_PASSWORD (printed below — save it).');
  return generated;
}

function run(cmd) {
  log(`$ ${cmd}`);
  execSync(cmd, { cwd: pkgRoot, stdio: 'inherit' });
}

/** Runs a command and returns its stdout so the caller can inspect what
 * happened (seed-demo.ts exits 0 either way — "already seeded" isn't an
 * error, so a thrown-exception check can't detect it, only the printed text
 * can). stdout is buffered and printed once the command finishes rather than
 * streamed live — acceptable here since seed-demo.ts only takes a few
 * seconds; stderr still streams live via execSync's default stdio. */
function runCaptured(cmd) {
  log(`$ ${cmd}`);
  const output = execSync(cmd, { cwd: pkgRoot, encoding: 'utf8' });
  process.stdout.write(output);
  return output;
}

async function main() {
  ensureDotEnvFile();
  ensureLocalDevTarget();
  await ensureDatabase();
  await ensureRedis();
  ensureSecrets();
  const password = ensureSeedPassword();
  const email = readEnvFromDotenv('SEED_PRACTICE_EMAIL') || 'demo@collectrx-test.local';

  run('npx prisma generate');
  run('npx prisma migrate deploy');

  let alreadySeeded = false;
  if (MINIMAL) {
    run('npx tsx src/server/seed.ts');
  } else {
    const output = runCaptured(`npx tsx scripts/seed-demo.ts${RESET ? ' -- --reset' : ''}`);
    alreadySeeded = /demo practice already exists/i.test(output);
  }

  console.log('');
  console.log('[setup] ─────────────────────────────────────────');
  console.log('[setup] Ready.');
  if (alreadySeeded) {
    console.log(`[setup] Demo practice already existed — the password below is only correct if it`);
    console.log(`[setup] matches what created that practice originally (e.g. this .env was already`);
    console.log(`[setup] here). If login fails, run: npm run setup -- --reset`);
  }
  console.log(`[setup] Login:    ${email} / ${password}`);
  console.log('[setup] Next:     npm run dev');
  console.log('[setup] ─────────────────────────────────────────');
  console.log('');
}

main().catch((err) => {
  console.error('[setup] failed:', err.message || err);
  process.exit(1);
});
