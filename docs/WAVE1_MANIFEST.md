# WAVE1_MANIFEST.md — FHEForge Full-Stack Audit & Remediation

## Manifest Info

| Field | Value |
|---|---|
| **Date** | 2026-05-18 |
| **Auditor** | Sisyphus (Orchestrated Multi-Agent Audit) |
| **Scope** | Full-stack audit of FheForge dApp — contracts, frontend, backend, infra, integration, docs |
| **Wave** | 1 of 2 planned waves |

## Priority Legend

| Priority | Meaning |
|---|---|
| **P0** | Critical — blocks deployment or causes data loss / security breach |
| **P1** | High — breaks core functionality, major user-facing impact |
| **P2** | Medium — degrades UX, non-critical feature broken, tech debt |
| **P3** | Low — cosmetic, nice-to-have, minor improvements |

## Executive Summary

FheForge is a production-quality FHE DeFi dApp (98 commits, deployed to Arbitrum Sepolia Wave30) with strong technical foundations but critical deployment configuration bugs, security gaps, and a weak submission presentation. The audit covered ~36K LOC across 6 domains via 12 background agents, with all findings cross-verified against source truth.

**Most critical findings:** 4 conflicting address sets mean the app talks to wrong/nonexistent contracts (UI on Wave17, backend on Wave5-6); a deployer private key is committed in git; all 39 backend API endpoints are public (auth exists but never applied); zero Grafana dashboards exist despite docs referencing them; and 11/14 alert rules reference metrics that don't exist. On the buildathon front, the README opens with FHE jargon instead of a plain-English pitch, zero screenshots or demo video exist, and 18 research/audit files clutter the root directory.

**Total: 65 microchanges** (27 P0, 19 P1, 13 P2, 5 P3) across all domains. Estimated ~40 hours of implementation work for Wave 1, with Wave 2 covering deferred items.

---

## Audit Results By Domain

### 1. Smart Contracts (agent-1)

**Referenced file:** agent-1-smart-contracts.md

#### P0 Findings

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| SC-P0-1 | Dual plain+encrypted state — `totalPlainBorrow` + `liquidReserve` observable on-chain, defeating FHE confidentiality | P0 | `LendingPool.sol:19-20` | Migrate to encrypted `euint128` state; replace plain-text `require()` gates with FHE-select soft-caps |

#### P1 Findings

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| SC-P1-1 | No `publishDecryptResult` flow — contracts call `FHE.allowPublic` but have no `publishDecryptResult` counterpart for on-chain settlement | P1 | `LendingPool.sol`, `StrategyVault.sol`, `StrategyRegistry.sol` | Add `revealBalance()`, `revealBorrow()`, `revealCollateral()`, `requestTvlReveal()` functions |
| SC-P1-2 | Trivial encryption from plain values in liquidation — `FHE.asEuint128(debtToCover)` with public plaintext | P1 | `LendingPool.sol:556,572` | Document as intentional (liquidation amounts are public by design); no code change |
| SC-P1-3 | Execution-path info leakage via `require()` on encrypted conditions — `_requireOracleHealthy` reverts, leaking health status | P1 | `LendingPool.sol:431-443,546` | Replace revert with FHE.select to cap borrow amounts silently |
| SC-P1-4 | Composer cross-contract ACL on encrypted results — `allowTransient` may be insufficient for persistent cross-tx access | P1 | `FheForgeComposer.sol:113-223` | Add `FHE.allow()` for persistent cross-tx access if needed; verify `allowTransient` sufficiency |

#### P2 Findings

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| SC-P2-1 | `SameBlockClose` plain-text require — leaks timing info via revert | P2 | `StrategyVault.sol:138` | Remove check entirely (Option A) or replace with FHE-select (Option B) |
| SC-P2-2 | No interest accrual — `InterestIndex` struct exists but `indices` mapping never updated | P2 | `LendingPool.sol:25-30` | Add `_accrueInterest()` internal function; call before every state mutation; add public `accrue()` |
| SC-P2-3 | `StrategyRegistry.getEncryptedTvl` — `decryptForView` fails with "Forbidden" | P2 | `StrategyRegistry.sol:181-186` | Replace with explicit permit flow: `requestTvlPermit()` with signed permit for off-chain decrypt |
| SC-P2-4 | Composer Permit2 flow — UX friction; `permit` still referenced in comments | P2 | `FheForgeComposer.sol:242-248` | Add EIP-2612 `permit` support as alternative path |

