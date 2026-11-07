#!/usr/bin/env bash
# scripts/verify-all.sh
#
# One command that runs every gate a CollectRx change must pass, the same way on
# a Mac, a Linux box, a cloud sandbox or CI. It installs what it needs, starts its
# OWN throwaway PostgreSQL 16, and prints a gate table. It never touches an
# existing database.
#
# Usage:
#   bash scripts/verify-all.sh                 default gates (what a PR needs)
#   bash scripts/verify-all.sh --full          adds npm audit and the production build
#   bash scripts/verify-all.sh --static        static gates only (git + grep, no install, no DB)
#   bash scripts/verify-all.sh --only a,b      run only the listed gate ids
#   bash scripts/verify-all.sh --skip a,b      run everything except the listed gate ids
#   bash scripts/verify-all.sh --base <ref>    compare against <ref> (default origin/main, then main, then origin/dev)
#   bash scripts/verify-all.sh --no-install    never run npm ci (missing deps become UNVERIFIED)
#   bash scripts/verify-all.sh --allow-unverified   exit 0 even if a gate was UNVERIFIED
#
# Gate ids: env scope anyscan todo secrets chars schemadoc deps pg validate generate
#           migrate rls api typecheck lint test audit build
#
# Statuses:
#   PASS        ran and passed
#   FAIL        ran and failed (exit 1)
#   UNVERIFIED  could not run (missing tool, no network, no database). Exit 2.
#               "Could not check" is never reported as a pass.
#   SKIP        not part of the selected mode, or CI-only by design (Semgrep, e2e, perf-smoke)
#
# Environment:
#   VERIFY_BASE             same as --base
#   VERIFY_CACHE            where embedded Postgres is cached (default ~/.cache/collectrx-verify)
#   VERIFY_TEST_ARGS        extra vitest args, for example "--shard=1/3". Any value makes the test gate UNVERIFIED (partial).
#   VERIFY_USE_EXISTING_DB  set to 1 to use the DATABASE_URL you already have. Only honoured when CI=true
#                           or the database name contains "verify" or "test". Otherwise ignored on purpose.
#
# Escape hatch for a documented false positive on one line: add the text
# "verify-all: allow" to that line.

set -u

MODE_FULL=0
MODE_STATIC=0
ONLY=""
SKIPS=""
BASE_REF="${VERIFY_BASE:-}"
NO_INSTALL=0
ALLOW_UNVERIFIED=0

while [ $# -gt 0 ]; do
  case "$1" in
    --full) MODE_FULL=1 ;;
    --static) MODE_STATIC=1 ;;
    --only) shift; ONLY="${1:-}" ;;
    --skip) shift; SKIPS="${1:-}" ;;
    --base) shift; BASE_REF="${1:-}" ;;
    --no-install) NO_INSTALL=1 ;;
    --allow-unverified) ALLOW_UNVERIFIED=1 ;;
    -h|--help) sed -n '2,38p' "$0"; exit 0 ;;
    *) echo "verify-all: unknown argument: $1" >&2; exit 64 ;;
  esac
  shift
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "verify-all: not inside a git repository" >&2; exit 64; }
cd "$REPO_ROOT" || exit 64

WS="dental-ar-system"
APP_DIR="Collect-RX-main"

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/crx-verify.XXXXXX")"
LOGDIR="$TMP_ROOT/logs"
mkdir -p "$LOGDIR"
RESULTS="$TMP_ROOT/results.tsv"
: > "$RESULTS"

# Throwaway local test credentials, kept out of URL-shaped literals so secret scanners stay quiet.
PG_CRED="prisma:prisma"
PG_KIND=""          # local | docker | embedded | existing
PG_DATA=""
PG_BIN=""
PG_PORT=""
PG_CONTAINER=""
SOCK_DIR=""
DEPS_OK=0
DB_OK=0
MIGRATED=0
BASE_SHA=""

if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YEL=""; C_DIM=""; C_OFF=""
fi

cleanup() {
  if [ "$PG_KIND" = "docker" ] && [ -n "$PG_CONTAINER" ]; then
    docker rm -f "$PG_CONTAINER" >/dev/null 2>&1
  elif [ -n "$PG_DATA" ] && [ -n "$PG_BIN" ]; then
    "$PG_BIN/pg_ctl" -D "$PG_DATA" -m immediate stop >/dev/null 2>&1
  fi
  [ -n "$SOCK_DIR" ] && rm -rf "$SOCK_DIR"
  if [ "${VERIFY_KEEP_TMP:-0}" != "1" ]; then
    rm -rf "$TMP_ROOT"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# ---------------------------------------------------------------- helpers

list_has() { # list(comma) item
  case ",$1," in *",$2,"*) return 0 ;; esac
  return 1
}

