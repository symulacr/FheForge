#!/usr/bin/env bash
cd "$(dirname "$0")/.."

export PRIVATE_KEY=$(sed -n 's/^PRIVATE_KEY=//p' .env)
export DEMO_MODE=1
export HARDHAT_EXPERIMENTAL_ALLOW_NON_LOCAL_INSTALLATION=true

echo "deployer: $(node -e "const{ethers}=require('ethers');console.log(new ethers.Wallet(process.env.PRIVATE_KEY).address)")"
exec npx hardhat run scripts/deploy.ts --network arb-sepolia