#### P3 Findings

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| SC-P3-1 | Literal `10000` instead of `BPS_DEN` constant (4 instances) | P3 | `LendingPool.sol:616,628`, `PriceOracle.sol:145-146` | Replace with `BPS_DEN` constant |
| SC-P3-2 | Literal `18` instead of `WAD_DECIMALS` constant (3 instances) | P3 | `PriceOracle.sol:204,224,235` | Define and use `WAD_DECIMALS` constant |
| SC-P3-3 | Redundant no-op statements in `FheForgeComposer` (already removed in current code) | P3 | `FheForgeComposer.sol` | Already resolved — no action needed |
| SC-P3-4 | Centralization risk — 20 `onlyOwner`/`onlyVault` admin functions (acknowledged design intent) | P3 | All contracts | Document as known in README; no code change |
| SC-P3-5 | `_onlyVault` modifier never used standalone (always combined with `nonReentrant`) | P3 | `StrategyRegistry.sol:58-60` | Document; no code change needed |

#### Key Observations

- Sisyphus verification found all 4 "critical FHE findings" from the agent report were **false positives** — the codebase already has mitigations (`FHESafeMath128` guards, zero `FHE.decrypt`, homomorphic LTV checks via `FHE.lte`/`FHE.mul`). The micro-change plan is nonetheless preserved as a reference for future security reviews.
- Event emission audit: position amounts are correctly stripped from `PositionClosed`, `Supplied`, `Borrowed`, `Repaid`, `Withdrawn` events. `Liquidated` and `PausedWithdrawn` intentionally retain amounts (public by design).
- Migration sequence recommended: P3 constants first → P2-1 SameBlockClose → P2-2 interest accrual → P1-1 reveal functions → P0-1 encrypted state migration (largest change, last).

---

### 2. Frontend / UI-UX (agent-2)

**Referenced file:** agent-2-frontend.md

#### P0 Findings (All need fix)

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| FE-P0-1 | ConfigPanel render-side-effect causes infinite re-render loop — state setters called in render body | P0 | `ui/app/builder/components/ConfigPanel.tsx:219-299` | Wrap initialization block in `useEffect` with proper dependency array |
| FE-P0-2 | `ProtocolIcon` hardcodes `weth.svg`, takes no props — always shows WETH regardless of protocol | P0 | `ui/app/builder/components/nodes/protocol-icon.tsx` | Accept `symbol` prop; look up icon from `agentIcons` map |
| FE-P0-3 | Duplicate `case "SWAP"` in `getAmountOut()` — second case unreachable dead code | P0 | `ui/app/builder/components/ConfigPanel.tsx:422-458` | Merge both cases; keep `shares_out` fallback from second case |
| FE-P0-4 | `StrategyPromptDetails` is "Coming Soon" stub — never implemented | P0 | `ui/app/strategy/[id]/components/strategy-prompt-details.tsx` | Implement with prompt data from `DefiStrategy`; pass `strategy` prop |
| FE-P0-5 | `useRebalance` exists but has zero consumers — 97-line fully implemented hook, never called | P0 | `ui/hooks/use-rebalance.ts` | Either wire into strategy detail page (Option A) or delete (Option B) |

#### P1 Findings (All already fixed)

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| FE-P1-1 | MC-07/08: onlyComposer-gated direct calls removed | P1 | ✅ Already fixed |
| FE-P1-2 | MC-09: `strategyId` parameter added to `openPosition` | P1 | ✅ Already fixed |
| FE-P1-3 | MC-10/11: Permit2 address + indentation | P1 | ✅ No-op (Permit2 excluded from V2 scope) |
| FE-P1-4 | MC-12/13/14: Return object, addCollateral, PoolABI import | P1 | ✅ Already fixed |
| FE-P1-5 | MC-18/19: strategy-builder `openPosition` + `addCollateral` | P1 | ✅ Already fixed |
| FE-P1-6 | MC-20/21/22: `supplyEth`/`withdrawEth` correct target | P1 | ✅ Already fixed |
| FE-P1-7 | MC-24/25/26: Portfolio balance reads | P1 | ✅ Already fixed |
| FE-P1-8 | MC-27/28: Encryption type — uint128 | P1 | ✅ Already fixed |

