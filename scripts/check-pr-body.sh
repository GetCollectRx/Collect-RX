#!/usr/bin/env bash
# scripts/check-pr-body.sh
#
# Fails a pull request whose description does not carry the gate output it relies on.
# The author pastes the last lines of `bash scripts/verify-all.sh`, which end with a line
# such as "VERIFY-ALL: PASS (18 passed)". This does not prove the run happened (a body can be
# edited), but it makes an unrun or red gate a visible, deliberate statement and not a ticked
# box, and the real checks still run in CI.
#
# Input (environment only, so the description is never interpolated into a shell command):
#   PR_BODY    the pull request description
#   PR_AUTHOR  the author's login (bots that open dependency PRs are exempt)
#
# Exit codes: 0 accepted, 1 rejected, 2 not configured. The body itself is never printed.

set -u

body="${PR_BODY-}"
author="${PR_AUTHOR-}"

if [ -z "${PR_BODY+x}" ] || [ -z "${PR_AUTHOR+x}" ]; then
  echo "check-pr-body: PR_BODY and PR_AUTHOR must be set" >&2
  exit 2
fi

case "$author" in
  "dependabot[bot]"|"github-actions[bot]")
    echo "PR from $author: gate output not required."
    exit 0
    ;;
esac

# Pull request bodies use CRLF line endings.
body="$(printf '%s' "$body" | tr -d '\r')"

pass_re='^[[:space:]>]*VERIFY-ALL:[[:space:]]+PASS([[:space:]]|\(|$)'
unver_re='^[[:space:]>]*VERIFY-ALL:[[:space:]]+UNVERIFIED([[:space:]]|\(|$)'
fail_re='^[[:space:]>]*VERIFY-ALL:[[:space:]]+FAIL([[:space:]]|\(|$)'
ack_re='^[[:space:]>]*UNVERIFIED acknowledged by @[A-Za-z0-9][A-Za-z0-9-]*'

if printf '%s\n' "$body" | grep -Eq "$fail_re"; then
  echo "::error::The pull request description reports 'VERIFY-ALL: FAIL'. Fix the failing gate and paste the passing output."
  exit 1
fi

if printf '%s\n' "$body" | grep -Eq "$pass_re"; then
  echo "Gate output found: VERIFY-ALL: PASS."
  exit 0
fi

if printf '%s\n' "$body" | grep -Eq "$unver_re"; then
  if printf '%s\n' "$body" | grep -Eq "$ack_re"; then
    echo "Gate output found: VERIFY-ALL: UNVERIFIED, with a named acknowledgement."
    exit 0
  fi
  echo "::error::The description reports 'VERIFY-ALL: UNVERIFIED' without a line 'UNVERIFIED acknowledged by @owner'. An unverified gate needs the owner's acknowledgement."
  exit 1
fi

echo "::error::The pull request description has no gate output. Run 'bash scripts/verify-all.sh' and paste its final line (for example 'VERIFY-ALL: PASS (18 passed)') under the 'Gate output' heading."
exit 1
