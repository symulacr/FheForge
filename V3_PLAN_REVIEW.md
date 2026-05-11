# V3 Plan Review — OceanFin Cross-Reference + Naming + Gaps

Grounded on systematic full read of both codebases.

## 1. OceanFin "Contract Logic" — Polkadot Extrinsic Map

OceanFin has no Solidity. Its "contracts" are **Hydration pallet extrinsics** invoked via Polkadot JS API. The equivalent of Solidity function signatures:

| OceanFin Step | Pallet Call | Aave V3 Helper | Plain Params | Returns |
|---|---|---|---|---|
| `JOIN_STRATEGY` | `swap.execute` | `@galacticcouncil/sdk` | `(assetIn, assetOut, amountIn)` | SubmittableExtrinsic |
| `SWAP` | `swap.execute` | same | same | same |
| `SUPPLY` | `lendingPool.supply` | `LPSupplyParamsType` | `(assetSupply, amountSupply)` | SubmittableExtrinsic |
| `BORROW` | `lendingPool.borrow` | `LPBorrowParamsType` | `(assetBorrow, amountBorrow)` | SubmittableExtrinsic |
| `ENABLE_E_MODE` | `lendingPool.setUserEmode` | `setUserEmode` | `(categoryId)` | SubmittableExtrinsic |
| `ENABLE_BORROWING` | — (no-op, not implemented) | — | — | — |

**Key OceanFin backend concepts (from systematic read):**

- **Looping strategies**: `gDOT-looping` and `vDOT-looping` — generate steps programmatically:
  ```
  ENABLE_E_MODE → [SWAP + SUPPLY + BORROW] × N loops
  ```
  Each iteration: collateral → swap → supply → borrow (LTV=0.9)
- **LTV calculation**: `getMaxBorrow(assetId, amount) = amount × maxLTV` (hardcoded 0.9)
- **APY model**: `sumPow(0,N,ltv) × supplyRate - sumPow(1,N,ltv) × borrowRate` — geometric series
- **Interest rate**: fetched from Aave V3 on-chain data (liquidityRate, variableBorrowRate in RAY)
- **Price**: `getBestSpotPrice` from Hydration SDK router
- **Slippage**: hardcoded 3% (`SLIPPAGE_TOLERANCE = 0.03`)
- **E-Mode**: `DOT_CORRELATED` (category 2) — same-category assets get higher LTV
- **Execution**: Sequential — each step is one extrinsic, 2-second delays between steps
- **Rewards**: Includes vDOT staking APY from Bifrost API (`https://dapi.bifrost.io/api/site`)
- **Simulation**: Backend-side per-step simulators (SupplySimulator, BorrowSimulator, JoinStrategySimulator, SwapSimulator, EnableEModeSimulator)

## 2. What FheForge Ported vs Changed vs Added

| Concept | OceanFin | FheForge | Change Type |
|---|---|---|---|
| Step execution | Sequential extrinsics (4+ txs) | Atomic Composer (1 tx) | **Architectural rewrite** |
| Supply | `lendingPool.supply(asset, amt)` | `supply(token, amt, InEuint128)` + `transferFrom` | **FHE encryption added** |
| Borrow | `lendingPool.borrow(asset, amt)` | `checkLtvAndBorrow(coll, debt, amt, enc, ltvNum, ltvDen)` | **FHE + LTV check merged** |
| Swap | `swap.execute(assetIn, assetOut, amt)` | `SwapRouter.submitIntent` / `executeIntent` | **Intent-based model** |
| E-Mode | `setUserEmode(DOT_CORRELATED)` | **Removed** — no Aave E-Mode on custom pool | **Deleted** |
| Enable Borrowing | No-op | **Removed** | **Deleted** |
| Looping | Backend-generated step array | `openLeveragedStrategy(params, encrypted)` with `loopCount` param | **Contract-side looping** |
| LTV | Hardcoded 0.9 via `getMaxBorrow` | Encrypted `ltvNum/ltvDen` (70/100 default) | **FHE + configurable** |
| Interest | Aave V3 on-chain rates | Shares-based with InterestIndex (P3) | **Custom model** |
| Price | Hydration SDK `getBestSpotPrice` | Pyth oracle + admin fallback prices | **Oracle rewrite** |
| Rewards | Bifrost vDOT staking APY | Not implemented | **Missing** |
| Simulation | Backend per-step simulators | AI strategy service (Gemini) | **Rewritten** |
| APY calculation | `sumPow` geometric series | Not implemented | **Missing** |
| Activity tracking | Create → update per step → final | Same pattern (preserved from OceanFin) | **Ported** |
| Wallet | Luno/polkadot.js (Substrate) | wagmi/viem (EVM) | **Chain change** |

