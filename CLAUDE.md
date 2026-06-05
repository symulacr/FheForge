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

## Deployed Contracts (Arb Sepolia) — redeployed 2026-06-05
- LendingPool: 0x2e04961e0d4448FeeeA5b23593eC81C1C9A2cD2a
- StrategyVault: 0xe9486B12261D02BeB236355934981d49c5697fb3
- SwapRouter: 0x5218486A8831b53b509CDF2390b3b6333B4d0bf7
- FheForgeComposer: 0xBcaEF72afA1f207F44C5aa11E48a7bea4b71632C
- StrategyExecutor: 0x157DE38216598dA56eEA78452329075cD511374B
- PriceOracle: 0x8E41d720173c347740C05011FadD3a3B015ae18c
- StrategyRegistry: 0xEbBD1aFDCC888116a4c3800ec856c8c3b1535374
- TokenRegistry: 0xA2E36B9953518d4Cd2E9c7e3b5345f8E8B8Bb19B
- ExecutorContract: 0x270F526b27cf7bf810a61e5f14f904C51CdC3deA
- FheForgeGovernor: 0x194a4C1B3BEb986f82f829f487dccd46a3c71F30
- FheForgeTimelock: 0x784376df1E39E91b3E65b1B8271B79ef5f36F890
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
