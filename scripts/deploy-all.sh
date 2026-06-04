#!/usr/bin/env bash
# deploy-all.sh — One-command full FheForge deployment
# Usage: bash scripts/deploy-all.sh [--skip-contracts] [--skip-push]
# Prerequisites: PRIVATE_KEY in contracts/.env, sufficient ETH balance

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKIP_CONTRACTS=false
SKIP_PUSH=false
DEMO_MODE="${DEMO_MODE:-1}"

for arg in "$@"; do
  case "$arg" in
    --skip-contracts) SKIP_CONTRACTS=true ;;
    --skip-push) SKIP_PUSH=true ;;
    --prod) DEMO_MODE=0 ;;
  esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
step() { echo -e "\n${GREEN}═══ $1 ═══${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }

# ─── Step 1: Compile contracts ───
step "Step 1: Compile contracts"
cd "$ROOT/contracts"
forge build --no-cache || fail "forge build failed"
echo "✓ Contracts compiled"

# ─── Step 2: Deploy contracts ───
if [ "$SKIP_CONTRACTS" = false ]; then
  step "Step 2: Deploy contracts to Arbitrum Sepolia"
  DEMO_MODE=$DEMO_MODE npx hardhat run scripts/forge-deploy.ts --network arb-sepolia || fail "Contract deployment failed"
  echo "✓ Contracts deployed"
else
  warn "Step 2: Skipped (--skip-contracts)"
fi

# ─── Step 3: Sync addresses ───
step "Step 3: Sync addresses from deployment record"
cd "$ROOT"
bash scripts/sync-addresses.sh || fail "Address sync failed"
echo "✓ Addresses synced"

# ─── Step 4: Sync ABIs ───
step "Step 4: Sync ABIs from compiled artifacts"
bash scripts/sync-abis.sh || fail "ABI sync failed"
echo "✓ ABIs synced"

# ─── Step 5: Rebuild bridge dist ───
step "Step 5: Rebuild bridge dist"
cd "$ROOT/packages/forge-bridge"
bun run build || fail "Bridge build failed"
echo "✓ Bridge dist rebuilt"

# ─── Step 6: Verify dist ───
step "Step 6: Verify bridge dist"
DIST="$ROOT/packages/forge-bridge/dist/index.js"
for FN in removeToken incrementTvl resetCheckpoint; do
  grep -q "$FN" "$DIST" && echo "  ✓ ABI contains $FN" || warn "  ABI missing $FN"
done
echo "✓ Bridge dist verified"

# ─── Step 7: Git commit + push ───
if [ "$SKIP_PUSH" = false ]; then
  step "Step 7: Git commit + push"
  cd "$ROOT"
  git add -A
  git diff --cached --stat
  echo ""
  read -p "Commit and push? (y/N) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    git commit -m "deploy: sync addresses, ABIs, rebuild bridge dist"
    git push origin master
    echo "✓ Pushed — Vercel will auto-redeploy"
  else
    warn "Push skipped"
  fi
else
  warn "Step 7: Skipped (--skip-push)"
fi

# ─── Summary ───
echo ""
echo -e "${GREEN}═══ Deployment Complete ═══${NC}"
echo "Next steps:"
echo "  1. Verify Railway: https://fheforge-api-production-6465.up.railway.app/health"
echo "  2. Verify Vercel: https://fheforge.vercel.app/"
echo "  3. Run smoke tests: bash scripts/test-deploy.sh"