STATIC_IDS="env,scope,anyscan,todo,secrets,chars,schemadoc"
FULL_ONLY_IDS="audit,build"

want() { # gate id
  id="$1"
  if [ -n "$ONLY" ]; then
    list_has "$ONLY" "$id" || return 1
    return 0
  fi
  if [ "$MODE_STATIC" = "1" ]; then
    list_has "$STATIC_IDS" "$id" || return 1
  fi
  if [ "$MODE_FULL" != "1" ] && list_has "$FULL_ONLY_IDS" "$id"; then
    return 1
  fi
  if [ -n "$SKIPS" ] && list_has "$SKIPS" "$id"; then
    return 1
  fi
  return 0
}

GATE_DETAIL=""

record() { # id label status detail secs
  [ -n "$4" ] || set -- "$1" "$2" "$3" "-" "$5"
  printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" >> "$RESULTS"
}

# Gate functions return: 0 pass, 1 fail, 2 unverified, 3 skip. They set GATE_DETAIL
# and print diagnostics to stdout (captured into the gate log).
run_gate() { # id label function
  id="$1"; label="$2"; fn="$3"
  want "$id" || return 0
  printf '%s>> %s%s\n' "$C_DIM" "$label" "$C_OFF"
  start=$SECONDS
  GATE_DETAIL=""
  "$fn" >"$LOGDIR/$id.log" 2>&1
  rc=$?
  secs=$((SECONDS - start))
  case "$rc" in
    0) st="PASS" ;;
    1) st="FAIL" ;;
    2) st="UNVERIFIED" ;;
    3) st="SKIP" ;;
    *) st="FAIL"; GATE_DETAIL="unexpected exit code $rc" ;;
  esac
  record "$id" "$label" "$st" "$GATE_DETAIL" "$secs"
  if [ "$st" = "FAIL" ] || [ "$st" = "UNVERIFIED" ]; then
    echo "---- $label: $st: $GATE_DETAIL (log: $LOGDIR/$id.log)"
    tail -n 40 "$LOGDIR/$id.log" | sed 's/^/    /'
  fi
}

# ---------------------------------------------------------------- base and diff plumbing

resolve_base() {
  for ref in "$BASE_REF" origin/main main origin/dev; do
    [ -z "$ref" ] && continue
    if git rev-parse --verify -q "$ref^{commit}" >/dev/null 2>&1; then
      mb="$(git merge-base HEAD "$ref" 2>/dev/null)" || mb=""
      if [ -n "$mb" ]; then BASE_SHA="$mb"; BASE_NAME="$ref"; return 0; fi
    fi
  done
  return 1
}
BASE_NAME=""
resolve_base || true

# awk: turn a unified diff or git log -p stream into "path<TAB>added line"
DIFF_TO_TSV='
/^\+\+\+ b\// { p = substr($0, 7); next }
/^\+\+\+ \/dev\/null/ { p = ""; next }
/^\+/ { if (p != "") print p "\t" substr($0, 2) }
'

added_working() { # committed + staged + unstaged + untracked, versus base
  [ -n "$BASE_SHA" ] || return 1
  git diff -U0 --no-color --no-ext-diff "$BASE_SHA" -- . 2>/dev/null | awk "$DIFF_TO_TSV"
  git ls-files --others --exclude-standard 2>/dev/null | while IFS= read -r f; do
    [ -f "$f" ] || continue
    git diff -U0 --no-color --no-index -- /dev/null "$f" 2>/dev/null | awk "$DIFF_TO_TSV"
  done
}

added_history() { # every line ever added by a commit between base and HEAD, even if later removed
  [ -n "$BASE_SHA" ] || return 1
  git log -p -U0 --no-color --no-ext-diff --format= "$BASE_SHA..HEAD" 2>/dev/null | awk "$DIFF_TO_TSV"
}

changed_paths() {
  [ -n "$BASE_SHA" ] || return 1
  { git diff --name-only "$BASE_SHA" -- . 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } | sort -u
}

truncate_line() { cut -c1-160; }

# ---------------------------------------------------------------- static gates

