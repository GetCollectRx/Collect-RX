#!/usr/bin/env bash
# Group C — staging (or any API host) health smoke.
# Usage: STAGING_API_BASE=https://host ./scripts/staging-smoke.sh
set -euo pipefail

BASE="${STAGING_API_BASE:-${API_BASE:-http://localhost:3000}}"
BASE="${BASE%/}"

echo "CollectRx staging smoke → $BASE"
echo "(Practice → Insurance product; no patient-pay checks)"

fail=0
check() {
  local path="$1"
  local label="$2"
  if curl -sfS --max-time 20 "${BASE}${path}" >/tmp/crx-smoke-body.json 2>/tmp/crx-smoke-err.txt; then
    echo "OK  $label  GET ${path}"
    if command -v jq >/dev/null 2>&1; then
      jq -c . </tmp/crx-smoke-body.json || true
    fi
  else
    echo "FAIL $label  GET ${path}"
    cat /tmp/crx-smoke-err.txt >&2 || true
    fail=1
  fi
}

check '/api/health' 'liveness'
check '/api/health/ready' 'readiness (DB)'
check '/api/health/metrics' 'metrics'

# Queue endpoint may 503 without Redis — warn only
if curl -sfS --max-time 20 "${BASE}/api/health/queue" >/tmp/crx-smoke-queue.json 2>/dev/null; then
  echo "OK  queue    GET /api/health/queue"
else
  echo "WARN queue    GET /api/health/queue (optional; set REDIS_URL + worker for full queue health)"
fi

# Retired patient-pay surfaces must not succeed as a public pay API
pay_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "${BASE}/api/public/pay/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" || true)
case "$pay_code" in
  401|404|405|410) echo "OK  retired pay route returns $pay_code" ;;
  *) echo "FAIL retired pay route unexpected HTTP $pay_code"; fail=1 ;;
esac

if [[ "$fail" -ne 0 ]]; then
  echo "Staging smoke FAILED"
  exit 1
fi
echo "Staging smoke PASSED"
exit 0