#### P2 Findings

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| FE-P2-1 | MC-30/31: Missing Base Sepolia env vars in `.env.local` | P2 | 🟡 Needs fix — add `NEXT_PUBLIC_BASE_*` vars |
| FE-P2-2 | MC-33: Wire `useRebalance` into strategy detail page | P2 | 🟡 Needs fix — implement StrategyRebalance component |
| FE-P2-3 | MC-34: encrypt helper in use-rebalance | P2 | ✅ Already fixed |
| FE-P2-4 | MC-35: `registerStrategy` in use-strategy-registry | P2 | ✅ Already fixed |
| FE-P2-5 | MC-36/37/38: Liquidation/borrow UI hooks | P2 | ✅ Already fixed |
| FE-P2-6 | MC-41/42: permit2 hooks not wired (deferred — out of scope) | P2 | 🟢 No-op |
| FE-P2-7 | MC-45: `isSupported` chain check | P2 | ✅ Already fixed |
| FE-P2-8 | MC-46: `convertToUsd` helpers | P2 | ✅ Already fixed |
| FE-P2-9 | MC-47/48/49: Registry reads | P2 | ✅ Already fixed |
| FE-P2-10 | MC-50: `validateEnvVars` missing ORACLE | P2 | ✅ Already fixed |
| FE-P2-11 | MC-63: Stale TODO comments | P2 | ✅ Already fixed |

#### Key Observations

- 8 Wave 10 microchanges were already applied — the codebase is in a transitional state where substantial remediation is partially done.
- The 5 P0 runtime bugs are the most impactful frontend changes — all are single-file fixes with clear remediations.
- No frontend tests exist beyond a single spec file; test coverage is a Wave 2 concern.

---

### 3. Backend / API / Database (agent-3)

**Referenced file:** agent-3-backend.md

#### P0 Findings

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| BE-P0-1 | Auth not applied globally or per-controller — all 39 endpoints public | P0 | `backend/apps/src/app.module.ts` | Register `JwtAuthGuard` via `APP_GUARD`; add `@Public()` decorator for public routes |
| BE-P0-2 | RewardsService throws generic `Error` instead of `HttpException` — returns 500 instead of 501 | P0 | `rewards.service.ts` | Replace `Error` with `NotImplementedException` |
| BE-P0-3 | Missing `GET /defi-strategies/:id` — has PUT/DELETE by id but no GET | P0 | `defi_strategies.controller.ts`, `defi_strategies.service.ts` | Add `@Get(':id')` route + `getById()` service method |
| BE-P0-4 | Missing GET endpoints for defi-token — only has `@Post()`, 3 service methods lack HTTP routes | P0 | `defi_token.controller.ts` | Add `@Get()`, `@Get(':id')`, `@Get('asset/:assetId')` |
| BE-P0-5 | `defi_action_required` table missing from `schema.sql` — referenced in 5 files, zero DDL exists | P0 | `schema.sql` | Add `CREATE TABLE` migration (`002_defi_action_required.sql`) |
| BE-P0-6 | Simulation endpoint unhooked — `DefiSimulationEngine.simulate()` has no HTTP route | P0 | `defi_strategies.controller.ts`, new DTO | Add `POST /defi-strategies/simulate` route |
| BE-P0-7 | `checkEvmBinding()` hardcoded to return `isBound: true` — provides false security | P0 | `user.service.ts:48-53` | Implement real EVM binding check via Supabase or on-chain registry |

#### P1 Findings

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| BE-P1-1 | Railway Supabase env vars missing from `.env.production.example` and `.env.development.example` | P1 | `.env.production.example`, `.env.development.example` | Document Railway Supabase plugin env vars |
| BE-P1-2 | Static exchange rate fallback should read on-chain from PriceOracle; add oracle health to `/health` | P1 | `fhenix-strategy.service.ts`, `app.controller.ts` | Add `isOracleHealthy()` method; report oracle status in health endpoint |
| BE-P1-3 | ethers v5 subpath imports in v6 project — `ethers/providers`, `ethers/utils`, `ethers/abi` cause silent runtime failures | P1 | 3 files: `fhenix-strategy.service.ts`, `event-indexer.service.ts`, `gas-estimation.service.ts` | Fix imports to v6 syntax: `import { ... } from 'ethers'` |
| BE-P1-4 | Event indexer wiring gaps — `COFHE_RPC` vs `FHENIX_RPC` mismatch; env var names across configs disagree | P1 | `.env.development`, `event-indexer.service.ts` | Align env var names in all config files |
| BE-P1-5 | Static APY fallback in simulators — hardcoded 5.0%/6.0% instead of configurable env fallback | P1 | `supply-simulator.ts`, `borrow-simulator.ts` | Use configurable `SUPPLY_APY_BPS`/`BORROW_APY_BPS` env fallbacks |

#### P2 Findings

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| BE-P2-1 | Migration infrastructure issues — no tracking table, unsafe `exec_sql` RPC, schema out of sync with code | P2 | `migrations/`, `schema.sql` | Add `_migrations` tracking table; fix migration runner; sync schema |

#### Key Observations

