#!/usr/bin/env bash
# Contained self-test of the CollectRx application.
#
#   bash self-test/run.sh            everything
#   bash self-test/run.sh crawl      only the spec files whose name matches (any Playwright filter works)
#
# What it does: starts a throwaway database, a fake Vapi, and the real app server
# with an allowlisted environment and an egress guard, then drives the real app
# with a real browser and HTTP calls as synthetic offices. Nothing leaves this
# machine: the app cannot reach a non-loopback address, the browser cannot
# resolve one, and the run fails if either was attempted.
#
# Database, in order of preference:
#   SELFTEST_DATABASE_URL   an existing PostgreSQL 16 database whose name contains "test" or "verify"
#   embedded PostgreSQL     installed once into ~/.cache/collectrx-verify (not possible as root)
#
# Other settings: SELFTEST_PORT (default 3120), FAKE_VAPI_PORT (3199), SELFTEST_REBUILD=1 to rebuild the frontend.
set -uo pipefail
# Job control gives every background server its own process group, so cleanup can stop it and its children.
# (setsid would do the same but macOS does not ship it.)
set -m

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/.." && pwd)"
PORT="${SELFTEST_PORT:-3120}"
VAPI_PORT="${FAKE_VAPI_PORT:-3199}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/collectrx-selftest.XXXXXX")"
EGRESS_LOG="$WORK/egress.log"
REPORT_DIR="${SELFTEST_REPORT_DIR:-$APP/self-test/report}"
PIDS=()
PG_OWN=0
PG_BIN=""
PG_DATA=""

cleanup() {
  # Each server is its own process group (set -m), so killing the group also stops tsx and node children.
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -- "-$p" >/dev/null 2>&1; done
  if [ "$PG_OWN" = 1 ] && [ -n "$PG_BIN" ]; then "$PG_BIN/pg_ctl" -D "$PG_DATA" -m immediate stop >/dev/null 2>&1; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

say() { printf '>> %s\n' "$*"; }
die() { printf 'self-test: %s\n' "$*" >&2; exit 2; }

# ── Database ────────────────────────────────────────────────────────────────
if [ -n "${SELFTEST_DATABASE_URL:-}" ]; then
  DB_NAME="$(printf '%s' "$SELFTEST_DATABASE_URL" | sed -E 's#^[^:]+://[^/]+/([^?]+).*#\1#')"
  case "$DB_NAME" in *test*|*verify*) ;; *) die "refusing to use database '$DB_NAME': its name must contain 'test' or 'verify'" ;; esac
  DATABASE_URL="$SELFTEST_DATABASE_URL"
