#!/bin/bash
# Validates prisma/schema.prisma and every prisma/migrations/*/migration.sql
# WITHOUT needing Prisma's own generate/migrate binaries.
#
# Why this exists: `prisma generate` and `prisma migrate deploy` both fetch
# native engine binaries from binaries.prisma.sh at run time. In network-
# restricted environments (sandboxed CI agents, locked-down corporate
# networks) that host is unreachable and both commands fail with a 403
# before doing any real work — so schema/migration mistakes go unverified
# until a full GitHub Actions run catches them. (This happened for real:
# PR #101 needed three follow-up pushes to fix a missing brace in
# schema.prisma and a wrong Postgres type name in a migration file, each
# only caught by CI 60-90s after push.)
#
# This script sidesteps the blocked host entirely rather than routing
# around it: it uses a plain local Postgres server (already available via
# `apt install postgresql`, or Docker) and applies the raw migration.sql
# files with `psql`, the same thing `prisma migrate deploy` does under the
# hood, minus Prisma's own bookkeeping. That's enough to catch schema
# syntax errors, bad type references, and migration ordering bugs in
# seconds, fully offline. It does NOT replace `prisma generate` for
# TypeScript-level Prisma Client type checking — that step still needs a
# reachable binaries.prisma.sh (or CI, which has one) as the final gate.
#
# Usage: ./scripts/verify-migrations-offline.sh
# Requires: psql on PATH and a reachable Postgres server (local install or
# `docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine`).
# Override connection details with PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
# env vars (defaults below assume a local superuser-trusted install).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCHEMA="$ROOT/prisma/schema.prisma"
MIGRATIONS_DIR="$ROOT/prisma/migrations"
SCRATCH_DB="${SCRATCH_DB:-collectrx_migration_check}"

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
export PGHOST PGPORT PGUSER
[ -n "${PGPASSWORD:-}" ] && export PGPASSWORD

echo "== 1/2: schema.prisma brace balance =="
python3 - "$SCHEMA" <<'PY'
import sys
content = open(sys.argv[1]).read()
depth = 0
for i, ch in enumerate(content):
    if ch == '{':
        depth += 1
    elif ch == '}':
        depth -= 1
        if depth < 0:
            line = content.count('\n', 0, i) + 1
            sys.exit(f"Unbalanced '}}' at line {line} — schema.prisma will fail to parse.")
if depth != 0:
    sys.exit(f"schema.prisma has {depth} unclosed block(s) — a model or enum is missing its closing brace.")
print("  balanced.")
PY

echo "== 2/2: replaying prisma/migrations/*/migration.sql against a scratch Postgres db =="

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found on PATH — install postgresql-client, or run this from an environment that has it." >&2
  exit 1
fi
if ! pg_isready -q 2>/dev/null; then
  echo "No reachable Postgres server. Start one, e.g.:" >&2
  echo "  sudo service postgresql start          # local apt install" >&2
  echo "  docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine" >&2
  exit 1
fi

psql -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $SCRATCH_DB;" >/dev/null
psql -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $SCRATCH_DB;" >/dev/null
cleanup() { psql -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH_DB;" >/dev/null 2>&1 || true; }
trap cleanup EXIT

applied=0
for dir in "$MIGRATIONS_DIR"/*/; do
  file="$dir/migration.sql"
  [ -f "$file" ] || continue
  name="$(basename "$dir")"
  if ! psql -d "$SCRATCH_DB" -v ON_ERROR_STOP=1 -f "$file" >/tmp/verify-migrations-offline.log 2>&1; then
    echo "FAILED applying migration: $name" >&2
    tail -n 20 /tmp/verify-migrations-offline.log >&2
    exit 1
  fi
  applied=$((applied + 1))
done

echo "  applied $applied migrations cleanly."
echo "All checks passed."