- **Discovered During Audit:** The ethers v5/v6 subpath import bug was found during verification — 3 files importing from `ethers/providers`, `ethers/utils`, `ethers/abi` which silently fail in v6. The existing code only works because these modules may cache from other dependencies.
- **Discovered During Audit:** The event indexer env var mismatch (`COFHE_RPC` vs `FHENIX_RPC`) means the indexer connects to the wrong RPC endpoint in production.
- The auth gap (BE-P0-1) is the single highest-severity backend finding — all 39 endpoints are currently public.

---

### 4. Infrastructure / DevOps (agent-4)

**Referenced file:** agent-4-deploy-infra.md

#### P0 — Security

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| INFRA-P0-1 | Leaked private key committed in `backend/apps/.env.development` — real deployer key `0xf0c35...` in git | P0-SEC | `backend/apps/.env.development` | Remove key from file; purge from git history |
| INFRA-P0-2 | `.env.development` tracked in git despite `.gitignore` — must remove from index | P0-SEC | `.gitignore`, `backend/apps/.env.development` | `git rm --cached` the file; verify gitignore prevents re-addition |
| INFRA-P0-3 | All 5 private keys in `contracts/.env` are identical — tests run as deployer, defeating isolation | P0-SEC | `contracts/.env` | Generate unique keys for TESTER1-3 via `cast wallet new`; fund separately |

#### P0 — Broken

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| INFRA-P0-4 | UI contract addresses from Wave17 — Wave30 is live, app talks to wrong contracts | P0-BROKEN | `ui/.env.local` | Replace all 6 addresses with verified Wave30 values (from `deployments/421614.json`) |
| INFRA-P0-5 | Backend contract addresses from Wave5-6 — even older than UI, can't interact with current contracts | P0-BROKEN | `backend/apps/.env.development` | Replace all 4 addresses with verified Wave30 values |
| INFRA-P0-6 | WETH/USDC token addresses differ across 3 config layers — 3 different WETH addresses exist | P0-BROKEN | `ui/.env.local`, `backend/apps/.env.development`, `contracts/.env` | Reconcile to deployments ground truth |

#### P0 — Monitoring

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| INFRA-P0-7 | Monitoring stack is Docker-local only — not on Railway; no production observability | P0-MON | `monitoring/docker-compose.yml`, `railway.json` | Deploy Prometheus/Grafana as Railway services within the project |
| INFRA-P0-8 | Grafana dashboard provisioning directory doesn't exist — `monitoring/grafana/dashboards/` missing entirely | P0-MON | `monitoring/grafana/` | Create provisioning structure with 4 dashboard JSONs + datasource YAML |
| INFRA-P0-9 | 11 of 14 alert rules reference non-existent metrics — `http_requests_total`, `database_query_*`, `contract_interaction_*` never emitted | P0-MON | `monitoring/alerts/alerts.yml` | Remove 11 broken rules; keep 3 system alerts (CPU/memory/disk) |
| INFRA-P0-10 | Zero Sentry dependencies despite docs referencing error tracking — `@sentry/*` not installed anywhere | P0-MON | `backend/apps/package.json`, `ui/package.json` | Install `@sentry/node` + `@sentry/profiling-node`; initialize in `main.ts` |

#### P1 Findings

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| INFRA-P1-1 | Rotate leaked deployer key on-chain — transfer ownership away from compromised key | P1 | (on-chain) | Generate new key; transfer ownership; verify old key no longer has roles |
| INFRA-P1-2 | No Base Sepolia deployment artifact exists — config mentions it but `deployments/84532.json` absent | P1 | `contracts/deployments/84532.json` | Create not-deployed stub; clear placeholder addresses in UI `.env.local` |

#### P2 Findings

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| INFRA-P2-1 | No `/metrics` endpoint on backend — prerequisite for all Prometheus alert rules | P2 | `backend/apps/src/app.controller.ts`, `package.json` | Add `MetricsController` with `prom-client`; expose counters + histograms |
| INFRA-P2-2 | Alert rules need restoration after `/metrics` exists — 4 API rules can be re-added with corrected expressions | P2 | `monitoring/alerts/alerts.yml` | Restore 4 API rules (HighErrorRate, SlowAPIResponse, APIDown, NewUserSignup) |
| INFRA-P2-3 | Railway `railway.json` missing health check path — platform doesn't know when app is truly unhealthy | P2 | `backend/apps/railway.json` | Add `healthcheckPath: "/health"` and `healthcheckTimeout: 30` |

#### Key Observations

