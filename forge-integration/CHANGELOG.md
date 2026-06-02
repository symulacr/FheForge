# Changelog

All notable changes to FheForge are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---


## [1.3.0] — 2026-06-02

### Forge Integration — Backend Manifest Verification

#### Corrections Applied
- Removed `FHE.allowTransient` from `lending-pool.fheMarkers.fheOperations` — not used in LendingPool.sol source
- Removed `FHE.allowTransient` from `lending-pool.fheMarkers.aclPatterns` — consistent with fheOperations removal

#### Additions
- Added `strategy-executor` (StrategyExecutor.sol) — pipeline executor for multi-step strategies with gas checkpointing and FHE handle validation
- Added `token-registry` (TokenRegistry.sol) — token configuration registry with LTV/cap/flag management
- Added `get-health` endpoint (GET /health) — network/chain health check with 30s cache
- Added `get-metrics` endpoint (GET /metrics) — Prometheus metrics via prom-client
- Added `update-activity-progress` endpoint (PUT /activities/progress/:id) — resume activity from failed step
- Added `update-defi-strategy-version` endpoint (PUT /defi-strategies/versions/:id) — update strategy version
- Added `delete-defi-strategy-version` endpoint (DELETE /defi-strategies/versions/:id) — delete strategy version
- Added `create-defi-module-action` endpoint (POST /defi-modules/actions) — create module action
- Added `create-defi-action-required` endpoint (POST /defi-modules/actions/required) — action workflow relationships
- Added `create-defi-pair` endpoint (POST /defi-modules/pairs) — link actions to tokens
- Added `update-strategy-execution` endpoint (PATCH /defi-strategy-executions/:id) — update execution records
- Added `create-execution-step-result` endpoint (POST /defi-execution-step-results) — execution step results

#### Artifacts Created
- `forge-integration/schemas/backend-manifest.schema.json` — JSON Schema draft-07 for backend-manifest validation
- `forge-integration/scripts/verify-backend.py` — Python verification script (validates contracts, endpoints, FHE markers, source file existence)

#### Metadata
- backend-manifest.json: 9 smart contracts (+2), 58 API endpoints (+10)

### Forge Integration — Forge Manifest Verification

#### Corrections Applied
- Fixed `builder-workspace.jsx` line count: `~2107 lines` → `2106 lines` (verified with `wc -l`)
- Fixed keyboard shortcut count in 3 locations: `36 shortcuts` → `28 shortcuts` (KeyboardCheatsheet displays 28, verified in builder-workspace.jsx)
- Fixed keyboard shortcut implementation identifier: `overlay-with-36-shortcuts` → `overlay-with-28-shortcuts`
- Removed `suggested` edge style from 3 descriptions — CSS class exists but JSX never applies it (dead code):
  - `$.builderFeatures.features[11].description`: removed `, suggested`
  - `$.files[8].sections[6].description` (Edge System): removed `, suggested (muted)`
  - `$.files[1].sections[5].description` (Builder Canvas CSS): removed `, suggested`
- Changed Spark component integration readiness: `needs-api` → `ready-to-wire` (pure SVG renderer, no API dependency)

#### Additions
- Added `values` to DemoCard `rows` mock data: `[["Supplied","42,084.13","USDC"],["Borrowed","18,910.00","ETH"],["In strategies","7,418.94","USDC"]]` — actual values from landing.jsx source
- Added `values` to top-level `wallet options` mock data array: MetaMask, Rabby, WalletConnect, Ledger entries with keys and descriptions
- Added `mockData` to connect-modal `StepWallet` section with wallet options field schemas, values, and `realSource: wagmi connectors`

#### Artifacts Created
- `forge-integration/schemas/forge-manifest.schema.json` — JSON Schema draft-07 for forge-manifest validation (covers files, sections, mock data arrays, builder features, tweaks panel)
- `forge-integration/scripts/verify-forge.sh` — Shell verification script (validates file existence, required fields, integration readiness labels, builder features completeness, mock data structure, JSON Schema conformance)

#### Metadata
- forge-manifest.json: 13 file entries, 55 builder features, 10 mock data arrays

### Forge Integration — Connections Verification

#### Corrections Applied
- Fixed `conn-auth-nonce` (`connections[24].backendRef`): `"get-auth-nonce"` → `["get-auth-nonce", "post-wallet-login"]` — the auth flow involves both fetching nonce and submitting signed message for JWT
- Fixed `conn-builder-save-draft` (`connections[27].backendRef`): `"create-defi-strategy"` → `["create-defi-strategy", "update-defi-strategy"]` — save draft supports both create and update operations
- Fixed `conn-builder-deploy` (`connections[17].backendRef`): `"composer"` → `["composer", "create-defi-strategy"]` — deploy flow includes saving the strategy before executing
- Fixed `walletContextMapping.contextSource`: updated initial ctx state description to match actual `ui/app.jsx` dynamic values from `TWEAK_DEFAULTS` and hardcoded mock address
- Fixed `walletContextMapping.fields[5].notes` (chainId): updated to note that chainId is not directly in ctx state but inferred from wagmi `useAccount()`