gate_env() {
  v="$(node -v 2>/dev/null)" || { GATE_DETAIL="node not found on PATH"; return 1; }
  major="${v#v}"; major="${major%%.*}"
  minor="${v#v*.}"; minor="${minor%%.*}"
  if [ "$major" -lt 20 ] || { [ "$major" -eq 20 ] && [ "$minor" -lt 10 ]; }; then
    GATE_DETAIL="node $v is below the repo engines floor (>=20.10.0)"
    return 1
  fi
  command -v git >/dev/null 2>&1 || { GATE_DETAIL="git not found"; return 1; }
  if [ -z "$BASE_SHA" ]; then
    hint="use --base <ref>"
    [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ] && hint="repository is shallow: run 'git fetch --unshallow origin' (or fetch the base branch), then retry"
    GATE_DETAIL="node $v; no base ref found, diff gates cannot compare ($hint)"
    return 2
  fi
  GATE_DETAIL="node $v; base ${BASE_NAME} @ $(printf '%s' "$BASE_SHA" | cut -c1-9)"
  return 0
}

gate_scope() {
  [ -n "$BASE_SHA" ] || { GATE_DETAIL="no base ref"; return 2; }
  bad="$(changed_paths | grep -E '(^|/)\.codex/|(^|/)GATES\.md$|[^/] [0-9]+(\.[A-Za-z0-9]+)?$' || true)"
  n="$(changed_paths | wc -l | tr -d ' ')"
  if [ -n "$bad" ]; then
    echo "Protected or duplicate paths touched:"; printf '%s\n' "$bad" | sed 's/^/  /'
    GATE_DETAIL="touches protected path (.codex, GATES.md, or a ' 2' duplicate)"
    return 1
  fi
  GATE_DETAIL="$n file(s) changed, none protected"
  return 0
}

gate_anyscan() {
  [ -n "$BASE_SHA" ] || { GATE_DETAIL="no base ref"; return 2; }
  tmp="$TMP_ROOT/any.tsv"
  added_working | grep -E $'^[^\t]+\\.(ts|tsx)\t' | grep -vE $'\t.*verify-all: allow' > "$tmp" || true
  : > "$TMP_ROOT/any.hits"
  # Types: `: any`, `as any`, `<any>`, `= any`, `any[]`, Record<..., any>, `| any`
  grep -E $'\t.*(([:=|]|[^A-Za-z0-9_]as|<)[[:space:]]*any([^A-Za-z0-9_]|$)|[^A-Za-z0-9_]any\\[\\]|Record<[^>]*,[[:space:]]*any>)' "$tmp" \
    | grep -vE $'\t[[:space:]]*(//|\\*|/\\*)' >> "$TMP_ROOT/any.hits" || true
  # Suppression comments: always a failure for ts-ignore / ts-nocheck, and for eslint-disable of the any rule or a bare disable
  grep -E $'\t.*(@ts-ignore|@ts-nocheck)' "$tmp" >> "$TMP_ROOT/any.hits" || true
  grep -E $'\t.*eslint-disable.*no-explicit-any' "$tmp" >> "$TMP_ROOT/any.hits" || true
  grep -E $'\t.*eslint-disable(-next-line|-line)?[[:space:]]*(\\*/)?[[:space:]]*$' "$tmp" >> "$TMP_ROOT/any.hits" || true
  if [ -s "$TMP_ROOT/any.hits" ]; then
    echo "Added lines that use 'any' or suppress the type system (PRD rule: zero any, no workarounds):"
    sort -u "$TMP_ROOT/any.hits" | truncate_line | sed 's/^/  /'
    GATE_DETAIL="$(sort -u "$TMP_ROOT/any.hits" | wc -l | tr -d ' ') offending added line(s)"
    return 1
  fi
  GATE_DETAIL="no new any, ts-ignore or any-suppressions"
  return 0
}

gate_todo() {
  [ -n "$BASE_SHA" ] || { GATE_DETAIL="no base ref"; return 2; }
  tmp="$TMP_ROOT/todo.tsv"
  # PRD rule: no TODO or FIXME in prd-bound code. Tests, docs and these gate scripts are exempt.
  added_working \
    | grep -E $'^[^\t]+\\.(ts|tsx|js|mjs|cjs|sql|prisma|sh)\t' \
    | grep -vE $'^[^\t]*(\\.(test|spec)\\.[A-Za-z]+|(^|/)tests?/|(^|/)scripts/(verify-all|check-gate-parity|check-pr-body)[A-Za-z.-]*\\.sh)\t' \
    | grep -vE $'\t.*verify-all: allow' > "$tmp" || true
  grep -E $'\t.*\\b(TODO|FIXME)\\b' "$tmp" > "$TMP_ROOT/todo.hits" || true
  if [ -s "$TMP_ROOT/todo.hits" ]; then
    echo "Added lines with TODO or FIXME (resolve it or track it in a GitHub issue):"
    truncate_line < "$TMP_ROOT/todo.hits" | sed 's/^/  /'
    GATE_DETAIL="$(wc -l < "$TMP_ROOT/todo.hits" | tr -d ' ') added TODO or FIXME line(s)"
    return 1
  fi
  GATE_DETAIL="no TODO or FIXME added in non-test code"
  return 0
}