- The **address reconciliation problem** is the most critical infrastructure issue — 4 different address sets exist across config files, with the README and `deployments/421614.json` both claiming Wave30 but listing different addresses. On-chain verification (`cast code`) is required before applying any address updates.
- The decision tree for address resolution is: verify `deployments/421614.json` addresses on-chain first; if dead, try README addresses; if both dead, re-deploy.
- Environment variable naming is inconsistent across all configs — some use `VAULT_ADDRESS`, some use `STRATEGY_VAULT_ADDRESS`, some use `NEXT_PUBLIC_VAULT_ADDRESS`.

---

### 5. Integration / E2E Testing (agent-5)

**Referenced file:** agent-5-tests-ci.md

#### P0 Findings

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| TEST-P0-1 | LendingPool (658 lines) has zero test coverage — largest contract, core FHE DeFi primitives untested | P0 | `contracts/test-foundry/LendingPool.t.sol` (new) | Write 8 Foundry test scenarios for plain-logic operations |
| TEST-P0-2 | LendingPool FHE integration missing — `shield`, `borrowWithLtvCheck`, `repayDebt` with FHE need Hardhat test | P0 | `contracts/test/LendingPool.test.ts` (new) | Write 4 Hardhat test scenarios covering P-CRIT remediations |
| TEST-P0-3 | No FHE privacy attack vector tests — 4 P-CRIT findings need adversarial scenario verification | P0 | `contracts/test/FhePrivacyAttacks.test.ts` (new) | Write 4 adversarial test scenarios |
| TEST-P0-4 | PriceOracle (290 lines) has zero tests — Pyth price normalization, staleness, fallback logic untested | P0 | `contracts/test/PriceOracle.test.ts` (new) | Write 6 test scenarios (deployment, oracle setup, staleness, normalization, fallback, conversion) |

#### P1 Findings

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| TEST-P1-1 | StrategyRegistry has zero test coverage — registration, TVL tracking, vault rotation untested | P1 | `contracts/test/StrategyRegistry.test.ts` (new) | Write 7 test scenarios for full strategy lifecycle |
| TEST-P1-2 | FheForgeComposer (249 lines) deployed and verified but never tested — multi-step orchestration untested | P1 | `contracts/test/FheForgeComposer.test.ts` (new) | Write 6 test scenarios for composer orchestration |
| TEST-P1-3 | PriceOracle Pyth math untested — `_normalizePythPrice` is pure math testable in Foundry | P1 | `contracts/test-foundry/PriceOracleMath.t.sol` (new) | Write 6 Foundry test scenarios for math functions |
| TEST-P1-4 | POSTFIX probe automation — 25 probes exist, all PASS, but never run in CI | P1 | `.github/workflows/ci.yml` | Add `deployed-integration` job (manual/scheduled trigger) |
| TEST-P1-5 | Aderyn Low finding: `10 ** dec` exponent literals (4 instances) — document as intentional | P1 | `PriceOracle.sol`, `aderyn.toml` | Document in `aderyn.toml` as acceptable style residual |

#### P2 Findings

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| TEST-P2-1 | Missing test jobs in CI — backend `npm test`, frontend `bun run test`, forge coverage enforcement not run | P2 | `.github/workflows/ci.yml` | Add test steps + `forge coverage --min-coverage 50` |
| TEST-P2-2 | CI lint/test/build not split — full build required before any feedback | P2 | `.github/workflows/ci.yml` | Split into lint → type-check → test → build stages |
| TEST-P2-3 | C5 (SwapRouter executor trust) deferred security not documented in test coverage notes | P2 | `contracts/TEST_README.md` (new) | Create test README documenting C5 deferral |

#### Key Observations

- Current test counts: 4 Hardhat + 8 Foundry (+ 25 POSTFIX probes) = 12 unit tests + 25 probes.
- 4 of 5 deployed production contracts have zero test coverage (LendingPool, StrategyRegistry, PriceOracle, FheForgeComposer).
- FHE operations require CoFHE mock environment — Foundry cannot test FHE operations directly. Strategy: Foundry for plain Solidity logic tests; Hardhat with `hre.cofhe.mocks.deployMocks()` for FHE integration tests.

---

### 6. Developer Relations / Documentation (agent-6)

**Referenced file:** agent-6-documentation.md

