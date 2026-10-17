#!/usr/bin/env bash
# scripts/verify-all.selftest.sh
#
# Proves verify-all.sh actually fails when it should. Each case builds a throwaway
# git repo, plants one specific violation on a feature branch, runs the static gates,
# and asserts the exit code and the gate that caught it. A gate runner that has never
# been seen failing is not evidence of anything.
#
#   bash scripts/verify-all.selftest.sh            static cases (no install, no database)
#   bash scripts/verify-all.selftest.sh --db       also plants a broken migration in THIS repo
#                                                  checkout and expects the migrate gate to fail
#                                                  (needs node_modules; starts its own throwaway Postgres)

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SUT="$HERE/verify-all.sh"
RUN_DB=0
[ "${1:-}" = "--db" ] && RUN_DB=1

WORK="$(mktemp -d "${TMPDIR:-/tmp}/crx-selftest.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

PASSED=0
FAILED=0

# Fixtures are assembled at run time so this file never contains a literal credential,
# which keeps secret scanners (TruffleHog in CI) from flagging the self-test itself.
FAKE_KEY="AKIA""ABCDEFGHIJKLMNOP"

new_repo() { # name
  d="$WORK/$1"
  mkdir -p "$d/scripts" "$d/Collect-RX-main/prisma" "$d/src"
  cp "$SUT" "$d/scripts/verify-all.sh"
  (
    cd "$d" || exit 1
    git init -q -b main
    git config user.email selftest@example.com
    git config user.name selftest
    git config commit.gpgsign false
    printf 'export const ok = 1;\n' > src/ok.ts
    printf 'model A {\n  id String @id\n}\n' > Collect-RX-main/prisma/schema.prisma
    git add -A && git commit -q -m base
    git checkout -q -b feature/test
  )
  echo "$d"
}

commit_all() { (cd "$1" && git add -A && git commit -q -m "$2"); }

run_static() { # repo
  (cd "$1" && bash scripts/verify-all.sh --static --base main 2>&1)
}

expect() { # case-name repo expected-exit expected-gate-id expected-status
  name="$1"; repo="$2"; want_rc="$3"; gate="$4"; want_status="$5"
  out="$(run_static "$repo")"; rc=$?
  line="$(printf '%s\n' "$out" | grep -E "^$gate +" | head -n 1)"
  if [ "$rc" = "$want_rc" ] && printf '%s' "$line" | grep -q "$want_status"; then
    PASSED=$((PASSED + 1)); printf 'ok    %s\n' "$name"
  else
    FAILED=$((FAILED + 1)); printf 'FAIL  %s (exit %s, wanted %s; gate line: %s)\n' "$name" "$rc" "$want_rc" "$line"
    printf '%s\n' "$out" | sed 's/^/      /' | tail -n 25
  fi
}

# 1. Clean change passes everything static.
r="$(new_repo clean)"
printf 'export const two = 2;\n' > "$r/src/two.ts"
commit_all "$r" clean
expect "clean change passes" "$r" 0 secrets PASS

# 2. A planted `any`.
r="$(new_repo any)"
printf 'export const x: any = 1;\n' > "$r/src/bad.ts"
commit_all "$r" any
expect "planted any is caught" "$r" 1 anyscan FAIL

# 2b. The alias workaround that broke us before.
r="$(new_repo anyalias)"
printf 'type Loose = any;\nexport const y: Loose = 1;\n' > "$r/src/bad.ts"
commit_all "$r" alias
expect "type alias to any is caught" "$r" 1 anyscan FAIL

# 2c. Suppression comments.
r="$(new_repo suppress)"
printf '// @ts-ignore\nexport const z: number = "a";\n' > "$r/src/bad.ts"
commit_all "$r" ignore
expect "ts-ignore is caught" "$r" 1 anyscan FAIL

# 2d. The word any in prose and a comment must not trip the gate.
r="$(new_repo prose)"
printf '// returns true if any item matches, as any other helper would\nexport const anyThing = 1;\n' > "$r/src/ok2.ts"
commit_all "$r" prose
expect "prose containing the word any is not a false positive" "$r" 0 anyscan PASS

# 3. A planted credentialed URL on a remote host (the TruffleHog failure).
r="$(new_repo cred)"
printf 'export const u = "postgresql://u:p%sx.abc.us-east-1.rds.amazonaws.com:5432/db";\n' "@" > "$r/src/bad.ts"
commit_all "$r" cred
expect "credentialed remote URL is caught" "$r" 1 secrets FAIL

# 3b. Same URL on localhost is a fixture, not a secret.
r="$(new_repo credlocal)"
printf 'export const u = "postgresql://prisma:prisma%s127.0.0.1:5432/prisma";\n' "@" > "$r/src/ok2.ts"
commit_all "$r" local
expect "localhost credential URL is allowed" "$r" 0 secrets PASS