SECRET_PATH_EXCLUDE=$'^(scripts/verify-all(\\.selftest)?\\.sh|package-lock\\.json|[^\t]*/package-lock\\.json)\t'

secret_rules() {
  # id|extended regex. Matched text is never printed, only the file and rule id.
  cat <<'RULES'
credential-url|[A-Za-z][A-Za-z0-9+.-]*://[^/[:space:]:@"'`]+:[^/[:space:]@"'`]+@[^[:space:]"'`]+
aws-access-key|(AKIA|ASIA)[0-9A-Z]{16}
private-key|-----BEGIN [A-Z ]*PRIVATE KEY-----
github-token|(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})
slack-token|xox[baprs]-[A-Za-z0-9-]{10,}
stripe-live-key|(sk|rk)_live_[A-Za-z0-9]{16,}
anthropic-key|sk-ant-[A-Za-z0-9_-]{20,}
google-api-key|AIza[0-9A-Za-z_-]{35}
jwt|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}
RULES
}

scan_stream_for_secrets() { # reads TSV on stdin, prints "path<TAB>rule"
  in="$TMP_ROOT/sec.in"
  grep -vE "$SECRET_PATH_EXCLUDE" | grep -vE $'\t.*verify-all: allow' > "$in" || true
  secret_rules | while IFS='|' read -r rid rre; do
    [ -n "$rid" ] || continue
    if [ "$rid" = "credential-url" ]; then
      grep -E "$rre" "$in" \
        | grep -vE '@(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host|hostname|HOST|example\.(com|org|net)|db|postgres|redis)([:/?[:space:]"'"'"'`]|$)' \
        | grep -vE '://[^@]*(\$\{|\$[A-Za-z_{]|<[^>]+>|\{\{|%s)[^@]*@' \
        | cut -f1 | sort -u | awk -v r="$rid" '{ print $0 "\t" r }'
    else
      grep -E "$rre" "$in" | cut -f1 | sort -u | awk -v r="$rid" '{ print $0 "\t" r }'
    fi
  done
}

gate_secrets() {
  [ -n "$BASE_SHA" ] || { GATE_DETAIL="no base ref, cannot scan history"; return 2; }
  hits="$TMP_ROOT/sec.hits"
  { added_history | scan_stream_for_secrets; added_working | scan_stream_for_secrets; } | sort -u > "$hits"
  # Committed env files (anything named .env or .env.* except examples)
  envf="$(changed_paths | grep -E '(^|/)\.env(\.[^/]*)?$' | grep -vE '\.(example|sample|template)$' || true)"
  if [ -n "$envf" ]; then
    printf '%s\n' "$envf" | while IFS= read -r f; do printf '%s\tenv-file\n' "$f"; done >> "$hits"
  fi
  if [ -s "$hits" ]; then
    echo "Possible secrets in the diff or in any commit since the base (history counts: a later commit cannot undo it):"
    sed 's/^/  /' "$hits"
    echo "If a hit is a deliberate placeholder, rewrite it (for example use localhost as the host) or add 'verify-all: allow' on that line."
    GATE_DETAIL="$(wc -l < "$hits" | tr -d ' ') finding(s), values not printed"
    return 1
  fi
  if command -v gitleaks >/dev/null 2>&1; then
    if gitleaks detect --no-banner --log-opts "$BASE_SHA..HEAD" >/dev/null 2>&1; then
      GATE_DETAIL="rules clean over diff and history; gitleaks clean"
    else
      GATE_DETAIL="gitleaks reported findings (run: gitleaks detect --log-opts \"$BASE_SHA..HEAD\")"
      return 1
    fi
  else
    GATE_DETAIL="rules clean over diff and history (gitleaks not installed; CI TruffleHog still authoritative)"
  fi
  return 0
}

