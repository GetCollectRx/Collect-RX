#!/usr/bin/env node
// scripts/test-with-db.mjs
//
// `npm test` entry point. Runs the Vitest suite against a PostgreSQL 16 that this
// script provisions itself when DATABASE_URL is not already reachable, so nobody
// has to start a database by hand. If a database cannot be provisioned, the run
// exits non-zero with the reason. It never reports green by skipping DB suites.
//
// Environment:
//   (no database URL is read from the environment; the local test database is always used)
//   COLLECTRX_TEST_PG_PORT     port for the provisioned database (default 54329)
//   COLLECTRX_TEST_PG_KEEP=1   leave the provisioned PostgreSQL running after the run
//   COLLECTRX_TEST_PG_RESET=1  drop and recreate the test database before migrating
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = process.env.COLLECTRX_TEST_PG_CACHE || join(homedir(), '.cache', 'collectrx-test-db');
const PORT = Number(process.env.COLLECTRX_TEST_PG_PORT || 54329);
const DB_NAME = 'collectrx_test';
const SUPER_URL = `postgresql://postgres@127.0.0.1:${PORT}/${DB_NAME}`;
const APP_URL = `postgresql://collectrx_app@127.0.0.1:${PORT}/${DB_NAME}`;
const EMBEDDED_VERSION = '16.14.0-beta.17';
const DATA = join(CACHE, 'data');
const SOCK = join(CACHE, 'sock');
const LOG = join(CACHE, 'postgres.log');

let startedByUs = false;

function fail(message) {
  console.error(`\n[test-with-db] ${message}\n`);
  process.exit(2);
}

function log(message) {
  console.log(`[test-with-db] ${message}`);
}

async function reachable(url) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: options.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, ...(options.env ?? {}) },
  });
}

function findBin(name) {
  const scope = join(CACHE, 'node_modules', '@embedded-postgres');
  if (!existsSync(scope)) return null;
  for (const pkg of readdirSync(scope)) {
    const candidate = join(scope, pkg, 'native', 'bin', name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function installBinaries() {
  if (findBin('pg_ctl') && findBin('initdb')) return;
  mkdirSync(CACHE, { recursive: true });
  log(`installing embedded PostgreSQL ${EMBEDDED_VERSION} into ${CACHE} (first run only)`);
  const result = run('npm', [
    'install', '--prefix', CACHE, '--no-audit', '--no-fund', '--no-save',
    `embedded-postgres@${EMBEDDED_VERSION}`,
  ]);
  if (result.status !== 0 || !findBin('pg_ctl')) {
    fail('could not install embedded PostgreSQL. Check access to the npm registry, or set DATABASE_URL to a migrated database.');
  }
}

function startServer() {
  installBinaries();
  const pgCtl = findBin('pg_ctl');
  const initdb = findBin('initdb');
  mkdirSync(SOCK, { recursive: true });

  if (!existsSync(join(DATA, 'PG_VERSION'))) {
    const init = run(initdb, ['-D', DATA, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-locale'], { quiet: true });
    if (init.status !== 0) fail(`initdb failed:\n${init.stderr}`);
  }

  const status = run(pgCtl, ['-D', DATA, 'status'], { quiet: true });
  if (status.status === 0) {
    log(`reusing PostgreSQL already running in ${DATA}`);
    return;
  }
  const start = run(pgCtl, [
    '-D', DATA, '-l', LOG, '-w', '-t', '60',
    '-o', `-p ${PORT} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${SOCK}`,
    'start',
  ], { quiet: true });
  if (start.status !== 0) {
    fail(`PostgreSQL did not start on port ${PORT}. See ${LOG}. If another process holds the port, set COLLECTRX_TEST_PG_PORT.`);
  }
  startedByUs = true;
}

function stopServer() {
  if (!startedByUs || process.env.COLLECTRX_TEST_PG_KEEP === '1') return;
  const pgCtl = findBin('pg_ctl');
  if (pgCtl) run(pgCtl, ['-D', DATA, '-m', 'fast', 'stop'], { quiet: true });
}

async function prepareDatabase() {
  const admin = new pg.Client({ connectionString: `postgresql://postgres@127.0.0.1:${PORT}/postgres` });
  await admin.connect();
  try {
    if (process.env.COLLECTRX_TEST_PG_RESET === '1') {
      await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    }
    const database = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
    if (database.rowCount === 0) await admin.query(`CREATE DATABASE ${DB_NAME}`);
    const role = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', ['collectrx_app']);
    if (role.rowCount === 0) await admin.query('CREATE ROLE collectrx_app LOGIN NOSUPERUSER NOBYPASSRLS');
  } finally {
    await admin.end();
  }

  const migrate = run('npx', ['prisma', 'migrate', 'deploy'], {
    quiet: true,
    env: { DATABASE_URL: SUPER_URL, DIRECT_URL: SUPER_URL },
  });
  if (migrate.status !== 0) {
    fail(`prisma migrate deploy failed against the test database:\n${migrate.stdout}${migrate.stderr}`);
  }

  // Re-applied after every migrate so tables added by new migrations are covered.
  const grants = new pg.Client({ connectionString: SUPER_URL });
  await grants.connect();
  try {
    await grants.query(`GRANT CONNECT ON DATABASE ${DB_NAME} TO collectrx_app`);
    await grants.query('GRANT USAGE ON SCHEMA public TO collectrx_app');
    await grants.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO collectrx_app');
    await grants.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO collectrx_app');
    await grants.query('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO collectrx_app');
  } finally {
    await grants.end();
  }
}

async function resolveEnvironment() {
  // Tests always run against the local embedded database. An ambient DATABASE_URL
  // (for example one pointing at Fly staging or production) is ignored on purpose.
  if (process.env.DATABASE_URL) {
    log("ignoring DATABASE_URL from the environment; tests always use the local test database");
  }
  startServer();
  await prepareDatabase();
  return {
    DATABASE_URL: SUPER_URL,
    RLS_SETUP_DATABASE_URL: SUPER_URL,
    RLS_APP_DATABASE_URL: APP_URL,
  };
}

const env = await resolveEnvironment();
const child = spawn('npx', ['vitest', 'run', ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, ...env, COLLECTRX_REQUIRE_DB: '1' },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
child.on('exit', (code, signal) => {
  stopServer();
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
