#!/usr/bin/env bash
# One-time / repeat Railway production hardening for Collect-RX.
# Requires: railway CLI logged in, cwd = Collect-RX-main, linked to Collect-RX web service.
set -euo pipefail

WEB_SERVICE="${RAILWAY_WEB_SERVICE:-Collect-RX}"
WORKER_SERVICE="${RAILWAY_WORKER_SERVICE:-collectrx-worker}"
ORIGIN="${PUBLIC_ORIGIN:-https://www.collectrx.ca}"

echo "==> Canonical URL env on ${WEB_SERVICE}"
railway variable set -s "$WEB_SERVICE" \
  "PUBLIC_APP_URL=${ORIGIN}" \
  "ALLOWED_ORIGINS=${ORIGIN}" \
  "SERVER_URL=${ORIGIN}"

echo "==> Phase 6 learning loop (web + worker)"
railway variable set -s "$WEB_SERVICE" \
  "LEARNING_LOOP_ENABLED=1" \
  "LEARNING_CRON=0 6 * * *" \
  "LEARNING_FEASIBILITY_MIN=65" \
  "LEARNING_MAX_IMPLEMENT_PER_CYCLE=3"

if [[ -n "${NOTION_API_KEY:-}" ]]; then
  railway variable set -s "$WEB_SERVICE" "NOTION_API_KEY=${NOTION_API_KEY}"
fi
if [[ -n "${NOTION_LEARNING_DATABASE_ID:-}" ]]; then
  railway variable set -s "$WEB_SERVICE" "NOTION_LEARNING_DATABASE_ID=${NOTION_LEARNING_DATABASE_ID}"
fi

echo "==> Add Redis (skip if already in project)"
if ! railway variable list -s "$WEB_SERVICE" -k 2>/dev/null | grep -q '^REDIS_URL='; then
  railway add --database redis || true
fi

echo ""
echo "Next (Railway dashboard):"
echo "  1. Web service ${WEB_SERVICE}: Variables → Reference REDIS_URL from Redis plugin"
echo "  2. New service ${WORKER_SERVICE}: same repo, root Collect-RX-main"
echo "     Config file: railway.worker.toml  OR  Dockerfile.worker"
echo "     Start: npm run worker — no public domain"
echo "  3. Copy DATABASE_URL + REDIS_URL + integration vars to worker"
echo "  4. Set NOTION_API_KEY + NOTION_LEARNING_DATABASE_ID if not in shell env"
echo "  5. git push → deploy (migrations via releaseCommand)"
echo ""
echo "Verify: curl ${ORIGIN}/api/health/metrics  → counters only; deployment flags need HEALTH_METRICS_TOKEN + curl -H \"Authorization: Bearer ...\""