#### P0 Findings

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| DOC-P0-1 | README opens with FHE jargon (`euint128`, `sealOutput`) — no plain-English pitch | P0 | `README.md:1-3` | Rewrite with elevator pitch mentioning Buildathon, FHE value prop in plain language |
| DOC-P0-2 | No "Problem" or "Why FHE" sections — judges can't understand why encrypted compute matters | P0 | `README.md` | Add two new sections explaining market gap and FHE vs ZK/MPC/TEE differentiation |
| DOC-P0-3 | No architecture diagram in README — good one exists in `conductor/` but hidden from judges | P0 | `README.md` | Add mermaid `graph TB` diagram showing full stack |
| DOC-P0-4 | Zero screenshots in README — judges can't see the working UI | P0 | `README.md` | Capture and add 4 screenshots: Dashboard, DeFi Builder, AI Prompt, Portfolio |
| DOC-P0-5 | No demo video — leaving points on the table for buildathon judging | P0 | `docs/demo-video-script.md` (new) | Create 3-min walkthrough script; record and upload (unlisted YouTube/Loom) |
| DOC-P0-6 | 18 research/audit/plan files (7,352 lines) cluttering root directory — looks unprofessional | P0 | Root directory | Move all non-essential files to `docs/research/` |
| DOC-P0-7 | No LICENSE file — project un-usable by others, looks incomplete | P0 | `LICENSE` (new) | Add MIT License |
| DOC-P0-8 | No git tags — judges can't see milestones; 30 waves of dev with zero version markers | P0 | (git operation) | Create `v1.0.0` tag + GitHub Release |

#### P1 Findings

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| DOC-P1-1 | No CHANGELOG.md — judges can't trace Wave-over-Wave improvement (judging criterion #5) | P1 | `CHANGELOG.md` (new) | Create changelog documenting all 30 waves |
| DOC-P1-2 | Zero mention of RWA in README — project competes in Track 1 (RWA & Compliance) but never says "RWA" | P1 | `README.md` | Add "Tokenized RWA" use case section |
| DOC-P1-3 | No CONTRIBUTING.md — signals project isn't ready for collaboration | P1 | `CONTRIBUTING.md` (new) | Create contribution guidelines |
| DOC-P1-4 | No SECURITY.md — security researchers have no disclosure channel | P1 | `SECURITY.md` (new) | Create security policy with reporting process |

#### P2 Findings

| # | Finding | Severity | File | Remediation |
|---|---------|----------|------|-------------|
| DOC-P2-1 | No tech stack badge row — communicates stack at a glance, signals professionalism | P2 | `README.md` | Add `<p align="center">` badge row near top |
| DOC-P2-2 | Zero GitHub stars — repo looks abandoned | P2 | (GitHub action) | Team members star the repo; aim for 3-5 stars before submission |

#### Key Observations

- Estimated score impact: ~6.0/10 → ~8.4/10 after implementing all 14 documentation microchanges.
- The 8 P0 items are time-boxed at ~1.5 hours total — highest ROI of any domain.
- No demo video exists — this is a common blind spot for dev-heavy teams. A 3-minute walkthrough is the single highest-judge-impact item.
- The research file cleanup (DOC-P0-6) should include all Sisyphus agent output files and research artifacts to avoid cluttering the root.

---

## Priority-Sorted Summary Table

