#!/usr/bin/env bash
# scripts/check-gate-parity.selftest.sh
# Proves check-gate-parity.sh passes on the real files and fails on each kind of drift.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TOP="$(cd "$HERE/.." && pwd)"
SUT="$HERE/check-gate-parity.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/crx-parity.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
PASSED=0
FAILED=0

fresh() { # name -> a private copy of the files the checker reads
  d="$WORK/$1"
  mkdir -p "$d/.github/workflows" "$d/scripts" "$d/.githooks"
  cp "$TOP/.github/workflows/collectrx-ci.yml" "$d/.github/workflows/"
  cp "$TOP/scripts/verify-all.sh" "$TOP/scripts/gate-parity.map" "$d/scripts/"
  cp "$TOP/.githooks/pre-push" "$d/.githooks/"
  cp "$TOP/package.json" "$d/"
  echo "$d"
}

check() { # name dir expected-exit expected-text
  name="$1"; dir="$2"; want="$3"; text="$4"
  out="$(GATE_PARITY_ROOT="$dir" bash "$SUT" 2>&1)"; rc=$?
  if [ "$rc" = "$want" ] && { [ -z "$text" ] || printf '%s' "$out" | grep -Fq -- "$text"; }; then
    PASSED=$((PASSED + 1)); printf 'ok    %s\n' "$name"
  else
    FAILED=$((FAILED + 1)); printf 'FAIL  %s (exit %s, wanted %s, text %s)\n' "$name" "$rc" "$want" "$text"
    printf '%s\n' "$out" | sed 's/^/      /' | tail -n 12
  fi
}

d="$(fresh real)"
check "the real files are in parity" "$d" 0 "in parity"

d="$(fresh extrastep)"
# A new CI verify step with no mapping.
sed -i 's/^      - name: Lint$/      - name: Extra security scan\n        run: echo scan\n\n      - name: Lint/' "$d/.github/workflows/collectrx-ci.yml"
check "an unmapped CI verify step is caught" "$d" 1 "Extra security scan"

d="$(fresh audit)"
sed -i 's/--audit-level=critical/--audit-level=high/' "$d/.github/workflows/collectrx-ci.yml"
check "an audit severity mismatch is caught" "$d" 1 "audit severity differs"

d="$(fresh newgate)"
sed -i 's/^run_gate build /run_gate coverage "Coverage" gate_coverage\nrun_gate build /' "$d/scripts/verify-all.sh"
check "a verify-all gate with no mapping is caught" "$d" 1 "gate 'coverage' has no GATE line"

d="$(fresh nohook)"
sed -i 's/verify-all.sh --full/verify-all.sh --static/' "$d/.githooks/pre-push"
check "a hook that no longer runs the full gates is caught" "$d" 1 "does not run 'verify-all.sh --full'"

d="$(fresh noprepare)"
sed -i 's/"prepare": "git config core.hooksPath .githooks"/"prepare": "echo skip"/' "$d/package.json"
check "an install that no longer installs the hook is caught" "$d" 1 "does not set core.hooksPath"

d="$(fresh stalemap)"
printf 'GATE\tghost\tstep:A step that does not exist\n' >> "$d/scripts/gate-parity.map"
check "a map entry for a missing gate and step is caught" "$d" 1 "no such gate"

d="$(fresh badstep)"
sed -i 's/step:Typecheck$/step:Typecheck was renamed/' "$d/scripts/gate-parity.map"
check "a map entry pointing at a renamed CI step is caught" "$d" 1 "not in the verify job"

d="$(fresh nonstatic)"
sed -i 's/--only env,scope,anyscan,todo,chars,schemadoc/--only env,scope,anyscan,todo,chars,schemadoc,test/' "$d/.github/workflows/collectrx-ci.yml"
check "static-gates running a non-static gate is caught" "$d" 1 "does not treat as a static gate"

d="$(fresh dropped)"
sed -i 's/--only env,scope,anyscan,todo,chars,schemadoc/--only env,scope,anyscan,chars,schemadoc/' "$d/.github/workflows/collectrx-ci.yml"
check "a mapped static gate missing from static-gates is caught" "$d" 1 "gate 'todo' is mapped to static-gates"

d="$(fresh missingfile)"
rm "$d/scripts/gate-parity.map"
check "a missing input file is exit 2, never a pass" "$d" 2 "missing file"

echo
echo "selftest: $PASSED passed, $FAILED failed"
[ "$FAILED" = "0" ]