gate_chars() {
  [ -n "$BASE_SHA" ] || { GATE_DETAIL="no base ref"; return 2; }
  tmp="$TMP_ROOT/chars.tsv"
  added_working | grep -E $'^[^\t]+\\.(ts|tsx|js|mjs|cjs|sql|prisma|sh)\t' > "$tmp" || true
  # NBSP (U+00A0), narrow NBSP (U+202F), zero width space (U+200B), BOM (U+FEFF). Byte match, locale independent.
  LC_ALL=C grep -E $'\xc2\xa0|\xe2\x80\xaf|\xe2\x80\x8b|\xef\xbb\xbf' "$tmp" | cut -f1 | sort -u > "$TMP_ROOT/chars.files" || true
  # Test files may need these characters on purpose (BOM and NBSP handling), so they are a note.
  # Anything else fails: write an escape such as an escaped form instead of the raw character.
  grep -vE '\.(test|spec)\.[A-Za-z]+$|(^|/)tests?/' "$TMP_ROOT/chars.files" > "$TMP_ROOT/chars.bad" || true
  notes="$(grep -cE '\.(test|spec)\.[A-Za-z]+$|(^|/)tests?/' "$TMP_ROOT/chars.files")"
  if [ -s "$TMP_ROOT/chars.bad" ]; then
    echo "Invisible or non-breaking space characters in added non-test code (use an escape like \\u00A0):"
    sed 's/^/  /' "$TMP_ROOT/chars.bad"
    GATE_DETAIL="irregular whitespace in $(wc -l < "$TMP_ROOT/chars.bad" | tr -d ' ') non-test file(s)"
    return 1
  fi
  GATE_DETAIL="no irregular whitespace in added non-test code"
  [ "$notes" -gt 0 ] && GATE_DETAIL="$GATE_DETAIL (note: raw invisible character in $notes test file(s), prefer an escape)"
  return 0
}

gate_schemadoc() {
  [ -n "$BASE_SHA" ] || { GATE_DETAIL="no base ref"; return 2; }
  # scripts/check-rls-coverage.mjs parses models with a brace-matching regex, so a brace inside a
  # comment ends the model body early. Fail on braces ADDED by this change; report older ones as notes.
  added_working | grep -E $'^[^\t]+schema\\.prisma\t[[:space:]]*//.*[{}]' > "$TMP_ROOT/schemadoc.hits" || true
  old=0
  for f in $(git ls-files '*schema.prisma' 2>/dev/null); do
    [ -f "$f" ] || continue
    c="$(grep -cE '^[[:space:]]*//.*[{}]' "$f")"
    old=$((old + c))
  done
  if [ -s "$TMP_ROOT/schemadoc.hits" ]; then
    echo "Braces inside a schema comment added by this change (they truncate the model for the RLS coverage parser):"
    truncate_line < "$TMP_ROOT/schemadoc.hits" | sed 's/^/  /'
    GATE_DETAIL="$(wc -l < "$TMP_ROOT/schemadoc.hits" | tr -d ' ') added schema comment line(s) contain braces"
    return 1
  fi
  GATE_DETAIL="no braces added to schema comments"
  [ "$old" -gt 0 ] && GATE_DETAIL="$GATE_DETAIL (note: $old existing comment line(s) with braces, not from this change)"
  return 0
}

# ---------------------------------------------------------------- dependency and database gates

gate_deps() {
  lock="package-lock.json"
  stamp="node_modules/.package-lock.json"
  if [ -d node_modules ] && [ -f "$stamp" ] && [ ! "$lock" -nt "$stamp" ]; then
    DEPS_OK=1; GATE_DETAIL="node_modules up to date"; return 0
  fi
  if [ "$NO_INSTALL" = "1" ]; then
    GATE_DETAIL="dependencies missing or stale and --no-install was given"
    return 2
  fi
  echo "Running npm ci"
  if npm ci --no-audit --no-fund; then
    DEPS_OK=1; GATE_DETAIL="npm ci completed"; return 0
  fi
  if grep -qiE 'ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|network' "$LOGDIR/deps.log" 2>/dev/null; then
    GATE_DETAIL="npm ci could not reach the registry"
    return 2
  fi
  GATE_DETAIL="npm ci failed"
  return 1
}

free_port() {
  node -e 'var s=require("net").createServer();s.listen(0,"127.0.0.1",function(){console.log(s.address().port);s.close()})'
}

pg_major_ok() { # bin dir
  v="$("$1/pg_ctl" --version 2>/dev/null)" || return 1
  case "$v" in *" 16."*) return 0 ;; esac
  return 1
}

find_local_pg() {
  for d in "$(dirname "$(command -v pg_ctl 2>/dev/null)" 2>/dev/null)" \
           /usr/lib/postgresql/16/bin \
           /opt/homebrew/opt/postgresql@16/bin \
           /usr/local/opt/postgresql@16/bin \
           /opt/homebrew/bin /usr/local/bin; do
    [ -n "$d" ] && [ -x "$d/pg_ctl" ] && [ -x "$d/initdb" ] && pg_major_ok "$d" && { PG_BIN="$d"; return 0; }
  done
  return 1
}