| Priority | Domain | # | Finding Summary |
|----------|--------|---|-----------------|
| P0 | Smart Contracts | 1 | Dual plain+encrypted state — `totalPlainBorrow`/`liquidReserve` observable on-chain |
| P0 | Frontend | 1 | ConfigPanel render-side-effect causing infinite re-render loop |
| P0 | Frontend | 2 | ProtocolIcon hardcodes weth.svg, takes no props |
| P0 | Frontend | 3 | Duplicate SWAP case in getAmountOut (dead code) |
| P0 | Frontend | 4 | StrategyPromptDetails is "Coming Soon" stub |
| P0 | Frontend | 5 | useRebalance exists but has zero consumers |
| P0 | Backend/API/DB | 1 | Auth not applied globally — all 39 endpoints public |
| P0 | Backend/API/DB | 2 | RewardsService throws generic Error instead of HttpException |
| P0 | Backend/API/DB | 3 | Missing GET /defi-strategies/:id |
| P0 | Backend/API/DB | 4 | Missing GET endpoints for defi-token |
| P0 | Backend/API/DB | 5 | defi_action_required table missing from schema.sql |
| P0 | Backend/API/DB | 6 | Simulation endpoint unhooked — no HTTP route |
| P0 | Backend/API/DB | 7 | checkEvmBinding() hardcoded to return isBound: true |
| P0 | Infrastructure/DevOps | 1 | Leaked private key committed in backend `.env.development` |
| P0 | Infrastructure/DevOps | 2 | .env.development tracked in git despite .gitignore |
| P0 | Infrastructure/DevOps | 3 | All 5 private keys in contracts/.env are identical |
| P0 | Infrastructure/DevOps | 4 | UI contract addresses from Wave17 (Wave30 is live) |
| P0 | Infrastructure/DevOps | 5 | Backend contract addresses from Wave5-6 |
| P0 | Infrastructure/DevOps | 6 | WETH/USDC token addresses differ across 3 config layers |
| P0 | Infrastructure/DevOps | 7 | Monitoring stack is Docker-local only, not on Railway |
| P0 | Infrastructure/DevOps | 8 | Grafana dashboard provisioning directory doesn't exist |
| P0 | Infrastructure/DevOps | 9 | 11 of 14 alert rules reference non-existent metrics |
| P0 | Infrastructure/DevOps | 10 | Zero Sentry dependencies despite docs referencing error tracking |
| P0 | Integration/E2E Tests | 1 | LendingPool (658 lines) has zero test coverage |
| P0 | Integration/E2E Tests | 2 | LendingPool FHE integration missing |
| P0 | Integration/E2E Tests | 3 | No FHE privacy attack vector tests |
| P0 | Integration/E2E Tests | 4 | PriceOracle (290 lines) has zero tests |
| P0 | DevRel/Documentation | 1 | README opens with FHE jargon — no plain-English pitch |
| P0 | DevRel/Documentation | 2 | No "Problem" or "Why FHE" sections |
| P0 | DevRel/Documentation | 3 | No architecture diagram in README |
| P0 | DevRel/Documentation | 4 | Zero screenshots in README |
| P0 | DevRel/Documentation | 5 | No demo video |
| P0 | DevRel/Documentation | 6 | 18 research/audit files cluttering root directory |
| P0 | DevRel/Documentation | 7 | No LICENSE file |
| P0 | DevRel/Documentation | 8 | No git tags |
| P1 | Smart Contracts | 1 | No publishDecryptResult flow for on-chain settlement |
| P1 | Smart Contracts | 2 | Trivial encryption from plain values in liquidation |
| P1 | Smart Contracts | 3 | Execution-path info leakage via require() |
| P1 | Smart Contracts | 4 | Composer cross-contract ACL on encrypted results |
| P1 | Backend/API/DB | 1 | Railway Supabase env vars missing from example configs |
| P1 | Backend/API/DB | 2 | Static exchange rate fallback should read on-chain |
| P1 | Backend/API/DB | 3 | ethers v5 subpath imports in v6 project (3 files) |
| P1 | Backend/API/DB | 4 | Event indexer: COFHE_RPC vs FHENIX_RPC env var mismatch |
| P1 | Backend/API/DB | 5 | Static APY fallback in simulators |
| P1 | Infrastructure/DevOps | 1 | Rotate leaked deployer key on-chain |
| P1 | Infrastructure/DevOps | 2 | No Base Sepolia deployment artifact exists |
| P1 | Integration/E2E Tests | 1 | StrategyRegistry has zero test coverage |
| P1 | Integration/E2E Tests | 2 | FheForgeComposer deployed but never tested |
| P1 | Integration/E2E Tests | 3 | PriceOracle Pyth math untested |
| P1 | Integration/E2E Tests | 4 | POSTFIX probe automation missing from CI |
| P1 | Integration/E2E Tests | 5 | Aderyn Low: `10 ** dec` exponent literals |
| P1 | DevRel/Documentation | 1 | No CHANGELOG.md |
| P1 | DevRel/Documentation | 2 | Zero mention of RWA in README |
| P1 | DevRel/Documentation | 3 | No CONTRIBUTING.md |
| P1 | DevRel/Documentation | 4 | No SECURITY.md |
| P2 | Smart Contracts | 1 | SameBlockClose plain-text require |
| P2 | Smart Contracts | 2 | No interest accrual (InterestIndex defined but never updated) |
| P2 | Smart Contracts | 3 | StrategyRegistry getEncryptedTvl decryptForView fails |
| P2 | Smart Contracts | 4 | Composer Permit2 flow UX friction |
| P2 | Frontend | 1 | Missing Base Sepolia env vars in .env.local |
| P2 | Frontend | 2 | Wire useRebalance into strategy detail page |
| P2 | Backend/API/DB | 1 | Migration infrastructure issues |
| P2 | Infrastructure/DevOps | 1 | No /metrics endpoint on backend |
| P2 | Infrastructure/DevOps | 2 | Alert rules need restoration after /metrics exists |
| P2 | Infrastructure/DevOps | 3 | Railway healthcheck path missing |
| P2 | Integration/E2E Tests | 1 | Missing test jobs in CI |
| P2 | Integration/E2E Tests | 2 | CI lint/test/build not split for fast feedback |
| P2 | Integration/E2E Tests | 3 | C5 deferred security not documented |
| P2 | DevRel/Documentation | 1 | No tech stack badge row |
| P2 | DevRel/Documentation | 2 | Zero GitHub stars |
| P3 | Smart Contracts | 1 | Literal 10000 instead of BPS_DEN constant |
| P3 | Smart Contracts | 2 | Literal 18 instead of WAD_DECIMALS constant |
| P3 | Smart Contracts | 3 | Redundant no-op statements (already removed) |
| P3 | Smart Contracts | 4 | Centralization risk (acknowledged design intent) |
| P3 | Smart Contracts | 5 | _onlyVault modifier never used standalone |