#### Additions
- Added 3 new `dependencyGraph.edges`:
  - `Builder Estimate DeFi` → `POST /defi-modules/pairs/estimate` (data edge)
  - `Builder DeFi Modules` → `GET /defi-modules` (data edge)
  - `Builder Save Draft` → `POST /defi-strategies, PUT /defi-strategies/:id` (data edge)

#### Artifacts Created
- `forge-integration/schemas/connections.schema.json` — JSON Schema draft-07 for connections validation (covers all top-level sections: connections array, walletContextMapping, connectModalSteps, gaps, dependencyGraph, loadingErrorEmptyMatrix)
- `forge-integration/scripts/verify-connections.sh` — Shell verification script (validates backendRef cross-references against backend-manifest, forgeFile references against forge-manifest, required fields, effort format, ID conventions)

#### Metadata
- connections.json: 31 connections, 7 wallet context fields, 4 modal steps, 12 gaps, 31 dependency edges

### Forge Integration — Architecture Documentation

#### Corrections Applied
- Fixed contract list in Overview: removed `Executor` (not a standalone contract; role within SwapRouter) and renamed `Registry` → `StrategyRegistry` (6 contracts total)
- Fixed `ProtocolStats` interface: replaced all fields with actual `StatsResponseDto` fields (`tvlUsd`, `totalUsers`, `activeMarkets`, `activeStrategies`, `encryptedOps`, `permitDecryptsDay`, `totalDeployments`, `poolTvls`)
- Fixed `MarketData` interface: replaced with actual `MarketResponseDto` fields (flattened asset string + assetAddress instead of AssetInfo object, supplyAPY/borrowAPY casing, types corrected)
- Fixed `ActivityItem` interface: replaced with actual `ActivityResponseDto` fields (no type/asset/amount fields; has userAddress, strategyId, metadata, step tracking)
- Fixed `GovernanceProposal` interface: replaced status enum, renamed fields (votesFor/votesAgainst), removed abstainVotes/quorum, added recentVotes/payload
- Fixed `VotePayload` interface: `support` changed to boolean, added `weight` field, removed `reason`
- Fixed `Strategy` interface: added `strategistName`, `strategistHandle?`, `tags?`, `assets?`, `agents?`, `chains?` fields with composite type note
- Fixed `StrategyStep` interface: replaced with actual `StrategyStepResponseDto` fields (step number, uppercase types, tokenIn/tokenOut pair, agent)
- Fixed `SimulationResult` interface: replaced with actual `SimulationResultDto` fields (snake_case fields, warnings, fhe_note)
- Fixed `BridgeWalletContext` interface: added note clarifying `chainId`, `isConnecting`, `networkMismatch` are bridge extensions not present in current forge ctx
- Fixed `ctx.chainId` row in Wallet Connection Path table: added bridge extension note
- Fixed architecture diagram backend surfaces: `Registry` → `StrategyRegistry`

#### Artifacts Created
- `forge-integration/scripts/check-forge-immutable.sh` — sha256sum verification for 13 forge files (exits 1 if any file modified)
- `forge-integration/scripts/check-all.sh` — master runner that executes all verification scripts and JSON Schema validations

## [1.2.1] — 2026-05-29

### Akindo Wave Hacks Final Wave Submission

#### Security (Critical)
- `_verifyEquality` now gates token transfers — reordered before `safeTransferFrom`/`safeTransfer` in all 6 LendingPool call sites
- `requestLiquidityCheck` now has `msg.sender == user` ACL check
- `getDepositedAmount` removed (plaintext privacy leak)
- `allowPublic` now has 1-hour cooldown on `requestBalanceReveal` / `requestBorrowReveal`
- `SwapRouter`: added `nonReentrant` to all 5 intent functions, fixed CEI violation in `executeIntent`
- `StrategyExecutor`: added `_verifyEquality` before all 6 forwarded action types
- `FheForgeBase`: added `_validateCiphertext` using `FHE.isInitialized` on all incoming handles
- `FHESafeMath128`: added overflow guard to `tryIncrease`

#### Deployment
- Re-deployed all 12 contracts to Arbitrum Sepolia (incl. governance: Token, Timelock, Governor)
- All contracts verified on Arbiscan
- Live forge-test.ts suite: 100+ scenarios against real deployed contracts

#### Infrastructure
- CORS hardens production — rejects Origin-less requests
- Auth nonce stored in Supabase `auth_nonces` table (replaces in-memory Map)
- JWT: algorithm restricted to `HS256`
- Event indexer: auto-clamp on gap > 128 blocks
- Swagger API docs at `/api/docs`
- CI pipeline: 4 stages, 14 jobs (lint → type-check → test → build)

#### Frontend
- Fresh `cofhe-client.ts` with `initCofheClient()`, `encryptUint128/64()`, `decryptForView/Tx()`
- Fixed Encryptable type mismatches (`uint128` vs `uint64` per contract ABI)
- Added `prepareLiquidationProof` (decryptForTx helper)
- Removed dead `NEXT_PUBLIC_ROUTER_ADDRESS` alias
- Added COOP/COEP headers for CoFHE Wasm SharedArrayBuffer
- Loading skeletons, error toasts for all async FHE operations

#### Documentation
- README: gas benchmarks, defense paragraphs, updated deployed contracts table
- Dual license: MIT + Apache 2.0
- Demo script at `docs/fheforge-demo-script.md`
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