find_embedded_pg() {
  cache="${VERIFY_CACHE:-$HOME/.cache/collectrx-verify}"
  mkdir -p "$cache" 2>/dev/null || return 1
  for d in "$cache"/node_modules/@embedded-postgres/*/native/bin; do
    [ -x "$d/pg_ctl" ] && { PG_BIN="$d"; return 0; }
  done
  [ "$NO_INSTALL" = "1" ] && return 1
  echo "Installing embedded PostgreSQL 16 into $cache (one time)"
  npm install --prefix "$cache" --no-audit --no-fund --no-save embedded-postgres@16.14.0-beta.17 || return 1
  for d in "$cache"/node_modules/@embedded-postgres/*/native/bin; do
    [ -x "$d/pg_ctl" ] && { PG_BIN="$d"; return 0; }
  done
  return 1
}

start_native_pg() { # uses PG_BIN
  PG_DATA="$TMP_ROOT/pgdata"
  SOCK_DIR="$(mktemp -d /tmp/crxs.XXXXXX)"
  PG_PORT="$(free_port)" || return 1
  libdir="$(cd "$PG_BIN/.." && pwd)/lib"
  export LD_LIBRARY_PATH="$libdir:${LD_LIBRARY_PATH:-}"
  export DYLD_LIBRARY_PATH="$libdir:${DYLD_LIBRARY_PATH:-}"
  "$PG_BIN/initdb" -D "$PG_DATA" -U prisma -A trust -E UTF8 --no-locale >"$LOGDIR/initdb.log" 2>&1 || { tail -n 20 "$LOGDIR/initdb.log"; return 1; }
  "$PG_BIN/pg_ctl" -D "$PG_DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$SOCK_DIR" \
    -l "$LOGDIR/postgres.log" -w -t 60 start >/dev/null 2>&1 || { tail -n 30 "$LOGDIR/postgres.log"; return 1; }
  return 0
}

create_db() { # port; via node pg from the repo, no psql needed
  node -e '
    const { createRequire } = require("module");
    const req = createRequire(process.cwd() + "/");
    const { Client } = req("pg");
    (async () => {
      const c = new Client({ connectionString: "postgresql://" + process.argv[2] + "@127.0.0.1:" + process.argv[1] + "/postgres" });
      await c.connect();
      const r = await c.query("select 1 from pg_database where datname = $1", ["prisma"]);
      if (!r.rowCount) await c.query("create database prisma");
      await c.query("alter role prisma bypassrls");
      const v = await c.query("show server_version");
      console.log("postgres " + v.rows[0].server_version);
      await c.end();
    })().catch((e) => { console.error(e.message); process.exit(1); });
  ' "$1" "$PG_CRED"
}

db_url() { printf 'postgresql://%s@127.0.0.1:%s/prisma?schema=public&connection_limit=30&pool_timeout=20' "$PG_CRED" "$1"; }

gate_pg() {
  if [ "$DEPS_OK" != "1" ]; then GATE_DETAIL="dependencies not installed"; return 2; fi

  if [ "${VERIFY_USE_EXISTING_DB:-0}" = "1" ] && [ -n "${DATABASE_URL:-}" ]; then
    dbname="${DATABASE_URL##*/}"; dbname="${dbname%%\?*}"
    case "$dbname" in *verify*|*test*) ok=1 ;; *) ok=0 ;; esac
    [ "${CI:-}" = "true" ] && ok=1
    if [ "$ok" = "1" ]; then
      PG_KIND="existing"; DB_OK=1; GATE_DETAIL="using existing database '$dbname' (VERIFY_USE_EXISTING_DB)"
      return 0
    fi
    echo "VERIFY_USE_EXISTING_DB ignored: database '$dbname' is not named for verification and CI is not true."
  fi

  if find_local_pg; then
    PG_KIND="local"
    if start_native_pg; then
      export DATABASE_URL; DATABASE_URL="$(db_url "$PG_PORT")"
      create_db "$PG_PORT" || { GATE_DETAIL="local postgres started but database setup failed"; return 1; }
      DB_OK=1; GATE_DETAIL="local PostgreSQL 16 on 127.0.0.1:$PG_PORT (throwaway)"; return 0
    fi
    PG_BIN=""; PG_DATA=""
  fi

  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    PG_PORT="$(free_port)"
    PG_CONTAINER="crx-verify-$$"
    if docker run -d --rm --name "$PG_CONTAINER" -e POSTGRES_USER=prisma -e POSTGRES_PASSWORD=prisma -e POSTGRES_DB=prisma \
         -p "127.0.0.1:$PG_PORT:5432" postgres:16-alpine >/dev/null 2>&1; then
      PG_KIND="docker"
      i=0
      while [ $i -lt 40 ]; do
        docker exec "$PG_CONTAINER" pg_isready -U prisma -d prisma >/dev/null 2>&1 && break
        i=$((i + 1)); sleep 1
      done
      export DATABASE_URL; DATABASE_URL="$(db_url "$PG_PORT")"
      create_db "$PG_PORT" || { GATE_DETAIL="docker postgres up but database setup failed"; return 1; }
      DB_OK=1; GATE_DETAIL="docker postgres:16-alpine on 127.0.0.1:$PG_PORT (throwaway)"; return 0
    fi
    PG_CONTAINER=""
  fi

  if find_embedded_pg; then
    PG_KIND="embedded"
    if start_native_pg; then
      export DATABASE_URL; DATABASE_URL="$(db_url "$PG_PORT")"
      create_db "$PG_PORT" || { GATE_DETAIL="embedded postgres started but database setup failed"; return 1; }
      DB_OK=1; GATE_DETAIL="embedded PostgreSQL 16 on 127.0.0.1:$PG_PORT (throwaway)"; return 0
    fi
    GATE_DETAIL="embedded postgres failed to start (see $LOGDIR/postgres.log)"
    return 1
  fi

  GATE_DETAIL="no PostgreSQL 16 available: no local pg16, no running docker, and embedded install failed or offline"
  return 2
}

