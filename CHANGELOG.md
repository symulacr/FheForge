# Changelog

All notable changes to FheForge are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] — 2026-05-25

### Akindo Buildathon Prep

- **README overhaul** — Added submission details table, demo script walkthrough, buildathon track badges, screenshot placeholders, video link placeholder
- **Root cleanup** — Moved 17 agent/AI-generated research/audit files from root to `docs/research/` (kept only `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md` at root)
- **Documentation** — Added Demo Script section for judge walkthrough, Submission Details table, Quick Start section at top of README

### Infrastructure

- Updated CI badge and added "Akindo Wave Hacks 2026" badge to README
- Removed duplicate setup instructions by consolidating into Quick Start

---

## [1.1.0] — 2026-05-23

### Security

- StrategyVault: added positionOwner mapping — closePosition() now validates caller is position owner (prevents collateral theft)
- PriceOracle: replaced broken address loop (uint160 0-255) with registeredTokens array iteration
- StrategyRegistry: fixed off-by-one boundary check (`>`→`>=`) on strategy validation
- LendingPool: added CannotSelfLiquidate guard to liquidateWithProof()

### Config/Deployment

- deploy.ts: added missing 5th SwapRouter argument (UNISWAP_V3_ROUTER)
- Consolidated duplicate interface files (contracts/interfaces/ → contracts/contracts/interfaces/)
- hardhat.config.ts: TESTER_PRIVATE_KEY → TESTER1_PRIVATE_KEY + TESTER2_PRIVATE_KEY
- Removed 15 stale deployment artifacts, consolidated to 421614.json + 84532.json
- Deleted conflicting .solhint.js — unified on .solhint.json

### Frontend

- Fixed 3 ABI mismatches: openPosition 6→5 args, borrowWithOracle 4→5 args, getPlain*→get* renames
- Added NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID placeholder
- ProtocolIcon: dynamic icon lookup via protocolName prop
- ConfigPanel: wrapped render-side-effect in proper useEffect
- Removed duplicate SWAP case in getAmountOut

### Code Quality

- Removed dead code: InterestIndex struct, RESERVE_FACTOR_BPS/YEAR constants, BalanceRevealed event, Position.debt field
- Fixed SameBlockClose: changed `>`→`>=` to allow same-block close
- Refactored TokenRegistry: unified 3 copy-pasted loops into _getTokensByFilter helper with TokenFilterType enum
- Added natspec to BPS_DEN/WAD constants across core contracts
- Added natspec to all public/external functions without documentation

### FHE Integration

- FheForgeTestHelper: replaced hardcoded slot copy (i &lt;= 11) with unconditional loop — critical slots were being missed due to sentinel slot 0 being zero
- LendingPool.t.sol: added 4 liquidateWithProof tests (successful, self-liq guard, insufficient collateral, oracle check) + fuzz test
- Created shared ACL helper (contracts/test/helpers/acl.ts) — extracts impersonation boilerplate, refactored StrategyVault.test.ts

### Scripts

- Fixed TESTER_PRIVATE_KEY → TESTER1_PRIVATE_KEY across test-stress.ts, post-deploy-test.js, reineira-demo.ts, FUNDING_INSTRUCTIONS.md
- Ported reineira-demo.ts from hardhat getSigners to standalone ethers Wallet

### Known Issues (unchanged)

- LOW: 2 solhint warnings (struct packing) — cosmetic
- INFO: Webpack build warnings (third-party dependencies)

### Deferred (unchanged)

- Encrypted state migration (`totalPlainBorrow`/`liquidReserve` → `euint128`)
- Interest accrual implementation
- SwapRouter executor trust redesign (requires ZK-proof or batch auction)
- Full FHE contract security audit
- Mainnet deployment preparation

## [1.0.0] — 2026-05-21

### Added

- **Smart Contracts** (Wave 10–14)
  - LendingPool: supply, borrow, repay, withdraw with encrypted amounts
  - SwapRouter: intent-based AMM with `euint128` amountIn/minOut
  - StrategyRegistry: register strategies, encrypted TVL tracking
  - PriceOracle: Pyth integration with price normalization
  - FheForgeComposer: strategy orchestration contract

- **FHE Security** (Wave 15–19)
  - FHESafeMath128: overflow-safe FHE math library
  - ZkVerifier integration for signed ciphertext validation
  - Cross-user isolation verified
  - Liquidation privacy — remaining balance uses stored encrypted handles
  - SameBlockClose fixed (allow same-block close)

- **Backend** (Wave 20–24)
  - NestJS REST API with 39 endpoints
  - AuthModule with JWT strategy and global JwtAuthGuard
  - `GET /defi-strategies/:id` route and service
  - `GET` routes for defi-token (list, by ID, by asset ID)
  - AI Strategy Builder with Google Gemini integration
  - Simulation engine with supply/borrow/swap simulators
  - Event indexer for on-chain event monitoring
  - Oracle health check in `/health` endpoint
  - APY env var fallbacks (`SUPPLY_APY_BPS`, `BORROW_APY_BPS`)
  - Swagger/OpenAPI documentation at `/api/docs`

- **Frontend** (Wave 25–29)
  - Next.js 14 + React 18 with App Router
  - wagmi v2 + viem wallet integration (MetaMask)
  - @cofhe/react SDK for FHE encrypt/decrypt
  - ReactFlow visual strategy builder (DeFi Builder)
  - AI prompt interface for natural language strategy generation
  - TanStack Query for server state
  - Zustand stores for builder state
  - Tailwind CSS + shadcn/ui component system

- **Infrastructure**
  - Docker Compose for local monitoring (Prometheus + Grafana)
  - GitHub Actions CI/CD pipeline
  - Railway deployment configuration
  - Sentry error tracking

- **Documentation**
  - README with plain-English pitch, Problem/Why FHE/RWA sections
  - Architecture diagram (mermaid)
  - CONTRIBUTING.md with setup, workflow, PR guidelines
  - SECURITY.md with disclosure policy
  - CHANGELOG.md (this file)
  - GitHub issue/PR templates
  - Demo video script
  - MIT License

### Known Issues

- LOW: 2 solhint warnings (struct packing) — cosmetic
- INFO: Webpack build warnings (third-party dependencies)

### Deferred

- Encrypted state migration (`totalPlainBorrow`/`liquidReserve` → `euint128`)
- Interest accrual implementation
- SwapRouter executor trust redesign (requires ZK-proof or batch auction)
- Full FHE contract security audit
- Mainnet deployment preparation

## [0.1.0] — 2026-05-12

### Added

- **Core Infrastructure** (Wave 1–4)
  - Project scaffolding with contracts/backend/frontend domains
  - Hardhat + Foundry development environment
  - NestJS backend with Supabase PostgreSQL
  - Next.js frontend with basic layout
  - Basic contract deployment scripts

- **Foundation Contracts** (Wave 5–9)
  - StrategyVault: position management with encrypted collateral
  - Basic LendingPool and SwapRouter interfaces
  - FHE data type integration (`euint128`)
  - Initial test suite (13 Foundry + 4 Hardhat tests)
  - Contract address management (`deployments/`)

---

[1.2.0]: https://github.com/symulacr/FheForge/releases/tag/v1.2.0
[1.1.0]: https://github.com/symulacr/FheForge/releases/tag/v1.1.0
[1.0.0]: https://github.com/symulacr/FheForge/releases/tag/v1.0.0
[0.1.0]: https://github.com/symulacr/FheForge/releases/tag/v0.1.0
