#!/usr/bin/env bash
cd "$(dirname "$0")/.."

export PRIVATE_KEY=$(sed -n 's/^PRIVATE_KEY=//p' .env)
export HARDHAT_EXPERIMENTAL_ALLOW_NON_LOCAL_INSTALLATION=true

echo "Live breaker — Wave 9 contracts"
exec npx hardhat run scripts/test-live.ts --network arb-sepolia