## 3. Naming Audit — Grounded on Actual Function Signatures

### 3.1 Contract Names

| Current | OceanFin Equivalent | Issue | Proposed | Rationale |
|---|---|---|---|---|
| `LendingPool` | Aave V3 Pool (external) | Generic — same name as Aave, but this is NOT Aave | `ShieldedPool` | Signals FHE + avoids Aave confusion |
| `FheForgeComposer` | OceanFin has no equivalent (step-by-step execution) | Inconsistent prefix — other contracts don't have it | `Composer` | All contracts are FheForge; prefix is noise |
| `StrategyVault` | No equivalent — OceanFin uses Aave positions directly | "Strategy" in name but stores **positions**, not strategies | `ShieldedVault` | Signals FHE + accurate (vault of positions) |
| `StrategyRegistry` | No equivalent — strategies are backend-only in OceanFin | OK — actually stores strategy metadata | `StrategyRegistry` | Keep — no FHE state visible to users |
| `SwapRouter` | Hydration `swap.execute` (pallet) | OK | `SwapRouter` | Keep — no FHE |
| `PriceOracle` | Hydration `getBestSpotPrice` (SDK) | OK | `PriceOracle` | Keep — no FHE |
| `FheForgeGovernor` | No equivalent | Redundant prefix | `Governor` | Already in FheForge namespace |
| `FheForgeTimelock` | No equivalent | Redundant prefix | `Timelock` | Same |

### 3.2 Function Names — ShieldedPool (was LendingPool)

**OceanFin calls**: `lendingPool.supply(asset, amount)` / `lendingPool.borrow(asset, amount)` — these are direct Aave V3 pallet calls.

| Current | OceanFin Source | Issue | Proposed | Rationale |
|---|---|---|---|---|
| `supply` | Aave `supply(asset, amt)` | Same name as Aave but different semantics — Aave tracks plain balances, ours tracks encrypted | `shield` | FHERC20 pattern; "supply" implies Aave compat we don't have |
| `supplyEth` | No equivalent (Hydration has no ETH) | Unclear what "Eth" variant means | `shieldEth` | ETH variant of shield |
| `withdraw` | Aave `withdraw(asset, amt)` | Aave's withdraw = full exit. Ours = partial encrypted subtract + plain transfer | `partialUnshield` | Accurately describes: encrypted subtract + partial ERC20 unlock |
| `supplyToLending` | No equivalent (Composer-only path) | "toLending" = OceanFin relic name; Pool IS the lending | `depositFor` | Composer deposits on behalf; "For" = behalf |
| `borrowFromLending` | No equivalent (Composer-only path) | "fromLending" = same relic | `borrowFor` | Composer borrows for user |
| `repayBorrow` | No equivalent (Composer-only path) | "Borrow" is redundant — what else would you repay? | `repayFor` | Composer repays for user |
| `checkLtvAndBorrow` | OceanFin: `getMaxBorrow()` = `amt × 0.9` | Merges LTV check + borrow; OceanFin keeps these separate | `borrowWithLtvCheck` | Verb-first: borrow (with check) |
| `borrowWithOracle` | No equivalent | OK | `borrowWithOracle` | Fine |
| `requestEmergencyBalance` | No equivalent | "Emergency" misnomer — this is just `allowPublic` | `requestBalanceReveal` | "Reveal" = CoFHE decryption term |
| `emergencyWithdrawWithProof` | No equivalent | Paused-state only, not really emergency | `withdrawPausedWithProof` | More accurate |
| `requestLiquidationCheck` | No equivalent | OK-ish | `requestLiquidityCheck` | More accurate (checking if liquidatable) |
| `liquidateWithProof` | No equivalent | OK | `liquidateWithProof` | Fine |
| `requestUnshield` (stub) | No equivalent | — | `requestUnshield` | FHERC20 pattern |
| `unshieldWithProof` (stub) | No equivalent | — | `unshieldWithProof` | FHERC20 pattern |
| NO getter | Aave: `getUserAccountData()` returns all balances | Missing entirely | `getShieldedSupply` | euint128 + allowSender for decryptForView |
| NO getter | Aave: `getUserAccountData()` | Missing entirely | `getShieldedBorrow` | Same |

