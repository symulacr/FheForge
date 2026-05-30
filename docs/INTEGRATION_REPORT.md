# INTEGRATION_REPORT.md — Pre-Remediation Baseline

**Date:** 2026-05-21  
**Phase:** Pre-Validation Sweep (Phase 0-1 baseline, before any agents applied MCs)  
**Branch:** `master`  
**Commit:** `9182834` (ZK verifier fix confirmed)

> ⚠️ **This is a BASELINE report.** No microchange agents have run yet.  
> All findings reflect the *current* state of the codebase before remediation begins.

---

## 1. Build Status

### 1.1 Contracts (`forge build`)

| Config | Status | Details |
|--------|--------|---------|
| `forge build --via-ir --skip test` | ✅ PASS (exit 0) | Compiles 83 Solidity files. Requires `--via-ir` (Stack Too Deep in LendingPool.sol:549). |
| `forge build` (default, including tests) | ❌ FAIL | Test files have pre-existing compilation errors (see §1.4). |
| `npx hardhat compile` | ✅ PASS (exit 0) | 93 Solidity files compiled. Only CoFHE mock contract warnings. |

**Critical:** `forge build --skip test --via-ir` must be the canonical build command going forward. The default `forge build` (which includes test-foundry/) will fail even on clean checkout.

### 1.2 Backend (`npm run build`)

| Config | Status | Details |
|--------|--------|---------|
| `npm run build` | ✅ PASS (exit 0) | NestJS `nest build` succeeds. |

### 1.3 Frontend (`npm run build`)

| Config | Status | Details |
|--------|--------|---------|
| `npm run build` | ❌ FAIL | **ESLint errors:** 6 unused variable errors across 3 files (see §1.5). Also has webpack circular dependency warnings (non-blocking). |

### 1.4 Contracts Test Compilation Failures

4 errors in `test-foundry/` — these files cannot be compiled:

| File | Error | Root Cause |
|------|-------|------------|
| `test-foundry/ExecutorContract.t.sol:26` | `MockERC20()` expects 3 args, got 0 | MockERC20 constructor signature changed after test was written |
| `test-foundry/ExecutorContract.t.sol:27` | Same as above | Same |
| `test-foundry/ExecutorContract.t.sol:33` | `SwapRouter()` expects 5 args, got 4 | SwapRouter constructor params changed |
| `test-foundry/NonFheConstructor.t.sol:10` | `StrategyVault.ZeroAddress` not found | Error type renamed or removed |

### 1.5 Frontend ESLint Errors (blocking build)

| File | Line | Unused Variable |
|------|------|-----------------|
| `components/lending/lending-actions-demo.tsx` | 23 | `liquidateWithProof` |
| `components/shared/execution-modal.tsx` | 159 | `userPositions` |
| `components/shared/execution-modal.tsx` | 161 | `getDepositedAmount` |
| `components/shared/execution-modal.tsx` | 162 | `getCollateral` |
| `components/strategy/StrategySteps.tsx` | 6 | `Zap` |
| `components/strategy/StrategySteps.tsx` | 10 | `Target` |

These are real unused variable issues, not false positives. `next build` treats ESLint errors as build failures by default.

---

## 2. Test Status

### 2.1 Contracts Tests

| Test Suite | Status | Pass | Fail | Details |
|------------|--------|------|------|---------|
| `forge test` (Foundry) | ❌ FAIL | — | — | Test files don't compile (see §1.4) |
| `npx hardhat test` (Hardhat) | ⚠️ NOT RUN | 4 existing | — | Only `StrategyVault.test.ts` exists (4 `it()` blocks). CoFHE mocks required. |

### 2.2 Backend Tests (`npm test`)

| Status | Suites | Tests | Details |
|--------|--------|-------|---------|
| ❌ PARTIAL FAIL | 1 failed, 1 passed | 2 failed, 11 passed | One suite connects to `test-rpc.example.com` (DNS NXDOMAIN) — requires running RPC. Async teardown leak detected. |

### 2.3 Frontend Tests (`vitest run`)

| Status | Files | Tests | Details |
|--------|-------|-------|---------|
| ❌ PARTIAL FAIL | 1 failed | 2 failed, 3 passed | `use-lending-actions.spec.ts`: CoFHE mock's `encryptInputs()` returns object without `.execute()` method. |

---