need_deps() { [ "$DEPS_OK" = "1" ] || { GATE_DETAIL="dependencies not installed"; return 1; }; return 0; }
need_db() { [ "$DB_OK" = "1" ] || { GATE_DETAIL="no database (pg gate did not pass)"; return 1; }; return 0; }

export_env() {
  export JWT_SECRET="${JWT_SECRET:-github-actions-ci-placeholder-not-for-production}"
  export VAPI_WEBHOOK_SECRET="${VAPI_WEBHOOK_SECRET:-github-actions-ci-placeholder}"
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}"
  if [ "$DB_OK" != "1" ]; then
    # Prisma commands that only parse the schema still need the variable to exist.
    export DATABASE_URL="${DATABASE_URL:-postgresql://${PG_CRED}@127.0.0.1:1/prisma?schema=public}"
  fi
}

gate_validate() {
  need_deps || return 2
  export_env
  npm exec -w "$WS" -- prisma validate || { GATE_DETAIL="prisma validate failed"; return 1; }
  GATE_DETAIL="schema valid"; return 0
}

gate_generate() {
  need_deps || return 2
  export_env
  npm run db:generate:collectrx || { GATE_DETAIL="prisma generate failed"; return 1; }
  GATE_DETAIL="client generated"; return 0
}

gate_migrate() {
  need_deps || return 2
  need_db || return 2
  export_env
  npm run db:migrate:collectrx || { GATE_DETAIL="prisma migrate deploy failed"; return 1; }
  n="$(ls -d "$APP_DIR"/prisma/migrations/[0-9]* 2>/dev/null | wc -l | tr -d ' ')"
  MIGRATED=1
  GATE_DETAIL="$n migration(s) applied to an empty database"; return 0
}

gate_rls() {
  need_deps || return 2
  need_db || return 2
  [ "$MIGRATED" = "1" ] || { GATE_DETAIL="migrations not applied (migrate gate did not run or did not pass)"; return 2; }
  export_env
  npm run check:rls -w "$WS" || { GATE_DETAIL="RLS coverage check failed"; return 1; }
  GATE_DETAIL="$(grep -E 'tenant table' "$LOGDIR/rls.log" | tail -n 1 | cut -c1-120)"; return 0
}

gate_api() {
  need_deps || return 2
  export_env
  npm run check:api || { GATE_DETAIL="API coverage check failed"; return 1; }
  GATE_DETAIL="API coverage ok"; return 0
}

gate_typecheck() {
  need_deps || return 2
  export_env
  npm run typecheck:collectrx || { GATE_DETAIL="tsc reported errors"; return 1; }
  GATE_DETAIL="tsc clean"; return 0
}

gate_lint() {
  need_deps || return 2
  export_env
  npm run lint:collectrx || { GATE_DETAIL="eslint reported errors"; return 1; }
  GATE_DETAIL="$(grep -E '^✖|problems' "$LOGDIR/lint.log" | tail -n 1 | cut -c1-120)"
  [ -n "$GATE_DETAIL" ] || GATE_DETAIL="eslint clean"
  return 0
}