---

## Cross-Cutting Concerns

1. **Address Chaos Across All Layers:** The UI, backend, README, and deployments JSON all reference different contract addresses — 4 address sets for 7 contracts. This affects smart contracts (wrong on-chain targets), frontend (wrong contracts), backend (wrong contracts), and integrations (POSTFIX probes target wrong addresses). Must be resolved as a coordinated effort.

2. **Env Var Inconsistency:** Environment variable naming conventions differ across every config:
   - UI uses `NEXT_PUBLIC_VAULT_ADDRESS`
   - Backend uses `VAULT_ADDRESS` (but code reads `STRATEGY_VAULT_ADDRESS`)
   - Some files use `COFHE_RPC`, others `FHENIX_RPC`
   - No single source of truth or validation script

3. **Secret Sprawl:** A real deployer private key is committed in backend `.env.development`. An additional 5 identical tester keys are in `contracts/.env`. Both security and deploy domains flagged this independently.

4. **Auth Gap (Backend + Frontend):** The backend has `JwtAuthGuard` defined but never applied (all 39 endpoints public). The frontend has no authentication state management. Neither domain has a working auth flow.

5. **Monitoring Blindness:** Both infra and backend domains identified the same gap — no `/metrics` endpoint, no production monitoring, 11 of 14 alert rules broken, no Sentry. The monitoring stack is Docker-local only and never deployed to Railway.

6. **Test Coverage Hole:** 4 of 5 deployed production contracts have zero test coverage. Integration domain found this independently from the smart contracts domain, which found the same contracts had critical untested FHE logic.

7. **Buildathon Presentation Gap:** Multiple domains identified that the project's technical strength is undermined by poor presentation — no screenshots, no demo video, no plain-English README, no architecture diagram, no changelog, no LICENSE. The 8 documentation P0 items would take ~1.5 hours and could move the judge score from ~6.0 to ~8.4.

8. **Disconnected Governance:** StrategyRegistry `onlyVault` modifier exists but the vault governance is not connected to any real access control. Composer cross-contract ACL (`allowTransient` vs `FHE.allow`) needs verification for production use.

---

## Recommended Wave 2 Scope

Based on items deferred from Wave 1 or discovered as out-of-scope:

1. **Frontend test suite** — No significant frontend testing exists. Wave 2 should add Vitest tests for hooks and components, plus Playwright E2E tests for the builder flow.

2. **Backend end-to-end tests** — The backend has 12 spec files but no integration test suite with a test database. Wave 2 should add NestJS e2e tests with Supabase test containers.

3. **Full FHE contract security audit** — While Sisyphus verified the 4 "critical" FHE findings are false positives, a dedicated security audit (led by a specialist firm) should validate the `FHESafeMath128` implementation and FHE-select privacy patterns before mainnet deployment.

4. **Interest accrual implementation** — SC-P2-2 (interest accrual) is deferred to Wave 2 due to its complexity and cross-contract impact. It affects every state mutation in LendingPool.

5. **P0-1 encrypted state migration** — SC-P0-1 (migrating `totalPlainBorrow`/`liquidReserve` to encrypted) is the largest smart contract change. It should be last, after all other contracts changes are stabilized.

6. **SwapRouter executor trust (C5)** — The architectural issue where `SwapRouter.executeIntent` trusts the executor to settle swaps fairly. Requires ZK-proof or batch auction redesign — cannot be fixed incrementally.

7. **Mainnet deployment preparation** — Wave 2 should include a mainnet deployment script, mainnet-specific addresses for WETH/USDC/Pyth, and a security-conscious deploy procedure with multi-sig ownership.

8. **API documentation** — No OpenAPI/Swagger docs are exposed despite NestJS decorators being present. Wave 2 should add Swagger UI endpoint and API documentation generation.

9. **Performance optimization** — Load testing, gas optimization analysis, and bundle size reduction were out of scope for Wave 1.

10. **CI/CD hardening** — Add branch protection rules, required status checks, secret scanning (GitHub Secret Scanning or `truffleHog`), and automated dependency updates (Dependabot/Renovate).