### 3.3 Function Names — ShieldedVault (was StrategyVault)

| Current | Issue | Proposed | Rationale |
|---|---|---|---|
| `openPosition` (InEuint128) | Dead overload — Composer uses euint128 only | REMOVE | Cross-contract path = euint128 only |
| `openPosition` (euint128) | OK | `openPosition` | Clean |
| `addCollateral` (InEuint128) | Dead overload | REMOVE | Same |
| `addCollateral` (euint128) | OK | `addCollateral` | Clean |
| `closePosition` | OK — always user-facing | `closePosition` | Fine |
| `getCollateral` | Doesn't signal encrypted | `getShieldedCollateral` | Signals encrypted return |
| `emergencyWithdraw` | Paused-state only | `withdrawPaused` | More accurate |

### 3.4 Function Names — Registry

| Current | Proposed | Rationale |
|---|---|---|
| `incrementTvl` (InEuint128) | REMOVE | Dead overload |
| `incrementTvl` (euint128) | `increaseTvl` | More natural English |
| `decrementTvl` (InEuint128) | REMOVE | Dead overload |
| `decrementTvl` (euint128) | `decreaseTvl` | More natural English |
| `getEncryptedTvl` | `getShieldedTvl` | Consistent with Shielded naming |

### 3.5 Function Names — Composer

| Current | OceanFin Equivalent | Proposed | Rationale |
|---|---|---|---|
| `openLeveragedStrategy` | Backend `simulateGDOTStrategy()` → step array | `openLeveragedPosition` | "Position" = Vault's term; more concrete |
| `rebalance` | No equivalent | `rebalancePosition` | Specific |

### 3.6 Error Names

| Current | Proposed | Rationale |
|---|---|---|
| `OnlyOwner()` / `NotOwner()` | `Unauthorized()` | One error in FheForgeBase; address in revert data |
| `NotComposer()` | `Unauthorized()` | Same pattern |
| `ZeroAddress()` | `ZeroAddress()` | Keep |
| `ZeroAmount()` | `ZeroAmount()` | Keep |

### 3.7 Step Type Naming — Frontend

OceanFin defines `STEP_TYPE` enum:
```
JOIN_STRATEGY, BORROW, ENABLE_BORROWING, ENABLE_E_MODE, SWAP, SUPPLY
```

FheForge currently mirrors this exactly in `ui/utils/constant.ts` but:
- `JOIN_STRATEGY` and `SWAP` are the same thing in OceanFin (both call `swap()`)
- `ENABLE_BORROWING` is a no-op in OceanFin
- `ENABLE_E_MODE` doesn't exist in FheForge (no Aave E-Mode)

**Proposed FheForge STEP_TYPE**:
```
SHIELD, BORROW, SWAP, UNSHIELD, REPAY, LIQUIDATE
```
Remove: `JOIN_STRATEGY` (just `SWAP`), `ENABLE_BORROWING` (no-op), `ENABLE_E_MODE` (no Aave).
Add: `UNSHIELD`, `REPAY`, `LIQUIDATE` (FHE-specific actions).

## 4. Gaps — Cross-Referencing OceanFin Logic vs FheForge Contracts

### GAP-1: No APY Calculation (OceanFin has `sumPow` geometric series)

OceanFin backend calculates leveraged APY:
```typescript
supplyExposure = sumPow(0, loops, ltv)  // 1 + ltv + ltv² + ... + ltv^N
borrowExposure = sumPow(1, loops, ltv)  // ltv + ltv² + ... + ltv^N
apy = (supplyRate × supplyExposure - borrowRate × borrowExposure) × 100
```

FheForge has NO APY calculation anywhere. The `apyTarget` param in `OpenStrategyParams` is hardcoded `0`.