gate_test() {
  need_deps || return 2
  need_db || return 2
  export_env
  # shellcheck disable=SC2086
  CI=true npm run test:collectrx -- ${VERIFY_TEST_ARGS:-} || { GATE_DETAIL="vitest reported failures"; return 1; }
  line="$(sed $'s/\033\\[[0-9;]*m//g' "$LOGDIR/test.log" | grep -E 'Tests +[0-9]+ passed' | tail -n 1 | cut -c1-120)"
  if [ -n "${VERIFY_TEST_ARGS:-}" ]; then
    GATE_DETAIL="PARTIAL run (VERIFY_TEST_ARGS='${VERIFY_TEST_ARGS}'): $line"
    return 2
  fi
  GATE_DETAIL="$line"; return 0
}

# Pull requests gate on critical advisories only: a newly published high advisory against an
# unchanged lockfile must not block unrelated work overnight. .github/workflows/dependency-audit.yml
# runs the stricter high threshold every week. Keep this level equal to the one in collectrx-ci.yml
# (scripts/check-gate-parity.sh enforces that).
gate_audit() {
  need_deps || return 2
  if npm audit --omit=dev --audit-level=critical; then
    GATE_DETAIL="no critical production advisories"; return 0
  fi
  if grep -qiE 'ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|audit endpoint' "$LOGDIR/audit.log" 2>/dev/null; then
    GATE_DETAIL="npm audit could not reach the registry"; return 2
  fi
  GATE_DETAIL="critical advisories found"; return 1
}

gate_build() {
  need_deps || return 2
  export_env
  NODE_ENV=production npm run build -w "$WS" || { GATE_DETAIL="production build failed"; return 1; }
  GATE_DETAIL="db:generate, tsc, check:api and vite build passed"; return 0
}

# ---------------------------------------------------------------- run

echo "verify-all: repo $REPO_ROOT"
[ "$MODE_STATIC" = "1" ] && echo "mode: static" || { [ "$MODE_FULL" = "1" ] && echo "mode: full" || echo "mode: default"; }

run_gate env       "Environment and base ref"        gate_env
run_gate scope     "Scope (protected paths)"         gate_scope
run_gate anyscan   "No new any or suppressions"      gate_anyscan
run_gate todo      "No new TODO or FIXME"            gate_todo
run_gate secrets   "Secrets in diff and history"     gate_secrets
run_gate chars     "No irregular whitespace chars"   gate_chars
run_gate schemadoc "Schema comments have no braces"  gate_schemadoc
run_gate deps      "Dependencies installed"          gate_deps
run_gate pg        "Throwaway PostgreSQL 16"         gate_pg
run_gate validate  "Prisma validate"                 gate_validate
run_gate generate  "Prisma generate"                 gate_generate
run_gate migrate   "Migrations on empty database"    gate_migrate
run_gate rls       "RLS coverage"                    gate_rls
run_gate api       "API coverage"                    gate_api
run_gate typecheck "Typecheck"                       gate_typecheck
run_gate lint      "Lint"                            gate_lint
run_gate test      "Tests"                           gate_test
run_gate audit     "npm audit (prod, critical)"      gate_audit
run_gate build     "Production build"                gate_build

# ---------------------------------------------------------------- report

echo
echo "================================ verify-all report ================================"
fails=0; unver=0; passes=0
while IFS="$(printf '\t')" read -r id label st detail secs; do
  case "$st" in
    PASS) col="$C_GRN"; passes=$((passes + 1)) ;;
    FAIL) col="$C_RED"; fails=$((fails + 1)) ;;
    UNVERIFIED) col="$C_YEL"; unver=$((unver + 1)) ;;
    *) col="$C_DIM" ;;
  esac
  printf '%-11s %s%-10s%s %4ss  %s\n' "$id" "$col" "$st" "$C_OFF" "$secs" "$detail"
done < "$RESULTS"
echo "-----------------------------------------------------------------------------------"
echo "CI-only by design (not run here): Semgrep SAST, Playwright e2e, perf-smoke, TruffleHog, queue-redis."
echo "Logs: $LOGDIR (kept only with VERIFY_KEEP_TMP=1)"

if [ "$fails" -gt 0 ]; then
  echo "VERIFY-ALL: FAIL ($fails failed, $unver unverified, $passes passed)"
  exit 1
fi
if [ "$unver" -gt 0 ] && [ "$ALLOW_UNVERIFIED" != "1" ]; then
  echo "VERIFY-ALL: UNVERIFIED ($unver gate(s) could not run; this is not a pass)"
  exit 2
fi
echo "VERIFY-ALL: PASS ($passes passed)"
exit 0
