#!/usr/bin/env bash
# test-deploy.sh — Post-deployment verification
# Usage: bash scripts/test-deploy.sh [backend_url] [frontend_url]

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_URL="${1:-https://fheforge-api-production-6465.up.railway.app}"
FRONTEND_URL="${2:-https://fheforge.vercel.app}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; FAILURES=$((FAILURES+1)); }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
FAILURES=0

echo "═══ FheForge Deployment Verification ═══"
echo "Backend:  $BACKEND_URL"
echo "Frontend: $FRONTEND_URL"
echo ""

# ─── Step 1: Compile contracts ───
echo "─── Contracts ───"
cd "$ROOT/contracts"
if forge build --no-cache 2>/dev/null; then
  pass "forge build"
else
  fail "forge build"
fi

# ─── Step 2: Foundry tests ───
if forge test -vvv 2>/dev/null; then
  pass "forge test"
else
  fail "forge test"
fi

# ─── Step 3: Bridge build ───
echo ""
echo "─── Bridge ───"
cd "$ROOT/packages/forge-bridge"
if bun run build 2>/dev/null; then
  pass "bridge build"
else
  fail "bridge build"
fi

# ─── Step 4: Verify ABIs in dist ───
DIST="$ROOT/packages/forge-bridge/dist/index.js"
for FN in removeToken incrementTvl resetCheckpoint decrementTvl borrowWithLtvCheck; do
  if grep -q "$FN" "$DIST" 2>/dev/null; then
    pass "ABI: $FN"
  else
    fail "ABI: $FN missing from dist"
  fi
done

# ─── Step 5: Backend endpoints ───
echo ""
echo "─── Backend ───"
for ENDPOINT in health strategies defi-modules; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/$ENDPOINT" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    pass "GET /$ENDPOINT → $STATUS"
  else
    fail "GET /$ENDPOINT → $STATUS"
  fi
done

# ─── Step 6: Frontend ───
echo ""
echo "─── Frontend ───"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL" 2>/dev/null || echo "000")
if [ "$STATUS" = "200" ]; then
  pass "GET $FRONTEND_URL → $STATUS"
else
  fail "GET $FRONTEND_URL → $STATUS"
fi

# Check COEP/COOP headers
HEADERS=$(curl -sI "$FRONTEND_URL" 2>/dev/null)
if echo "$HEADERS" | grep -qi "cross-origin-opener-policy"; then
  pass "COOP header present"
else
  fail "COOP header missing"
fi
if echo "$HEADERS" | grep -qi "cross-origin-embedder-policy"; then
  pass "COEP header present"
else
  fail "COEP header missing"
fi

# Check bridge dist in frontend
BRIDGE_URL="$FRONTEND_URL/packages/forge-bridge/dist/index.js"
BRIDGE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BRIDGE_URL" 2>/dev/null || echo "000")
if [ "$BRIDGE_STATUS" = "200" ]; then
  pass "Bridge dist accessible"
else
  fail "Bridge dist not accessible ($BRIDGE_STATUS)"
fi

# ─── Summary ───
echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo -e "${GREEN}All checks passed.${NC}"
  exit 0
else
  echo -e "${RED}$FAILURES check(s) failed.${NC}"
  exit 1
fi