## 3. Address Consistency Verification Matrix

**❌ CRITICAL FINDING: NO TWO CONFIG LAYERS AGREE on ANY contract address.**

| Contract | 📖 README | 🖥️ UI `.env.local` | ⚙️ Backend `.env.development` | 📦 `deployments/421614.json` (Wave30) | 📜 `contracts/.env` |
|---|---|---|---|---|---|
| **StrategyVault** | `0xBf65f0...c551` | `0x06d9A8...eEa` | `0x261c4b...62F5` | `0x75c7D5...B1A` | ❌ **EMPTY** |
| **LendingPool** | `0x605e97...769` | `0x6e4DA2...958` | `0xb4F6b7...cB44` | `0x4F0508...D72` | ❌ **EMPTY** |
| **SwapRouter** | `0xc613Ba...489` | `0xC990c3...9A7d` | `0x78C281...964A` | `0x56d085...21B` | ❌ **EMPTY** |
| **StrategyRegistry** | `0xfe9FAb...260` | `0xFCb1be...8c0` | `0xcdFB60...1B9` | `0x4e0414...914` | ❌ **EMPTY** |
| **PriceOracle** | `0x6793a7...65C` | `0x3ffD18...38b4` | ❌ **MISSING** | `0xfA7B1f...12C` | ❌ **EMPTY** |
| **FheForgeComposer** | `0xCEF1B6...750` | `0x9d3f78...d46` | ❌ **MISSING** | `0x9892D8...2C` | ❌ **EMPTY** |
| **ExecutorContract** | `0xA4f22e...182` | ❌ **MISSING** | ❌ **MISSING** | `0x133Fd6...aD9` | ❌ **EMPTY** |

### Token Addresses

| Token | README | UI `.env.local` | Backend `.env.development` | `deployments/421614.json` |
|-------|--------|-----------------|---------------------------|--------------------------|
| **WETH** | `0x9A0227...43d` | `0x84BddC...32` | `0x980B62...c73` | `0x84BddC...32` (same as UI) |
| **USDC** | `0x150376...Df6` | `0x150376...Df6` | `0x75faf1...A4d` | `0x75faf1...A4d` (from evidence) |

### Address Discrepancy Count

| Pair | Matching Addresses | Notes |
|------|-------------------|-------|
| README vs UI | 0/7 | Zero matches |
| README vs Backend | 0/4 | Backend only has 4 contract vars |
| README vs Deployment | 0/7 | Zero matches |
| UI vs Deployment | 0/7 | Zero matches between env and JSON |
| UI WETH vs Deployment WETH | ✅ 1/1 | Only config pair that matches |
| UI USDC vs Backend USDC | ❌ 0/1 | Different addresses |
| Contracts `.env` | ❌ 0/6 | All contract addresses are empty |

### Era Mapping (from git log and comments)

| Config Layer | Apparent Era | Deployment Date |
|---|---|---|
| UI `.env.local` | Wave 17 | 2026-05-10 (V2 refactor) |
| `deployments/421614.json` | **Wave 30** | **2026-05-12 (MOST RECENT)** |
| README | Wave 30+ (claims Wave30) | Claims Wave30 addresses |
| Backend `.env.development` | Wave 5-6 | Older deployment |
| `contracts/.env` | Unknown | ALL EMPTY — never populated |

---

## 4. Cross-Domain Dependency Issues

### 4.1 Security: MC-004 (JWT Fallback) → Blocks MC-020, MC-046

**Status:** ❌ UNFIXED  
**Files:** `backend/apps/src/auth/jwt.strategy.ts:12`, `backend/apps/src/auth/auth.module.ts:14`  
**Finding:** Both locations use `?? 'dev-secret'` fallback. If `JWT_SECRET` env var is missing in production, ANYONE who knows this well-known default can forge JWTs.

### 4.2 Auth: MC-020 (wallet-login endpoint) → Blocks MC-046 (global auth guard)

**Status:** ❌ DOES NOT EXIST  
**Finding:** Auth module has `JwtStrategy`, `JwtAuthGuard`, and `JwtModule` but **no login endpoint** (`POST /auth/wallet-login` or any auth endpoint). MC-046 cannot be applied until MC-020 creates the login flow, or every request will return 401 with no way to get a token.

### 4.3 Auth Guard: MC-046 (global JWT guard)

