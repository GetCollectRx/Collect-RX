#!/usr/bin/env bash
# scripts/check-gate-parity.sh
#
# Fails when the local gate set (scripts/verify-all.sh, which .githooks/pre-push runs) and the CI
# verify job in .github/workflows/collectrx-ci.yml have drifted apart. CLAUDE.md requires them to
# stay in lockstep: a hook weaker than CI lets red code reach GitHub, a hook stricter than CI
# trains people to bypass it with --no-verify.
#
# It checks, using scripts/gate-parity.map as the declared mapping:
#   1. every step of the CI verify job is a mapped gate, setup plumbing, or a declared CI-only step
#   2. every gate in verify-all.sh has a mapping, and each mapping points at something that exists
#   3. the npm audit severity is the same in both places
#   4. the pre-push hook runs verify-all.sh --full, and npm install installs the hook
#   5. the static-gates job runs only gates that verify-all.sh treats as static
#
# Paths can be pointed elsewhere with GATE_PARITY_ROOT (used by the self-test).
# Exit 0 in parity, 1 on drift. Nothing outside the listed files is read.

set -u

ROOT="${GATE_PARITY_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
CI="$ROOT/.github/workflows/collectrx-ci.yml"
VERIFY="$ROOT/scripts/verify-all.sh"
MAP="$ROOT/scripts/gate-parity.map"
HOOK="$ROOT/.githooks/pre-push"
PKG="$ROOT/package.json"

problems=0
problem() { problems=$((problems + 1)); printf 'DRIFT: %s\n' "$1"; }

for f in "$CI" "$VERIFY" "$MAP" "$HOOK" "$PKG"; do
  [ -f "$f" ] || { echo "check-gate-parity: missing file ${f#"$ROOT"/}" >&2; exit 2; }
done

job_block() { # job name -> the job's lines in the CI file
  awk -v job="$1" '
    $0 ~ "^  " job ":[[:space:]]*$" { injob = 1; next }
    /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { if (injob) injob = 0 }
    injob { print }
  ' "$CI"
}

job_exists() { grep -Eq "^  $1:[[:space:]]*$" "$CI"; }

verify_steps() {
  job_block verify | awk '/^      - name: / { sub(/^      - name: /, ""); sub(/[[:space:]]+$/, ""); print }'
}

map_lines() { grep -vE '^[[:space:]]*(#|$)' "$MAP"; }
map_field() { # kind column-number
  map_lines | awk -F'\t' -v k="$1" -v c="$2" '$1 == k { print $c }'
}

STEPS="$(verify_steps)"
GATE_IDS="$(grep -E '^run_gate +[a-z]+ ' "$VERIFY" | awk '{ print $2 }')"

# 1. Every CI verify step is accounted for.
declared_steps="$( { map_lines | awk -F'\t' '$1 == "GATE" && $3 ~ /^step:/ { sub(/^step:/, "", $3); print $3 }'; map_field SETUP 2; map_field CI_ONLY 2; } )"
while IFS= read -r step; do
  [ -n "$step" ] || continue
  printf '%s\n' "$declared_steps" | grep -Fxq -- "$step" \
    || problem "CI verify step '$step' is not in scripts/gate-parity.map. Mirror it as a gate in verify-all.sh, or declare it SETUP or CI_ONLY."
done <<EOF_STEPS
$STEPS
EOF_STEPS

# 2a. Every verify-all.sh gate has a mapping.
while IFS= read -r id; do
  [ -n "$id" ] || continue
  map_lines | awk -F'\t' -v i="$id" '$1 == "GATE" && $2 == i { found = 1 } END { exit !found }' \
    || problem "verify-all.sh gate '$id' has no GATE line in scripts/gate-parity.map."
done <<EOF_IDS
$GATE_IDS
EOF_IDS

# 2b. Every mapping points at something that exists.
while IFS="$(printf '\t')" read -r kind id where; do
  [ "$kind" = "GATE" ] || continue
  printf '%s\n' "$GATE_IDS" | grep -Fxq -- "$id" || problem "map names gate '$id' but verify-all.sh has no such gate."
  case "$where" in
    step:*)
      name="${where#step:}"
      printf '%s\n' "$STEPS" | grep -Fxq -- "$name" || problem "gate '$id' maps to CI step '$name', which is not in the verify job."
      ;;
    job:*)
      name="${where#job:}"
      job_exists "$name" || problem "gate '$id' maps to CI job '$name', which does not exist."
      ;;
    ci-only:?*|local-only:?*) ;;
    *) problem "gate '$id' has an invalid mapping '$where' (use step:, job:, ci-only:<reason> or local-only:<reason>)." ;;
  esac
done <<EOF_MAP
$(map_lines)
EOF_MAP

# 3. The audit severity is the same.
ci_level="$(job_block verify | grep -oE -e '--audit-level=[a-z]+' | head -n 1)"
local_level="$(grep -E 'npm audit ' "$VERIFY" | grep -oE -e '--audit-level=[a-z]+' | head -n 1)"
if [ -z "$ci_level" ] || [ -z "$local_level" ]; then
  problem "could not read the npm audit severity (CI: '${ci_level:-none}', verify-all.sh: '${local_level:-none}')."
elif [ "$ci_level" != "$local_level" ]; then
  problem "npm audit severity differs: CI uses $ci_level, verify-all.sh uses $local_level."
fi

# 4. The hook runs the full gate set, and installing dependencies installs the hook.
grep -Eq 'verify-all\.sh +--full' "$HOOK" || problem ".githooks/pre-push does not run 'verify-all.sh --full'."
grep -Eq '"prepare"[[:space:]]*:[[:space:]]*"[^"]*core\.hooksPath[[:space:]]+\.githooks' "$PKG" \
  || problem "package.json 'prepare' script does not set core.hooksPath to .githooks, so the hook is not installed by npm install."

# 5. The static-gates job runs only gates that verify-all.sh treats as static.
if job_exists static-gates; then
  only="$(job_block static-gates | grep -oE -e '--only [a-z,]+' | head -n 1 | sed 's/^--only //')"
  static_ids="$(grep -E '^STATIC_IDS=' "$VERIFY" | head -n 1 | sed -E 's/^STATIC_IDS="?([^"]*)"?.*/\1/')"
  [ -n "$only" ] || problem "the static-gates job has no --only list."
  for id in $(printf '%s' "$only" | tr ',' ' '); do
    printf '%s' "$static_ids" | tr ',' '\n' | grep -Fxq -- "$id" || problem "static-gates runs '$id', which verify-all.sh does not treat as a static gate."
  done
  # Every gate mapped to the static-gates job must be listed in its --only.
  for id in $(map_lines | awk -F'\t' '$1 == "GATE" && $3 == "job:static-gates" { print $2 }'); do
    printf '%s' "$only" | tr ',' '\n' | grep -Fxq -- "$id" || problem "gate '$id' is mapped to static-gates but not in that job's --only list."
  done
fi

if [ "$problems" -gt 0 ]; then
  printf '\ncheck-gate-parity: %s problem(s). Update both sides and scripts/gate-parity.map in the same change.\n' "$problems"
  exit 1
fi
echo "check-gate-parity: the pre-push hook, verify-all.sh and the CI verify job are in parity."
exit 0