else
  [ "$(id -u)" = 0 ] && die "no SELFTEST_DATABASE_URL and the embedded database cannot be started as root; set SELFTEST_DATABASE_URL"
  CACHE="${VERIFY_CACHE:-$HOME/.cache/collectrx-verify}"
  for d in "$CACHE"/node_modules/@embedded-postgres/*/native/bin; do [ -x "$d/pg_ctl" ] && PG_BIN="$d"; done
  if [ -z "$PG_BIN" ]; then
    say "Installing embedded PostgreSQL 16 into $CACHE (one time)"
    npm install --prefix "$CACHE" --no-audit --no-fund --no-save embedded-postgres@16.14.0-beta.17 >/dev/null 2>&1 || die "could not install embedded PostgreSQL"
    for d in "$CACHE"/node_modules/@embedded-postgres/*/native/bin; do [ -x "$d/pg_ctl" ] && PG_BIN="$d"; done
  fi
  [ -n "$PG_BIN" ] || die "embedded PostgreSQL not found"
  PG_DATA="$WORK/pgdata"; PG_PORT="$(( (RANDOM % 2000) + 56000 ))"
  "$PG_BIN/initdb" -D "$PG_DATA" -U prisma -A trust >/dev/null 2>&1 || die "initdb failed"
  "$PG_BIN/pg_ctl" -D "$PG_DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$WORK" -l "$WORK/postgres.log" -w start >/dev/null 2>&1 || die "postgres failed to start (see $WORK/postgres.log)"
  PG_OWN=1
  # The embedded package ships no createdb, so the database is created through the repo's own pg driver.
  (cd "$APP" && node -e '
    const { createRequire } = require("module");
    const { Client } = createRequire(process.cwd() + "/")("pg");
    (async () => {
      const c = new Client({ connectionString: "postgresql://prisma@127.0.0.1:" + process.argv[1] + "/postgres" });
      await c.connect();
      await c.query("create database selftest_app");
      await c.end();
    })().catch((e) => { console.error(e.message); process.exit(1); });
  ' "$PG_PORT") || die "creating the database failed"
  DATABASE_URL="postgresql://prisma@127.0.0.1:$PG_PORT/selftest_app?schema=public&connection_limit=30&pool_timeout=20"
fi
export DATABASE_URL

cd "$APP" || die "cannot enter $APP"
# A fresh checkout has no generated database client, and the app cannot start without it.
say "Generating the database client"
npx --no-install prisma generate >"$WORK/generate.log" 2>&1 || { tail -20 "$WORK/generate.log"; die "prisma generate failed"; }
say "Database ready; applying migrations"
npx --no-install prisma migrate deploy >"$WORK/migrate.log" 2>&1 || { tail -20 "$WORK/migrate.log"; die "migrations failed"; }

# ── Frontend ────────────────────────────────────────────────────────────────
if [ ! -f "$APP/dist/index.html" ] || [ "${SELFTEST_REBUILD:-0}" = 1 ]; then
  say "Building the frontend"
  NODE_ENV=production npx --no-install vite build >"$WORK/vite.log" 2>&1 || { tail -20 "$WORK/vite.log"; die "frontend build failed"; }
fi

# ── Fake Vapi and the real app ──────────────────────────────────────────────
FAKE_VAPI_PORT="$VAPI_PORT" node "$HERE/fakeVapi.mjs" >"$WORK/fake-vapi.log" 2>&1 & PIDS+=("$!")
for _ in $(seq 1 20); do curl -fsS -m 1 "http://127.0.0.1:$VAPI_PORT/__health" >/dev/null 2>&1 && break; sleep 0.5; done

# Run tsx directly: going through npx makes npm itself look for updates on the network.
TSX_BIN=""
for d in "$APP/node_modules/.bin" "$APP/../node_modules/.bin"; do [ -x "$d/tsx" ] && TSX_BIN="$d/tsx" && break; done
[ -n "$TSX_BIN" ] || die "tsx not found; run npm ci first"
WEBHOOK_SECRET="selftest-$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
JWT_SECRET_VALUE="selftest-jwt-$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
say "Starting the app on :$PORT (allowlisted environment, egress guard on)"
# env -i drops every inherited variable, so no third-party key or proxy can reach the app.
env -i PATH="$PATH" HOME="$WORK" TMPDIR="$WORK" \
  NODE_OPTIONS="--require $HERE/egressGuard.cjs" SELFTEST_EGRESS_LOG="$EGRESS_LOG" \
  DATABASE_URL="$DATABASE_URL" PORT="$PORT" JWT_SECRET="$JWT_SECRET_VALUE" \
  COLLECTRX_E2E=1 COLLECTRX_FORCE_CALL_WINDOW=1 \
  VAPI_API_KEY="selftest-placeholder-not-a-key" VAPI_BASE_URL="http://127.0.0.1:$VAPI_PORT" \
  VAPI_WEBHOOK_SECRET="$WEBHOOK_SECRET" VAPI_PHONE_NUMBER_ID="selftest-phone-number-id" VAPI_SQUAD_ID="selftest-squad-id" VAPI_HUMAN_ASSISTED_SQUAD_ID="selftest-human-squad-id" \
  "$TSX_BIN" src/server/index.ts >"$WORK/app.log" 2>&1 & PIDS+=("$!")

for i in $(seq 1 60); do
  curl -fsS -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  [ "$i" = 60 ] && { tail -30 "$WORK/app.log"; die "app did not become healthy"; }
  sleep 2
done

# ── The tests ───────────────────────────────────────────────────────────────
mkdir -p "$REPORT_DIR"
say "Running the self-test"
SELFTEST_BASE_URL="http://127.0.0.1:$PORT" FAKE_VAPI_URL="http://127.0.0.1:$VAPI_PORT" \
SELFTEST_DB_URL="$DATABASE_URL" SELFTEST_WEBHOOK_SECRET="$WEBHOOK_SECRET" SELFTEST_EGRESS_LOG="$EGRESS_LOG" SELFTEST_REPORT_DIR="$REPORT_DIR" \
NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost" \
  npx --no-install playwright test -c "$HERE/playwright.config.ts" "$@"
STATUS=$?

cp "$WORK/app.log" "$REPORT_DIR/app.log" 2>/dev/null
say "Report: $REPORT_DIR/SELF-TEST-REPORT.md"
exit "$STATUS"