**Status:** ⚠️ NOT APPLIED  
**Finding:** `JwtAuthGuard` is defined in `jwt-auth.guard.ts` but `APP_GUARD` in `app.module.ts` only registers `ThrottlerGuard`. No global auth protection. All 39 backend endpoints are currently unprotected.

### 4.4 ethers v5 Subpath Imports (MC-021 target)

**Status:** ❌ UNFIXED  
**Files:**
- `backend/apps/src/event-indexer/event-indexer.service.ts:9-10` — `import { JsonRpcProvider } from 'ethers/providers'`, `import { Result } from 'ethers/abi'`
- `backend/apps/src/shared/infrastructure/fhenix-strategy.service.ts:4-5` — `import { JsonRpcProvider } from 'ethers/providers'`, `import { formatUnits } from 'ethers/utils'`

**Impact:** Backend uses ethers v6 (`^6.13.0`). These v5 subpath imports currently resolve through backward-compat paths but may break with future ethers v6 minor releases. This blocks MC-047, MC-050, MC-052.

### 4.5 Env Var Name Mismatch: Indexer (MC-022 target)

**Status:** ❌ UNFIXED  
**Finding:** `EventIndexerService` reads `COFHE_RPC, STRATEGY_VAULT_ADDRESS, LENDING_POOL_ADDRESS, PRICE_ORACLE_ADDRESS, STRATEGY_REGISTRY_ADDRESS`. But `.env.development` uses `FHENIX_RPC, VAULT_ADDRESS, POOL_ADDRESS, REGISTRY_ADDRESS`. These vars won't be found at runtime.

### 4.6 Missing Backend Env Vars

**Finding:** Backend `.env.development` is missing:
- `PRICE_ORACLE_ADDRESS` / `ORACLE_ADDRESS`
- `COMPOSER_ADDRESS`
- `EXECUTOR_ADDRESS`
- `JWT_SECRET` (critical — would cause `dev-secret` fallback)

---

## 5. Deployer Key Security

### 5.1 Leaked Keys

| Key | Location | Status |
|-----|----------|--------|
| `0xf0c35250...` | `backend/apps/.env.development:2` | ❌ STILL LEAKED — must be rotated on-chain first (MC-001), then removed (MC-002) |
| `[REDACTED - use environment variables]` | `contracts/.env:6` | ❌ STILL LEAKED — same key used for 5 roles (MC-001, MC-003) |

### 5.2 Duplicate Test Keys (MC-003 target)

**Finding:** All 5 private keys in `contracts/.env` are identical (`[REDACTED - use environment variables]`):
- PRIVATE_KEY (line 6)
- TESTER1_PRIVATE_KEY (line 25)
- TESTER2_PRIVATE_KEY (line 26)
- TESTER3_PRIVATE_KEY (line 27)
- DEPLOYER_PRIVATE_KEY (line 28)

Tests run as deployer, defeating test isolation.

### 5.3 Etherscan API Key (MC-018 target)

**Finding:** Real Etherscan API key `5QHW8JJHR3C5U65HGBYVD4VRXANWRIRFM7` is leaked in `contracts/.env:16`.

---

## 6. Unused / Dead Code Issues

| MC | File | Issue |
|----|------|-------|
| MC-013 | `ui/hooks/use-rebalance.ts` | 97-line hook with zero consumers. Fully implemented, never called. |
| MC-014 | `ui/app/builder/components/ConfigPanel.tsx:422-458` | Duplicate SWAP case — unreachable dead code. |
| MC-015 | `ui/app/builder/components/nodes/protocol-icon.tsx` | Always shows weth.svg — ignores `protocolName` prop. |
| MC-016 | `ui/lib/iconMap.ts` | "base-sepolia" maps to Arbitrum icon. |

---

## 7. Other Notable Findings

| Issue | Details |
|-------|---------|
| **Foundry test isolation** | test-foundry/ files should NOT be compiled with `forge build` — they're in the default test directory and fail to compile. Consider `test = ""` in foundry profile or skip pattern. |
| **16 deployment JSONs** | `contracts/deployments/` has 16 JSON files from different eras. Only `421614.json` (Wave30) and `421614.evidence.json` are actively referenced. 14 historical artifacts create confusion. |
| **Contracts `.env` all empty** | STRATEGY_VAULT_ADDRESS, LENDING_POOL_ADDRESS, SWAP_ROUTER_ADDRESS, STRATEGY_REGISTRY_ADDRESS, WETH_ADDRESS, USDC_ADDRESS are all empty. Live test scripts would fail. |
| **CoFHE mock test gap** | UI tests fail because `cofheClient.encryptInputs(...).execute` is not mocked. Backend tests fail because `test-rpc.example.com` doesn't resolve. |
| **Vercel build will fail** | Frontend `npm run build` fails on ESLint errors — Vercel deployment would fail unless `next build` is configured to ignore ESLint errors. |

