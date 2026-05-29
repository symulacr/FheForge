# FheForge — AI Developer Context

## Project
FHE-encrypted DeFi protocol on Arbitrum Sepolia. Supply, borrow, swap, liquidate — every amount stays encrypted on-chain. Built with @cofhe/sdk and Fhenix CoFHE.

## Quick Start
```bash
forge build --no-cache
forge test -vvv --no-cache
npx hardhat test
DEMO_MODE=1 npx hardhat run scripts/forge-deploy.ts --network arb-sepolia
cd ui && bun run dev
cd backend/apps && bun run start:dev
```

## Repo Structure
- `contracts/contracts/` — Solidity contracts (LendingPool, StrategyVault, Composer, SwapRouter, PriceOracle, Registry, Executor)
- `contracts/test-foundry/` — Foundry tests (fuzz + unit + invariant)
- `contracts/scripts/` — forge-deploy.ts, forge-test.ts, gas-benchmarks.ts
- `ui/` — Next.js 14 app with @cofhe/react, wagmi v2, viem
- `backend/apps/` — NestJS 11 API with Supabase, Gemini AI, event indexer
- `docs/` — ADRs, security audits, execution plan

## Deployed Contracts (Arb Sepolia)
- LendingPool: 0x6903df3E8f45497C3097A16E534787D6Fc9F58eF
- StrategyVault: 0xf3cB0A1b02128C630C2bca9b50151FbC350f6AFC
- SwapRouter: 0x1136E5eF8bB8E189aE83894eCB2F0c67E3097Ea1
- See README.md for full list

## Key Patterns
- FHE: @fhenixprotocol/cofhe-contracts (euint128, ebool, FHE.gt/select/eq)
- ACL: FHE.allowThis, FHE.allow, FHE.allowPublic, FHE.allowTransient
- Dev: forge build --no-cache (cache gets stale after remapping changes)
- Solc: 0.8.34, evm:cancun, viaIR

## Auth
- Wallet-based JWT auth. Nonces stored in auth_nonces table (Supabase).
- JWT expires 15min, algorithms: ['HS256']

## Submission
- Akindo Wave Hacks Final Wave — June 1 15:15 UTC
- Tag: fheforge-v1.2-submission