**Impact**: Users cannot compare strategies by yield. The strategy page shows no APY.

**Recommendation**: Add APY estimation to FheForge backend `strategy-simulation.service.ts`:
- Port `sumPow` geometric series formula
- Replace `liquidityRate/borrowRate` with FheForge's interest index rates
- Display on strategy cards + execution modal subtitle

### GAP-2: No Rewards Accounting (OceanFin has Bifrost staking + LP fees)

OceanFin `RewardsService`:
- vDOT staking APY from Bifrost API
- gDOT LP fee from Hydration pool data
- Both added to supply APY in the geometric series

FheForge has NO rewards. No staking, no LP fees, no reward tokens.

**Recommendation**: Add `RewardsAccrued` event to ShieldedPool. Initially zero — but the event + getter should exist for future reward token distribution. Add `getPendingRewards(token) → euint128` with `allowSender`.

### GAP-3: No Simulated Step Generation (OceanFin generates steps backend-side)

OceanFin `simulateGDOTStrategy()`:
```
ENABLE_E_MODE → [SWAP(DOT→gDOT) + BORROW(DOT)] × N
```
`simulateVDOTStrategy()`:
```
ENABLE_E_MODE → [SWAP(DOT→vDOT) + SUPPLY(vDOT) + BORROW(DOT)] × N
```

FheForge's `openLeveragedStrategy` takes `loopCount` as param and loops internally in the Composer contract. This is better (atomic), but there's NO backend-side step simulation for the frontend to preview.

**Impact**: The frontend `execution-modal.tsx` shows steps from `strategy.steps` but these come from the AI service, not from a proper simulation. No slippage estimation, no price impact, no APY preview.

**Recommendation**: Add `simulateStrategy(params)` to FheForge backend that mirrors Composer's loop logic and returns `StrategySimulate` with estimated amounts, slippage, and APY.

### GAP-4: No Aave-style `getUserAccountData` (OceanFin gets all balances in one call)

OceanFin uses Aave V3 `UI_POOL_DATA_PROVIDER.getUserAccountData()` which returns:
- totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor

FheForge has NO equivalent. Users must call:
- `getShieldedSupply(token)` for each token (doesn't exist yet)
- `getShieldedBorrow(token)` for each token (doesn't exist yet)
- `getShieldedCollateral()` on Vault
- `getShieldedTvl()` on Registry
- NO health factor calculation

**Recommendation**: Add `getHealthFactor(user) → ebool` to ShieldedPool:
```
ebool healthy = FHE.gte(totalCollateralValue, totalDebtValue)
FHE.allowSender(healthy)
return healthy
```
This requires encrypted price conversion (multiply supply by price, sum across tokens).

### GAP-5: No `supply` step in FheForge Composer (OceanFin vDOT has explicit SUPPLY)

In OceanFin's vDOT strategy, `SUPPLY` is a separate step AFTER swap:
```
SWAP(DOT→vDOT) → SUPPLY(vDOT) → BORROW(DOT)
```

In FheForge's `openLeveragedStrategy`, supply is done inside `supplyToLending` called by the Composer. There's no separate supply step exposed to the user.

For gDOT, OceanFin uses `JOIN_STRATEGY` which is swap+supply in one step (via Hydration's join pool).

**This is actually CORRECT** — Composer's atomic flow absorbs the SUPPLY step. But the frontend still shows `SUPPLY` as a separate visual step (OceanFin relic).

**Recommendation**: Remove `SUPPLY` step from frontend execution modal. Show only: SHIELD → SWAP → BORROW (or just "Open Position" as one step since Composer makes it atomic).

### GAP-6: No Claim Helper for async unshield (FHERC20 pattern)

OceanFin's "withdraw" is instant — Aave V3 `withdraw(asset, amount)` returns tokens immediately.
FheForge's unshield MUST be async because encrypted balances require `allowPublic` → off-chain decrypt → on-chain `verifyDecryptResult`.

**Recommendation**: Port `FHERC20WrapperClaimHelper` pattern:
- `Claim` struct + `_claims` mapping + `_userClaims` set
- `requestUnshield` → `allowPublic` + `_createClaim`
- `claimUnshielded` / `claimUnshieldedBatch`
- `getUnshieldClaims(user)` view

### GAP-7: No Confidential Transfer Between Users

OceanFin has no inter-user transfers — all operations go through Aave/Hydration pallet.
FheForge COULD support private peer-to-peer encrypted balance transfers (FHERC20 `confidentialTransfer`), which would be a unique feature vs OceanFin.

**Recommendation**: V3: `transferShielded(token, to, InEuint128 encAmount)`. V4: full FHERC20 integration.

### GAP-8: Composer Operator Model (time-bound vs permanent)

OceanFin has no Composer — each step executes directly as the user. No third-party access.
FheForge's `onlyComposer` gives permanent access. FHERC20 uses time-bound operators.

**Recommendation**: Replace `onlyComposer` with `setComposer(address, uint48 deadline)` + `onlyActiveComposer` modifier.

### GAP-9: No `FHE.isAllowed` Guards on Cross-Contract Handle Reception

Registry has it, Pool/Vault don't. If a handle is passed without proper `allowTransient`, the real coprocessor will revert.

**Recommendation**: Add `FHE.isAllowed(handle, address(this))` checks in all cross-contract functions.

### GAP-10: No `decryptForView` for Balance Display

OceanFin shows balances directly from Aave V3 data provider — all plain.
FheForge users currently CANNOT see their own encrypted balances.

**Recommendation**: Add `decryptForView` flow: getter with `allowSender` → off-chain `decryptForView` → display plaintext.

### GAP-11: Frontend Step-by-Step Model Mismatch

OceanFin's execution modal: `for (let i = 0; i < steps.length; i++) { await executeStep(i); await sleep(2000); }` — one tx per step.

FheForge's execution modal: renders 4 steps visually, then fires ONE `openLeveragedStrategy` tx. All steps show "processing" → all jump to "completed" at once.

**This is a direct OceanFin port that doesn't match the Composer architecture.**

**Recommendation**: Redesign for atomic Composer flow:
1. "Encrypt inputs" (client-side, shows progress per handle)
2. "Execute strategy" (1 on-chain tx — show as single step)
3. "Confirm receipt" (poll for confirmation)

### GAP-12: No Interest Rate Simulation

OceanFin's `BorrowSimulator` and `SupplySimulator` fetch real rates:
- `getInterestRate(assetId)` — hardcoded fallbacks per asset
- `getSupplyApy(assetId)` — hardcoded fallbacks per asset
- `getExchangeRate(assetIn, assetOut)` — from Hydration SDK

FheForge's interest rate comes from `InterestIndex` shares-based system (P3), but there's NO frontend display or simulation.

**Recommendation**: Add `getSupplyRate(token) → uint256` and `getBorrowRate(token) → uint256` view functions to ShieldedPool. These are plain (protocol-level, not per-user).

### GAP-13: LTV Hardcoded 0.9 vs Configurable

OceanFin: `getMaxLTV() = 0.9` hardcoded.
OceanFin BorrowSimulator: `collateralRatio = step.collateralRatio || 0.7` — different value!
FheForge: `ltvNum/ltvDen` passed as params (default 70/100 = 0.7).

**OceanFin itself has an inconsistency** — the backend simulation uses 0.7 LTV but `getMaxBorrow` uses 0.9.
FheForge correctly uses configurable LTV, but the frontend hardcodes `70n/100n`.

**Recommendation**: Make LTV token-pair-specific in ShieldedPool:
```
mapping(address => mapping(address => uint256)) public ltvConfig; // collateralToken → borrowToken → LTV basis points
function setLtvConfig(collateral, borrow, bps) external onlyOwner
```
Replace `ltvNum/ltmDen` params in Composer with on-chain config lookup.

## 5. Revised V3 Plan — Updated Phases

### V3-0: Bug fixes + getters + step type cleanup (expanded)

| # | Change | Detail |
|---|--------|--------|
| V3-0a | Fix Composer→Vault InEuint128 bug | `_openVaultPosition`: pass `incomingColl` (euint128) not `e.collateral` (InEuint128) |
| V3-0b | Add Pool `getShieldedSupply(token)` | euint128 with `allow+allowSender` |
| V3-0c | Add Pool `getShieldedBorrow(token)` | Same |
| V3-0d | Remove Vault InEuint128 overloads | Keep only euint128 variants |
| V3-0e | Remove Registry InEuint128 overloads | Same |
| V3-0f | Remove custom Paused/Unpaused events | Use OZ events |
| V3-0g | Update `STEP_TYPE` enum in frontend | Remove `JOIN_STRATEGY`, `ENABLE_BORROWING`, `ENABLE_E_MODE`. Add `SHIELD`, `UNSHIELD`, `REPAY`, `LIQUIDATE` |

### V3-1: Shared abstractions (unchanged)

### V3-2: Shield/Unshield + ClaimHelper + APY + LTV config (expanded)

| # | Change | Detail |
|---|--------|--------|
| V3-2a | Rename `supply` → `shield` | With `supply` as backwards-compat alias |
| V3-2b | Add `requestUnshield(token)` | `allowPublic` + emit `UnshieldRequested` |
| V3-2c | Add `unshieldWithProof(token, proof, sig)` | `verifyDecryptResult` → zero balance → unlock ERC20 |
| V3-2d | Add ClaimHelper pattern | `Claim` struct, `_claims`, `_userClaims`, `claimUnshielded`, `claimUnshieldedBatch` |
| V3-2e | Add `getSupplyRate(token) → uint256` | Plain view — protocol-level rate |
| V3-2f | Add `getBorrowRate(token) → uint256` | Plain view — protocol-level rate |
| V3-2g | Add LTV config mapping | `ltvConfig[collateral][borrow] → bps`, `setLtvConfig` |

### V3-3: Borrow reveal + operator model + health factor (expanded)

| # | Change | Detail |
|---|--------|--------|
| V3-3a | Add `requestBorrowReveal(token)` | `allowPublic` for user's own debt |
| V3-3b | Add `repayWithProof(token, proof, sig, amount)` | Verify + encrypted sub |
| V3-3c | Replace `onlyComposer` with operator model | `setComposer(addr, uint48 deadline)` + `onlyActiveComposer` |
| V3-3d | Add `getHealthFactor(user) → ebool` | `FHE.gte(totalCollateralValue, totalDebtValue)` + `allowSender` |
| V3-3e | Add `getPendingRewards(token) → euint128` | Placeholder (returns _ZERO) + `allowSender` for future rewards |

### V3-4: Remove InEuint128 overloads (unchanged)

### V3-5: FHESafeMath + ACL checks (unchanged)

### V3-6: Interest with encrypted index (DEFER — unchanged)

### V3-7: Frontend alignment (expanded)

| # | Change | Detail |
|---|--------|--------|
| V3-7a | Redesign execution modal for atomic flow | 3 steps: encrypt → execute → confirm (not 4-step OceanFin model) |
| V3-7b | Add `decryptForView` for balance display | `getShieldedSupply`/`getShieldedBorrow` + decryptForView |
| V3-7c | Add `claimUnshielded` UI flow | Async claim list + claim button |
| V3-7d | Add APY estimation in backend | Port `sumPow` geometric series from OceanFin |
| V3-7e | Add `simulateStrategy` to backend | Mirrors Composer loop logic for frontend preview |
| V3-7f | Add `getHealthFactor` display | Encrypted health check → decryptForView → badge |
| V3-7g | ABIs synced after Wave18 | ui/abis/ |
| V3-7h | Remove `ENABLE_E_MODE` / `ENABLE_BORROWING` from UI | OceanFin relics that don't apply |

### V3-8: Deploy + full integration test (unchanged)

## 6. V4 Target (documented, not executed)

- ShieldedPool becomes FHERC20ERC20Wrapper per token (eWETH, eUSDC)
- Confidential transfers between users via FHERC20 `confidentialTransfer`
- Indicator system for wallet compatibility
- P8 integration: AccessControl + UUPS proxy + governance
- Encrypted total supply/borrow for governance auditors
- Rewards distribution with encrypted per-user accrual

## 7. Execution Priority (Micro-Change Order)

```
V3-0  → compile + audit-quick         [LOW RISK, immediate]
V3-1  → compile + audit-quick + tsc   [MEDIUM RISK, structural]
V3-2  → compile + deploy Wave18      [HIGH RISK, new FHE flows]
V3-3  → compile + deploy             [MEDIUM RISK, reveal+operator]
V3-4  → compile (already done in V3-0) [LOW RISK]
V3-5  → compile + test                [MEDIUM RISK, FHESafeMath]
V3-6  → DEFER                         [COMPLEX, ship after V3-5]
V3-7  → tsc + manual UI test          [LOW RISK, frontend only]
V3-8  → deploy Wave19 + full test     [FINAL]
```

---

*Grounded on: systematic full read of OceanFin (547 source files across ui/ + backend/) and FheForge (6 core contracts 2,081 lines, all UI hooks/services/types, backend NestJS DDD). Cross-referenced against FHERC20 reference (FHERC20.sol 394 lines, FHERC20ERC20Wrapper.sol 229 lines, FHERC20WrapperClaimHelper.sol 89 lines), CoFHE FHE.sol v0.1.3 API, and CoFHE official docs.*

## 8. Missing Items — Found in Systematic Cross-Check

### MISS-1: `withdrawEth` not renamed in review

LendingPool has `withdrawEth(uint256 amount, InEuint128 calldata encAmount)` at line 320.
The review renames `withdraw` to `partialUnshield` but DOES NOT rename `withdrawEth`.

**Fix**: `withdrawEth` -> `partialUnshieldEth` (parallel with `shieldEth`).

### MISS-2: `EMODE_CATEGORY` enum still in FheForge frontend

`ui/utils/constant.ts` has `EMODE_CATEGORY { STABLECOIN = 1, ETH_CORRELATED = 3 }` — direct OceanFin port (`DOT_CORRELATED = 2` became `ETH_CORRELATED = 3`). CoFHE has no E-Mode. Dead code.

**Fix**: V3-0g should also REMOVE `EMODE_CATEGORY` enum entirely.

### MISS-3: Backend `OperationType` still has `ENABLE_E_MODE`

`backend/apps/src/defi_modules/domain/operation-type.enum.ts` has `ENABLE_E_MODE = 'ENABLE_E_MODE'`. Ported from OceanFin, no FHE equivalent.

**Fix**: Remove `ENABLE_E_MODE` from backend enum. Remove `EnableEModeSimulator` and its registration in `DefiSimulationEngine`. Remove `shouldAddEnableEMode`, `filterInvalidEnableEMode` from `GeminiAiService`. Update Gemini prompts to never reference `ENABLE_E_MODE`.

### MISS-4: Backend `step-list.ts` has `ENABLE_BORROWING` and `ENABLE_E_MODE`

`backend/apps/src/strategies/infrastructure/helpers/step-list.ts` defines a STEP_TYPE enum with both `ENABLE_BORROWING` and `ENABLE_E_MODE`. Dead code.

**Fix**: Replace with FheForge-specific types: `SHIELD`, `UNSHIELD`, `BORROW`, `SWAP`, `REPAY`, `LIQUIDATE`.

### MISS-5: Backend `strategy-validator.service.ts` warns about missing E-Mode

Lines 277-283: warns "Strategy includes BORROW but no ENABLE_E_MODE - consider adding it for better rates". This is wrong for FheForge — LTV check is on-chain via `borrowWithLtvCheck`.

**Fix**: Remove the E-Mode warning entirely.

### MISS-6: Backend Gemini AI prompts still reference `ENABLE_E_MODE` heavily

`gemini-ai.service.ts` has ~30 references to `ENABLE_E_MODE` in prompt templates. The AI spends tokens reasoning about E-Mode when FheForge doesn't have it. Methods: `shouldAddEnableEMode()`, `filterInvalidEnableEMode()`, `needsEMode` param.

**Fix**: Remove all E-Mode references from Gemini prompts and helper methods.

### MISS-7: Frontend `defi-connection-rules.ts` has OceanFin connection rules

`ui/lib/defi-connection-rules.ts` defines step sequences: `SWAP -> [SUPPLY, SWAP, JOIN_STRATEGY]`, `SUPPLY -> [BORROW]`, etc. These are for OceanFin's step-by-step model. In FheForge, Composer atomically composes all steps.

**Fix**: Replace with Composer-aware rules or remove if the builder UI is Composer-first.

### MISS-8: Frontend `DefiOperationType` still has `JOIN_STRATEGY`

`ui/types/defi.ts`: `DefiOperationType = "JOIN_STRATEGY" | "SWAP" | "SUPPLY" | "BORROW"`. OceanFin separates JOIN_STRATEGY (swap+supply via join pool) from SWAP. FheForge has no join pool — both are just SWAP.

**Fix**: Remove `JOIN_STRATEGY` from `DefiOperationType`. Update ConfigPanel, DefiNode, defi-node-utils, etc.

### MISS-9: Backend sets `agent: 'FHENIX'` for E-Mode steps but frontend uses `AGENT.COFHE = 'COFHE'`

`strategy-parser.service.ts` sets `agent: 'FHENIX'` for ENABLE_E_MODE steps. Frontend `AGENT` enum uses `COFHE`. Inconsistency.

**Fix**: Align backend agent value to `'COFHE'` matching frontend enum.

### MISS-10: `gas-estimation.service.ts` has `ENABLE_E_MODE` gas estimate

`ENABLE_E_MODE: 50000` in gas estimates.

**Fix**: Remove `ENABLE_E_MODE` entry. Add `SHIELD`, `UNSHIELD`, `LIQUIDATE` estimates.

### MISS-11: `strategy-constraints.service.ts` lists `ENABLE_E_MODE` as supported

Lines 168-171: pushes `OperationType.ENABLE_E_MODE` with `supported: true`.

**Fix**: Remove `ENABLE_E_MODE` from supported operations.

### MISS-12: `requestUnshield`/`unshieldWithProof`/`requestBorrowReveal` are commented-out stubs

`use-lending-actions.ts` lines 33-36: these are commented out. Frontend CANNOT call these functions yet. Review mentions "stub" but doesn't call out they're fully disabled.

**Fix**: V3-7 must uncomment AND implement these hooks, not just sync ABIs.

### MISS-13: LendingPool `repay` (user-facing) not addressed in naming

Pool has both `repay(token, amount, InEuint128)` (user-facing) and `repayBorrow(token, amount, euint128)` (Composer-facing). Review renames `repayBorrow` -> `repayFor` but doesn't address `repay`.

**Fix**: Rename `repay` -> `repayDebt` for clarity vs `repayFor`.

### MISS-14: `openLeveragedStrategyDirect` not mentioned — should be the ONLY variant

Composer has both `openLeveragedStrategy` (Permit2-based, dead since P6) and `openLeveragedStrategyDirect` (transferFrom-based, current path). Since P6 removed Permit2, the non-Direct variant is dead.

**Fix**: Remove `openLeveragedStrategy` (Permit2 path). Rename `openLeveragedStrategyDirect` -> `openLeveragedPosition`. Update `useComposer` to only call the Direct variant.

### MISS-15: `RebalanceParams` still references Permit2 structs

Composer's `rebalance` takes `RebalanceParams` with `collateralPermit`/`repayPermit` — Permit2 transfer structs. Dead since P6.

**Fix**: Remove Permit2 fields from `RebalanceParams`. Replace with plain `transferFrom` approach.

### MISS-16: Audit scripts still have Permit2 test cases

`audit-onchain.ts` and `audit-quick.ts` still reference `supplyWithPermit2`, `repayWithPermit2`, `PERMIT2`, `permitTransferFrom` — all dead since P6. All are SKIP.

**Fix**: Remove Permit2 test cases from audit scripts.

### MISS-17: `.gas-baseline.json` still has `supplyWithPermit2`/`repayWithPermit2`

Dead Permit2 gas entries in `contracts/.gas-baseline.json`.

**Fix**: Remove dead Permit2 entries from gas baseline.

### MISS-18: Backend `strategy-parser.service.ts` has `BRIDGE`, `STAKE`, `UNSTAKE` step types

Lines 182-186: accepts `BRIDGE`, `STAKE`, `UNSTAKE` as valid step types. These don't exist in FheForge contracts. No bridging, no staking.

**Fix**: Remove `BRIDGE`, `STAKE`, `UNSTAKE` from accepted step types in parser, validator, and DTO.

---

*18 missing items added after systematic cross-check of all function signatures, frontend enums, backend enums, AI prompts, and dead code.*
