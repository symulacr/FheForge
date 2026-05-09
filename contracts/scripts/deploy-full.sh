#!/usr/bin/env bash
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export HARDHAT_EXPERIMENTAL_ALLOW_NON_LOCAL_INSTALLATION=true
export DEMO_MODE=1
echo "Deploying all contracts (wave 11)..."
npx hardhat run scripts/deploy-wave11.ts --network arb-sepolia
echo "Done. Update ui/.env.local with addresses above."
