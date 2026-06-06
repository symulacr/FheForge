# FheForge — Agent Context

## Design Context

FheForge UI uses a committed design system. Before building or modifying any frontend surface, read:

- **PRODUCT.md** (root) — Register: `product`. Users: crypto-native DeFi power users on Arbitrum Sepolia. 5 principles: show the ciphertext, terminal-native density, earned precision, no false warmth, trust through exposure.
- **DESIGN.md** (root) — Visual system: dark terminal (#0a0a0a bg), JetBrains Mono globally, `border-radius: 0 !important` (hard constraint), single blue accent (#3b82f6) restrained strategy, semantic state colors (success #22c55e / warning #eab308 / destructive #ef4444).

### Key constraints for agents

- Zero border-radius is non-negotiable. No exceptions except badge pill shape.
- JetBrains Mono is the only typeface. No font-family switching.
- Accent (#3b82f6) for primary actions and active state only — not decoration.
- No gradient text, no glassmorphism, no ghost-card (border + large box-shadow together).
- Motion: Framer Motion at 150–250ms ease-out. Every animation has a `prefers-reduced-motion` fallback.
- Copy: no marketing buzzwords, no em dashes, no aphoristic cadence. Verb + object button labels.
- Run `/impeccable` commands for any design work. Context is pre-loaded from PRODUCT.md + DESIGN.md.

## Project Context

### Project
FHE-encrypted DeFi protocol on Arbitrum Sepolia. Supply, borrow, swap, liquidate — every amount stays encrypted on-chain. Built with @cofhe/sdk and Fhenix CoFHE.

### Quick Start
```bash
forge build --no-cache
forge test -vvv --no-cache
npx hardhat test
DEMO_MODE=1 npx hardhat run scripts/forge-deploy.ts --network arb-sepolia
cd ui && bun run dev
cd backend/apps && bun run start:dev
```

### Repo Structure
- `contracts/contracts/` — Solidity contracts (LendingPool, StrategyVault, Composer, SwapRouter, PriceOracle, Registry, Executor)
- `contracts/test-foundry/` — Foundry tests (fuzz + unit + invariant)
- `contracts/scripts/` — forge-deploy.ts, forge-test.ts, gas-benchmarks.ts
- `ui/` — Next.js 14 app with @cofhe/react, wagmi v2, viem
- `backend/apps/` — NestJS 11 API with Supabase, Gemini AI, event indexer
- `docs/` — ADRs, security audits, execution plan

### Deployed Contracts (Arb Sepolia) — redeployed 2026-06-05
- LendingPool: 0x4ed64f1708139E31C4c48A19f285AD50dC68EB35
- StrategyVault: 0xd3d24E7b57f1d7AceBD1e11e415EB7E7c6c60267
- SwapRouter: 0xA732e548387c0842907056DE93C51Ca1E41B9b61
- FheForgeComposer: 0x6c051217CA014371D839739D62cBE06948B87372
- StrategyExecutor: 0x7351FB98F156367C68F8e337890865FBfF13F656
- PriceOracle: 0xB7E11a3B46406218C221CA0A86e58a84C38C2988
- StrategyRegistry: 0xc93F8ff84C9444E0AFCB8c7bBe043404273d7E21
- TokenRegistry: 0x5Bf5aBB0517502C91099477C306a649fda78B370
- ExecutorContract: 0x70349b1148f756c8D7b1D62d9F517Bd86F5ca12c
- FheForgeGovernor: 0xc3e87062b39f8f24311cE3e83eEE46FF9750d8E5
- FheForgeTimelock: 0x39Feea3d1882c7F767a89d41F7Df077BD00B7f74
- See README.md for full list

### Key Patterns
- FHE: @fhenixprotocol/cofhe-contracts (euint128, ebool, FHE.gt/select/eq)
- ACL: FHE.allowThis, FHE.allow, FHE.allowPublic, FHE.allowTransient
- Dev: forge build --no-cache (cache gets stale after remapping changes)
- Solc: 0.8.34, evm:cancun, viaIR

### Auth
- Wallet-based JWT auth. Nonces stored in auth_nonces table (Supabase).
- JWT expires 15min, algorithms: ['HS256']

### Submission
- Akindo Wave Hacks Final Wave — June 1 15:15 UTC
- Tag: fheforge-v1.2-submission