# 3c. A secret added in one commit and removed in the next must still fail (history).
r="$(new_repo history)"
printf 'export const k = "%s";\n' "$FAKE_KEY" > "$r/src/bad.ts"
commit_all "$r" add-secret
printf 'export const k = "";\n' > "$r/src/bad.ts"
commit_all "$r" remove-secret
expect "secret removed in a later commit is still caught (history)" "$r" 1 secrets FAIL

# 3d. Committed env file.
r="$(new_repo envfile)"
printf 'A=1\n' > "$r/.env.production"
commit_all "$r" env
expect "committed .env file is caught" "$r" 1 secrets FAIL

# 3e. Output never echoes the secret value.
r="$(new_repo noecho)"
printf 'export const k = "%s";\n' "$FAKE_KEY" > "$r/src/bad.ts"
commit_all "$r" add-secret
out="$(run_static "$r")"
if printf '%s' "$out" | grep -q "$FAKE_KEY"; then
  FAILED=$((FAILED + 1)); echo "FAIL  secret value was printed in output"
else
  PASSED=$((PASSED + 1)); echo "ok    secret value is never printed"
fi

# 4. Non-breaking space in code.
r="$(new_repo nbsp)"
printf 'export const re = /a\xc2\xa0b/;\n' > "$r/src/bad.ts"
commit_all "$r" nbsp
expect "literal U+00A0 in code is caught" "$r" 1 chars FAIL

# 4b. The same character inside a test file is a note, not a failure.
r="$(new_repo nbsptest)"
printf 'export const csv = "\xef\xbb\xbfa,b";\n' > "$r/src/bom.test.ts"
commit_all "$r" bomtest
expect "raw BOM in a test file is allowed with a note" "$r" 0 chars PASS

# 5. Braces inside a schema comment.
r="$(new_repo schemadoc)"
printf 'model B {\n  /// JSON like {code, amount}\n  id String @id\n}\n' >> "$r/Collect-RX-main/prisma/schema.prisma"
commit_all "$r" schema
expect "braces in schema comment are caught" "$r" 1 schemadoc FAIL

# 5b. Braces in a comment that already existed on the base are a note, not a failure.
r="$(new_repo schemaold)"
printf 'model C {\n  /// JSON like {code, amount}\n  id String @id\n}\n' >> "$r/Collect-RX-main/prisma/schema.prisma"
(cd "$r" && git add -A && git commit -q -m old-brace && git branch -f main HEAD && git checkout -q -b feature/after)
printf 'export const three = 3;\n' > "$r/src/three.ts"
commit_all "$r" after
expect "pre-existing schema comment braces do not fail" "$r" 0 schemadoc PASS

# 6. Protected paths and duplicate-suffix files.
r="$(new_repo protected)"
mkdir -p "$r/.codex"; printf 'x\n' > "$r/.codex/notes.md"
commit_all "$r" codex
expect ".codex change is caught" "$r" 1 scope FAIL

r="$(new_repo dup)"
printf 'x\n' > "$r/README 2.md"
commit_all "$r" dup
expect "' 2' duplicate file is caught" "$r" 1 scope FAIL

# 7. No base ref must be UNVERIFIED (exit 2), never a silent pass.
r="$(new_repo nobase)"
(cd "$r" && git branch -m main trunk && git checkout -q -b feature/orphan) >/dev/null 2>&1
out="$(cd "$r" && bash scripts/verify-all.sh --static 2>&1)"; rc=$?
if [ "$rc" = "2" ] && printf '%s' "$out" | grep -q UNVERIFIED; then
  PASSED=$((PASSED + 1)); echo "ok    missing base ref is UNVERIFIED, not PASS"
else
  FAILED=$((FAILED + 1)); echo "FAIL  missing base ref (exit $rc)"; printf '%s\n' "$out" | tail -n 12 | sed 's/^/      /'
fi

# 8. Broken migration against a real database (opt in).
if [ "$RUN_DB" = "1" ]; then
  top="$(cd "$HERE/.." && pwd)"
  bad="$top/Collect-RX-main/prisma/migrations/99999999999999_selftest_broken"
  mkdir -p "$bad"
  printf 'CREATE TABEL this_is_not_valid_sql (id int);\n' > "$bad/migration.sql"
  out="$(cd "$top" && bash scripts/verify-all.sh --only deps,pg,migrate --base main 2>&1)"; rc=$?
  rm -rf "$bad"
  if [ "$rc" = "1" ] && printf '%s\n' "$out" | grep -E '^migrate +' | grep -q FAIL; then
    PASSED=$((PASSED + 1)); echo "ok    broken migration fails the migrate gate"
  else
    FAILED=$((FAILED + 1)); echo "FAIL  broken migration (exit $rc)"; printf '%s\n' "$out" | tail -n 30 | sed 's/^/      /'
  fi
fi

echo
echo "selftest: $PASSED passed, $FAILED failed"
[ "$FAILED" = "0" ]
