#!/usr/bin/env bash
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export HARDHAT_EXPERIMENTAL_ALLOW_NON_LOCAL_INSTALLATION=true
export DEMO_MODE=1
echo "Deploying Pool + Oracle + Composer..."
npx hardhat run scripts/deploy-pool-oracle.ts --network arb-sepolia
echo "Done. Update ui/.env.local with addresses above."
