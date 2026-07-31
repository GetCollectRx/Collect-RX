#!/bin/bash
# check-demo-staging.sh — Health check for demo/staging environment
# Usage: ./scripts/check-demo-staging.sh [env]
# Env: staging (default), demo

ENV=${1:-staging}
STAGING_URL="https://demo.collectrx.ca"
DB_URL="${DATABASE_URL:-}"

set +e  # Don't exit on first failure; collect all results

echo "=== CollectRx Demo Staging Health Check ==="
echo "Timestamp: $(date)"
echo "Environment: $ENV"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

FAILED=0

# 1. Check API health
echo "1. API Health..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$STAGING_URL/health" --connect-timeout 5)
if [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}✓${NC} API responding (HTTP $HTTP_CODE)"
else
  echo -e "${RED}✗${NC} API not healthy (HTTP $HTTP_CODE)"
  FAILED=$((FAILED + 1))
fi

# 2. Check database connectivity
echo ""
echo "2. Database Connectivity..."
if [ -z "$DB_URL" ]; then
  echo -e "${YELLOW}⊘${NC} DATABASE_URL not set; skipping DB check"
else
  if psql "$DB_URL" -c "SELECT 1" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Database connected"
  else
    echo -e "${RED}✗${NC} Database connection failed"
    FAILED=$((FAILED + 1))
  fi
fi

# 3. Check demo practice exists
echo ""
echo "3. Demo Practice..."
if [ -z "$DB_URL" ]; then
  echo -e "${YELLOW}⊘${NC} Skipping (DB_URL not set)"
else
  PRACTICE_COUNT=$(psql "$DB_URL" -t -A -c "SELECT COUNT(*) FROM practices WHERE name LIKE '%Demo%'" 2>/dev/null)
  if [ "$PRACTICE_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓${NC} Demo practice exists ($PRACTICE_COUNT found)"
  else
    echo -e "${RED}✗${NC} Demo practice not found; run: npm run demo:seed -- --reset"
    FAILED=$((FAILED + 1))
  fi
fi

# 4. Check claims in demo practice
echo ""
echo "4. Demo Claims..."
if [ -z "$DB_URL" ]; then
  echo -e "${YELLOW}⊘${NC} Skipping (DB_URL not set)"
else
  CLAIM_COUNT=$(psql "$DB_URL" -t -A -c "
    SELECT COUNT(*) FROM insurance_claims ic
    JOIN practices p ON p.id = ic.practice_id
    WHERE p.name LIKE '%Demo%'
  " 2>/dev/null)
  if [ "$CLAIM_COUNT" -gt 50 ]; then
    echo -e "${GREEN}✓${NC} Claims seeded ($CLAIM_COUNT claims)"
  elif [ "$CLAIM_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}⊘${NC} Low claim count ($CLAIM_COUNT); consider reseeding"
  else
    echo -e "${RED}✗${NC} No demo claims found; run: npm run demo:seed -- --reset"
    FAILED=$((FAILED + 1))
  fi
fi

# 5. Check response time
echo ""
echo "5. Response Time..."
START=$(date +%s%N)
curl -s "$STAGING_URL/health" > /dev/null --connect-timeout 5
END=$(date +%s%N)
ELAPSED=$(( (END - START) / 1000000 ))  # Convert nanoseconds to milliseconds
if [ $ELAPSED -lt 2000 ]; then
  echo -e "${GREEN}✓${NC} Response time: ${ELAPSED}ms"
else
  echo -e "${YELLOW}⊘${NC} Slow response: ${ELAPSED}ms (expected < 2000ms)"
fi

# Summary
echo ""
echo "=== Summary ==="
if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ All checks passed — staging is ready for demos${NC}"
  exit 0
else
  echo -e "${RED}✗ $FAILED check(s) failed — fix before demoing${NC}"
  exit 1
fi
