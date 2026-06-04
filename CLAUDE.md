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
- LendingPool: 0xff687831dfD3657D6C6879403cE56f53518b378C
- StrategyVault: 0xfCb89417e0a21813c84647614764e920bBdFEb94
- SwapRouter: 0x9C9bEb3d95184BbA11AfE1D973927562C8eb0409
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
