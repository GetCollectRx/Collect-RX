#!/usr/bin/env bash
# scripts/check-pr-body.selftest.sh
# Proves check-pr-body.sh accepts and rejects the right descriptions.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SUT="$HERE/check-pr-body.sh"
PASSED=0
FAILED=0

check() { # name expected-exit author body
  name="$1"; want="$2"; author="$3"; body="$4"
  out="$(PR_BODY="$body" PR_AUTHOR="$author" bash "$SUT" 2>&1)"; rc=$?
  if [ "$rc" = "$want" ]; then
    PASSED=$((PASSED + 1)); printf 'ok    %s\n' "$name"
  else
    FAILED=$((FAILED + 1)); printf 'FAIL  %s (exit %s, wanted %s)\n' "$name" "$rc" "$want"; printf '%s\n' "$out" | sed 's/^/      /'
  fi
}

check "passing gate output is accepted" 0 alice $'## Summary\nChange.\n\n## Gate output\n```\nVERIFY-ALL: PASS (18 passed)\n```\n'
check "CRLF line endings are accepted" 0 alice $'## Gate output\r\nVERIFY-ALL: PASS (18 passed)\r\n'
check "indented and quoted lines are accepted" 0 alice $'> VERIFY-ALL: PASS (7 passed)'
check "an empty description is rejected" 1 alice ""
check "a checklist with no output is rejected" 1 alice $'- [x] gates pass locally\n- [x] tests pass'
check "VERIFY-ALL: FAIL is rejected" 1 alice $'VERIFY-ALL: FAIL (1 failed, 0 unverified, 6 passed)'
check "FAIL wins even when a PASS line is also present" 1 alice $'VERIFY-ALL: PASS (3 passed)\nVERIFY-ALL: FAIL (1 failed)'
check "UNVERIFIED without acknowledgement is rejected" 1 alice $'VERIFY-ALL: UNVERIFIED (6 gate(s) could not run)'
check "UNVERIFIED with a named acknowledgement is accepted" 0 alice $'VERIFY-ALL: UNVERIFIED (6 gate(s) could not run)\nUNVERIFIED acknowledged by @khalidegeh'
check "acknowledgement alone is rejected" 1 alice $'UNVERIFIED acknowledged by @khalidegeh'
check "the phrase in prose is not output" 1 alice $'Please run VERIFY-ALL: PASS before merging.'
check "a lowercase pass line is rejected" 1 alice $'verify-all: pass'
check "dependabot is exempt" 0 "dependabot[bot]" ""
check "github-actions is exempt" 0 "github-actions[bot]" ""
check "another bot is not exempt" 1 "random-bot" ""

# Missing environment is a configuration error, never a pass.
out="$(env -u PR_BODY -u PR_AUTHOR bash "$SUT" 2>&1)"; rc=$?
if [ "$rc" = "2" ]; then PASSED=$((PASSED + 1)); echo "ok    missing environment is exit 2"; else FAILED=$((FAILED + 1)); echo "FAIL  missing environment (exit $rc)"; fi

# The body must never be echoed.
canary_body="canary phrase that must never be echoed, and no gate output here"
out="$(PR_BODY="$canary_body" PR_AUTHOR=alice bash "$SUT" 2>&1)"
if printf '%s' "$out" | grep -q "canary phrase"; then FAILED=$((FAILED + 1)); echo "FAIL  body was echoed"; else PASSED=$((PASSED + 1)); echo "ok    body is never echoed"; fi

echo
echo "selftest: $PASSED passed, $FAILED failed"
[ "$FAILED" = "0" ]