---

## 8. MC Dependency Chain Verification

| Dep Chain | Status | Notes |
|-----------|--------|-------|
| MC-001 → MC-002, MC-003 | ✅ Correct | Key rotation must precede removal & key generation |
| MC-004 → MC-020, MC-046 | ✅ Correct | JWT_SECRET fix must precede auth login & global guard |
| MC-019 → MC-022, MC-023, MC-036, MC-037, MC-040, MC-042, MC-047, MC-050, MC-068, MC-069, MC-070, MC-071, MC-078 | ✅ Correct | Address reconciliation unblocks everything |
| MC-020 → MC-046 | ✅ Correct | Login endpoint must exist before global auth guard |
| MC-021 → MC-047, MC-050, MC-052 | ✅ Correct | ethers v6 import fix unblocks routes & oracle health |
| MC-046 → MC-054, MC-081, MC-089 | ✅ Correct | Auth guard precedes CORS hardening & diagram accuracy |

**No dependency cycles detected.** The dependency graph is a valid DAG.

---

## 9. Summary of Cross-Domain Broken Dependencies

| Severity | MC(s) | Description | Blocks |
|----------|-------|-------------|--------|
| 🔴 P0-BROKEN | MC-019 | Addresses disagree across ALL 5 config layers | 14+ MCs depend on correct addresses |
| 🔴 P0-SEC | MC-001/002/003 | Leaked deployer keys not rotated | All contract interaction MCs |
| 🔴 P0-SEC | MC-004 | JWT `dev-secret` fallback | MC-020, MC-046 |
| 🔴 P0 | MC-020 | No auth login endpoint exists | MC-046 (global auth guard) |
| 🔴 P0 | MC-046 | JwtAuthGuard not registered globally | MC-054, MC-081, MC-089 |
| 🟠 P1 | MC-021 | ethers v5 subpath imports (2 files) | MC-047, MC-050, MC-052 |
| 🟠 P1 | MC-022 | Indexer env var name mismatch | MC-058 |
| 🟡 P2 | Contracts `.env` | All contract addresses empty | Any script using `.env` vars |
| 🟡 P2 | Frontend build | ESLint errors block `next build` | Vercel deployment |

---

## 10. MCs That Could Not Be Verified

The following MCs require on-chain verification or live deployment access:

| MC | Reason Unverifiable |
|----|---------------------|
| MC-001 | Requires on-chain `cast send` to rotate keys |
| MC-019 | Requires `cast code <addr>` on 35 addresses against live Arbitrum Sepolia RPC |
| MC-023 | Requires live RPC access to probe addresses |
| MC-024 | Requires running backend with prom-client |
| MC-025 | Requires Railway dashboard access |
| MC-050 | Requires live PriceOracle on-chain |
| MC-063 | Requires Railway environment |
| MC-065 | Requires Railway internal networking feature |
| MC-090 | Requires CI trigger with secrets |
| MC-097 | Requires running UI with wallet connected |

---

## 11. Recommendations

1. **Run MC-019 (address reconciliation) FIRST** — it unblocks 14+ other MCs. Verify `deployments/421614.json` addresses on-chain, then propagate the correct set to all configs.
2. **Run MC-004 (JWT_SECRET fix) before MC-020 (auth login)** — security prerequisite.
3. **Fix frontend ESLint errors** as part of MC-036/037/038 work — otherwise Vercel deployment will fail.
4. **Fix test-foundry/ compilation** — either update test constructors or move to a separate test directory with its own foundry profile.
5. **Set canonical forge build command** to `forge build --via-ir --skip test` in CI and documentation.
6. **After address reconciliation**, run `cast code <addr>` against ALL addresses from the canonical set to verify they have bytecode on-chain.

---

*Report generated by Integration Executor. No MCs have been applied — this is a baseline snapshot.*
