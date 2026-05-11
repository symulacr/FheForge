# Dead vs Alive Audit — Permit2 / Zero-Friction / Cross-Chain / Naming

Ground-truth verification against deployed ABIs + contract source + frontend hooks.
Generated: 2026-05-10

## 1. Permit2 Status — Zero-Friction

### Contract layer: FULLY REMOVED ✓

| Item | Status | Evidence |
|---|---|---|
| `FheForgeComposer.sol` Permit2 import | REMOVED | `grep -rn Permit2 contracts/contracts/ → 0 hits` |
| `openLeveragedStrategy` (Permit2 variant) | DOES NOT EXIST | Contract has only ONE `openLeveragedStrategy` using `transferFrom` |
| `openLeveragedStrategyDirect` | DOES NOT EXIST | Never existed in any deployed contract |
| `_pullViaPermit2` internal | DOES NOT EXIST | Not in source |
| `PERMIT2` immutable | DOES NOT EXIST | Composer has `ROUTER`, `POOL`, `VAULT`, `REGISTRY`, `OWNER` only |
| `RebalanceParams` Permit2 fields | DOES NOT EXIST | RebalanceParams = `positionId, collateralToken, addCollateralAmount, repayAmount, repayToken, newBorrowAmount, borrowToken, useOracleBorrow, ltvNum, ltvDen` |
| `LendingPool.sol` Permit2 | REMOVED | No Permit2 imports or refs |
| All other contracts | CLEAN | Zero Permit2 refs in any .sol file |

### Frontend layer: CLEAN (with one BUG) ✓/✗

| Item | Status | Evidence |
|---|---|---|
| `use-permit2.ts` hook | REMOVED | File does not exist |
| `@uniswap/permit2` dependency | REMOVED | Zero hits in ui/ |
| `useComposer.ts` — `openLeveragedStrategy` | ✅ CORRECT | Calls `functionName: "openLeveragedStrategy"` |
| `useComposer.ts` — `openLeveragedStrategyDirect` | 🔴 BUG | Calls `functionName: "openLeveragedStrategyDirect"` — NON-EXISTENT in contract/ABI |
| `useRebalance.ts` — `rebalance` | ✅ CORRECT | Calls `functionName: "rebalance"` via transferFrom |
| CoFHE `permitReady` checks | ✅ CORRECT | These are CoFHE SDK FHE permits, NOT Uniswap Permit2 protocol |
| `execution-modal.tsx` | ✅ CORRECT | Uses `openLeveragedStrategy` (not the Direct variant) |

### Audit script layer: STALE REFERENCES

| File | Line | Issue | Fix |
|---|---|---|---|
| `audit-onchain.ts` | 393 | `skip("Pool", "supplyWithPermit2", ...)` | Function doesn't exist → remove skip entry |
| `audit-onchain.ts` | 452 | `skip("Pool", "repayWithPermit2", ...)` | Function doesn't exist → remove skip entry |
| `audit-onchain.ts` | 533 | `skip("Pool", "permitTransferFrom", ...)` | Function doesn't exist → remove skip entry |
| `audit-onchain.ts` | 937 | `composer.PERMIT2()` | DOES NOT EXIST on Composer → remove read |
| `audit-onchain.ts` | 941 | `read("Composer", "PERMIT2", p2)` | DOES NOT EXIST → remove |
| `audit-onchain.ts` | 944 | `openLeveragedStrategyDirect` comment | Misleading → rename to just openLeveragedStrategy |
| `audit-onchain.ts` | 964,988,996,1007,1024 | "Direct" naming | Remove "Direct" suffix — there's only one path now |
| `audit-onchain.ts` | 1187-1190 | FHE issue about Permit2 UX friction | OBSOLETE — Permit2 removed → remove entire issue entry |
| `audit-onchain.ts` | 1229-1232 | Priority 5: Reduce Permit2 UX friction | OBSOLETE → remove |

### Zero-friction flow — CURRENT STATE

```
Before (with Permit2):
  1. user approves Pool (ERC20 approve)
  2. user approves Composer (ERC20 approve)
  3. user signs Permit2 EIP-712 (off-chain)
  4. user submits tx
  = 3 wallet interactions + 1 tx

After (transferFrom only):
  1. user approves Composer (ERC20 approve) — only once
  2. user submits tx (Composer does transferFrom internally)
  = 1 wallet interaction + 1 tx
```

**Status: COMPLETE.** The only remaining issue is the dead `openLeveragedStrategyDirect` export in `useComposer.ts` and stale audit script references.

---

## 2. Cross-Chain Capability

| Component | Function | In Contract | In ABI | In Frontend | Status |
|---|---|---|---|---|---|
| StrategyRegistry | `broadcastStrategy(uint256 strategyId, uint256 destinationDomain)` | ✓ | ✓ | ✗ | 🟡 Alive, not wired |
| StrategyRegistry | `receiveCrossChainStrategy(...)` | ✓ | ✓ | ✗ | 🟡 Alive, not wired |
| StrategyRegistry | `localDomain()` | ✓ | ✓ | ✗ | 🟡 Alive, not wired |
| Event | `CrossChainMessage` | ✓ | ✓ | ✗ | 🟡 Alive, not wired |

**Status: Infrastructure EXISTS in contract + ABI. Not wired to frontend. Event-only relay pattern (no Hyperlane). This is CORRECT per P10 design decision — off-chain relayer needed, no on-chain bridge dependency.**

**No dead code.** Cross-chain functions are intentionally dormant until relayer exists.

---

## 3. ABI Staleness — CRITICAL BLOCKER

The ABIs in `ui/abis/` are from a PRE-Wave17 deployment. Multiple functions exist in the live contracts but NOT in the ABIs:

### LendingPool — MISSING from ABI (3 cross-contract + 0 user-facing)

| Function | In Contract | In ABI | Called By |
|---|---|---|---|
| `supplyToLending(address, uint256, euint128, address)` | ✓ | ✗ | Composer only |
| `borrowFromLending(address, uint256, euint128, address)` | ✓ | ✗ | Composer only |
| `repayBorrow(address, uint256, euint128, address)` | ✓ | ✗ | Composer only |

These are `onlyComposer`-gated — the frontend will NEVER call them directly. But the ABI should still include them for completeness and for the Composer's inline interface verification.

**No user-facing functions are missing from the ABI.** The 3 missing functions are all cross-contract internal calls.

### LendingPool — Functions in ABI but NOT in contract (2)

| Function | In Contract | In ABI | Called By Frontend |
|---|---|---|---|
| `liquidate(user, collateralToken, debtToken, debtToCover)` | ✗ | ✗ | YES — `useLendingActions.liquidate()` |
| `emergencyWithdraw(token)` | ✗ | ✗ | YES — `useLendingActions.emergencyWithdraw()` |

**These are FRONTEND BUGS.** The Pool contract has NO `liquidate` function (it uses `liquidateWithProof` instead). And `emergencyWithdraw` only exists on Vault, not Pool.

### Composer — Functions in frontend but NOT in contract (1)

| Function | In Contract | In ABI | Called By Frontend |
|---|---|---|---|
| `openLeveragedStrategyDirect` | ✗ | ✗ | YES — `useComposer.openLeveragedStrategyDirect()` |

---

## 4. Frontend → Contract Call Matrix (COMPLETE)

### useComposer.ts

| Export | functionName | In ABI | In Contract | Status |
|---|---|---|---|---|
| `openLeveragedStrategy` | `openLeveragedStrategy` | ✓ | ✓ | ✅ ALIVE |
| `openLeveragedStrategyDirect` | `openLeveragedStrategyDirect` | ✗ | ✗ | 🔴 DEAD — calls non-existent function |
| `encrypt128` | (helper) | — | — | ✅ ALIVE |
| `encrypt128ForComposer` | (helper, uses setAccount) | — | — | ✅ ALIVE |

### useRebalance.ts

| Export | functionName | In ABI | In Contract | Status |
|---|---|---|---|---|
| `rebalance` | `rebalance` | ✓ | ✓ | ✅ ALIVE |
| `rebalanceWithEncrypt` | (helper) | — | — | ✅ ALIVE |
| `encryptRebalanceParams` | (helper) | — | — | ✅ BUG: uses `Encryptable.uint64` for repay/newBorrow — should be `uint128` |

### useLendingActions.ts

| Export | functionName | Target | In ABI | In Contract | Status |
|---|---|---|---|---|---|
| `liquidate` | `liquidate` | Pool | ✗(abi) | ✗(contract) | 🔴 DEAD — no such function in Pool |
| `requestLiquidationCheck` | `requestLiquidationCheck` | Pool | ✓ | ✓ | ✅ ALIVE |
| `liquidateWithProof` | `liquidateWithProof` | Pool | ✓ | ✓ | ✅ ALIVE |
| `checkLtvAndBorrow` | `checkLtvAndBorrow` | Pool | ✓ | ✓ | ✅ ALIVE |
| `borrowWithOracle` | `borrowWithOracle` | Pool | ✓ | ✓ | ✅ ALIVE |
| `emergencyWithdraw` | `emergencyWithdraw` | Pool | ✗(abi) | ✗(contract) | 🔴 DEAD — Pool has no emergencyWithdraw; Vault has it |
| `isSupported` | `isSupported` | Oracle | ✓ | ✓ | ✅ ALIVE |

### useFheVault.ts

| Export | functionName | Target | In ABI | In Contract | Status |
|---|---|---|---|---|---|
| `openPosition` | `openPosition` | Vault | ✓ | ✓ | ✅ ALIVE |
| `addCollateral` | `addCollateral` | Vault | ✓ | ✓ | ✅ ALIVE |
| `closePosition` | `closePosition` | Vault | ✓ | ✓ | ✅ ALIVE |
| `repay` | `repay` | Pool | ✓ | ✓ | ✅ ALIVE |
| `withdrawSupply` | `withdraw` | Pool | ✓ | ✓ | ✅ ALIVE (but name mismatch: hook says "withdrawSupply", calls "withdraw") |
| `submitSwapIntent` | `submitSwapIntent` | Router | ✓ | ✓ | ✅ ALIVE |
| `supplyEth` | `supplyEth` | Pool | ✓ | ✓ | ✅ ALIVE |
| `withdrawEth` | `withdrawEth` | Pool | ✓ | ✓ | ✅ ALIVE |
| `getUserPositions` | `getUserPositions` | Vault | ✓ | ✓ | ✅ ALIVE |
| `emergencyWithdraw` | — | — | — | — | ✅ NOT CALLED (Vault has it but hook doesn't expose it) |

### useSwapRouter.ts

| Export | functionName | In ABI | In Contract | Status |
|---|---|---|---|---|
| `getIntentMeta` | `getIntentMeta` | ✓ | ✓ | ✅ ALIVE |
| `cancelIntent` | `cancelIntent` | ✓ | ✓ | ✅ ALIVE |
| `executeIntent` | `executeIntent` | ✓ | ✓ | ✅ ALIVE |

### useStrategyRegistry.ts

| Export | functionName | In ABI | In Contract | Status |
|---|---|---|---|---|
| `registerStrategy` | `registerStrategy` (2-arg) | ✓ | ✓ | ✅ ALIVE |
| `registerStrategyWithParams` | `registerStrategy` (4-arg) | ✓ | ✓ | ✅ ALIVE |
| `setActive` | `setActive` | ✓ | ✓ | ✅ ALIVE |
| `getStrategyMeta` | `getStrategyMeta` | ✓ | ✓ | ✅ ALIVE |
| `getStrategyParams` | `getStrategyParams` | ✓ | ✓ | ✅ ALIVE |
| `strategyCount` | `strategyCount` | ✓ | ✓ | ✅ ALIVE |
| `broadcastStrategy` | — | — | — | ✅ NOT WIRED (intentional) |
| `receiveCrossChainStrategy` | — | — | — | ✅ NOT WIRED (intentional) |

### usePortfolio.ts

| Export | functionName | Target | In ABI | In Contract | Status |
|---|---|---|---|---|---|
| `getUserPositions` | `getUserPositions` | Vault | ✓ | ✓ | ✅ ALIVE |
| `getPositionMeta` | `getPositionMeta` | Vault | ✓ | ✓ | ✅ ALIVE |
| `getDepositedAmount` | `getDepositedAmount` | Vault | ✓ | ✓ | ✅ ALIVE |
| `getCollateral` | `getCollateral` | Vault | ✓ | ✓ | ✅ ALIVE |

### usePriceOracle.ts

| Export | functionName | In ABI | In Contract | Status |
|---|---|---|---|---|
| `getPriceUsd` | `getPriceUsd` | ✓ | ✓ | ✅ ALIVE |
| `getPythUpdateFee` | `getPythUpdateFee` | ✓ | ✓ | ✅ ALIVE |
| `updatePriceFeeds` | `updatePriceFeeds` | ✓ | ✓ | ✅ ALIVE |
| `convertToUsd` | `convertToUsd` | ✓ | ✓ | ✅ ALIVE |
| `convertFromUsd` | `convertFromUsd` | ✓ | ✓ | ✅ ALIVE |
| `isSupported` | `isSupported` | ✓ | ✓ | ✅ ALIVE |
| `isStale` | `isStale` | ✓ | ✓ | ✅ ALIVE |
| `lastPriceUpdate` | `lastPriceUpdate` | ✓ | ✓ | ✅ ALIVE |
| `stalenessThreshold` | `stalenessThreshold` | ✓ | ✓ | ✅ ALIVE |

---

## 5. Dead Code Inventory — MUST REMOVE Before Frontend Refactor

### 🔴 CRITICAL (will cause runtime revert)

| ID | File | Line(s) | Dead Code | Why Dead | Fix |
|---|---|---|---|---|---|
| BUG-1 | `ui/hooks/use-composer.ts` | 108-119 | `openLeveragedStrategyDirect()` | Calls non-existent function | DELETE function + export |
| BUG-2 | `ui/hooks/use-lending-actions.ts` | ~80-87 | `liquidate()` | Pool has no `liquidate` — only `liquidateWithProof` | DELETE or redirect to `liquidateWithProof` |
| BUG-3 | `ui/hooks/use-lending-actions.ts` | ~165-172 | `emergencyWithdraw(token)` | Pool has no `emergencyWithdraw` — only Vault has it | DELETE from lending hook; add to vault hook |

### 🟡 STALE AUDIT SCRIPTS

| ID | File | Line(s) | Dead Code | Why Dead | Fix |
|---|---|---|---|---|---|
| STALE-1 | `audit-onchain.ts` | 393 | `skip("Pool", "supplyWithPermit2", ...)` | Function never existed in deployed contracts | DELETE skip entry |
| STALE-2 | `audit-onchain.ts` | 452 | `skip("Pool", "repayWithPermit2", ...)` | Same | DELETE skip entry |
| STALE-3 | `audit-onchain.ts` | 533 | `skip("Pool", "permitTransferFrom", ...)` | Same | DELETE skip entry |
| STALE-4 | `audit-onchain.ts` | 937 | `composer.PERMIT2()` read | Composer has no PERMIT2 immutable | DELETE read |
| STALE-5 | `audit-onchain.ts` | 941 | `read("Composer", "PERMIT2", p2)` | Same | DELETE |
| STALE-6 | `audit-onchain.ts` | 944,964,988,996,1007,1024 | "Direct" naming in comments/tests | There's only one path now | Remove "Direct" suffix |
| STALE-7 | `audit-onchain.ts` | 1187-1190 | FHE issue about Permit2 UX friction | Permit2 fully removed | DELETE issue entry |
| STALE-8 | `audit-onchain.ts` | 1229-1232 | Priority 5: Reduce Permit2 UX | Same | DELETE |

### 🟡 FRONTEND DEAD ENUMS/CONSTANTS

| ID | File | Dead Code | Why Dead | Fix |
|---|---|---|---|---|
| DEAD-1 | `ui/utils/constant.ts` | `EMODE_CATEGORY` enum | No E-Mode in FheForge (OceanFin relic) | DELETE enum |
| DEAD-2 | `ui/utils/constant.ts` | `STEP_TYPE.ENABLE_E_MODE` | No E-Mode in FheForge | DELETE from enum |
| DEAD-3 | `ui/utils/constant.ts` | `STEP_TYPE.ENABLE_BORROWING` | No such step in FheForge (OceanFin relic) | DELETE from enum |
| DEAD-4 | `ui/utils/constant.ts` | `STEP_TYPE.JOIN_STRATEGY` | Same as SWAP in FheForge context | RENAME to SWAP (or keep as alias) |
| DEAD-5 | `ui/types/defi.ts` | `DefiOperationType.JOIN_STRATEGY` | OceanFin relic | RENAME to SWAP |

### 🟡 FRONTEND DEAD STEP REFERENCES (use after DEAD-2/3/4 fix)

| ID | File | Reference | Fix |
|---|---|---|---|
| REF-1 | `execution-modal.tsx:62,64,66,77,79,81` | `STEP_TYPE.ENABLE_BORROWING`, `ENABLE_E_MODE`, `JOIN_STRATEGY` cases | Remove ENABLE_BORROWING + ENABLE_E_MODE cases; rename JOIN_STRATEGY→SWAP |
| REF-2 | `StrategySteps.tsx:29,37,46,54` | Same step type cases | Same |
| REF-3 | `StrategyFlowPreview.tsx:29` | `step.type !== "ENABLE_E_MODE"` filter | Remove filter (no E-Mode steps exist) |
| REF-4 | `ai-strategy-service.ts:102,105,106` | E-Mode skip logic | Remove E-Mode skip |
| REF-5 | `DefiNode.tsx:59` | `"JOIN_STRATEGY"` case | RENAME to SWAP |
| REF-6 | `ConfigPanel.tsx:59,132,435` | `"JOIN_STRATEGY"` references | RENAME to SWAP |
| REF-7 | `defi-node-utils.ts:14,29,78` | `"JOIN_STRATEGY"` references | RENAME to SWAP |
| REF-8 | `use-strategy-builder.ts:422` | `JOIN_STRATEGY` filter | RENAME to SWAP |

### 🟡 BACKEND DEAD CODE

| ID | File | Dead Code | Why Dead | Fix |
|---|---|---|---|---|
| BDEAD-1 | `agent-list.ts` | `FHENIX = 'FHENIX'` | Should be `COFHE` (matches ui/constant.ts AGENT.COFHE) | RENAME to COFHE |
| BDEAD-2 | `step-list.ts` | `JOIN_STRATEGY`, `ENABLE_BORROWING`, `ENABLE_E_MODE` | No FheForge equivalent | DELETE ENABLE_BORROWING + ENABLE_E_MODE; RENAME JOIN_STRATEGY→SWAP |
| BDEAD-3 | `strategy-step-response.dto.ts` | `BRIDGE`, `STAKE`, `UNSTAKE` in allowed types | No FheForge equivalent | DELETE |
| BDEAD-4 | `gas-estimation.service.ts` | `BRIDGE`, `STAKE`, `UNSTAKE` gas estimates | Same | DELETE |
| BDEAD-5 | `strategy-parser.service.ts` | `BRIDGE`, `STAKE`, `UNSTAKE` in valid types | Same | DELETE |
| BDEAD-6 | `strategy-validator.service.ts` | `BRIDGE`, `STAKE`, `UNSTAKE` in allowed types | Same | DELETE |
| BDEAD-7 | `defi-simulation-engine.service.ts` | `JOIN_STRATEGY`, `ENABLE_E_MODE` cases | DELETE ENABLE_E_MODE case; RENAME JOIN_STRATEGY→SWAP |
| BDEAD-8 | `strategy-step-response.dto.ts` | `'FHENIX'` example agent | Should be `COFHE` | RENAME |
| BDEAD-9 | `strategy-templates.service.ts` | All `agent: 'FHENIX'` entries | Should be `COFHE` | RENAME |
| BDEAD-10 | `event-indexer.service.ts` | `FHENIX_RPC` config key | Should be `COFHE_RPC` or `ARBITRUM_SEPOLIA_RPC` | RENAME |
| BDEAD-11 | `supply-simulator.ts`, `borrow-simulator.ts` | `FHENIX_RPC` config | Same | RENAME |

---

## 6. Naming Audit — Short, Understandable, Follows Contract Architecture

Current naming is INCONSISTENT: some Aave-style (`supply`, `withdraw`), some hybrid (`supplyToLending`, `borrowFromLending`), some FHE-native (`requestUnshield`, `unshieldWithProof`).

### User-facing Pool functions (what users call directly)

| Current Name | Proposed Name | Length | Rationale |
|---|---|---|---|
| `supply` | `shield` | 6 | FHE lifecycle: encrypt + lock = shield |
| `supplyEth` | `shieldEth` | 9 | ETH variant |
| `withdraw` | `partialUnshield` | 15 | Partial exit: encrypted sub + plain transfer |
| `withdrawEth` | `partialUnshieldEth` | 18 | ETH variant |
| `repay` | `repayDebt` | 9 | User repays own debt |
| `borrowWithOracle` | `borrow` | 6 | Oracle-priced borrow — the only borrow path users have |
| `checkLtvAndBorrow` | `borrowWithLtvCheck` | 18 | LTV-gated borrow (explicit) |
| `requestEmergencyBalance` | `requestBalanceReveal` | 20 | allowPublic for own balance |
| `emergencyWithdrawWithProof` | `withdrawPausedWithProof` | 23 | Only when paused |
| `requestLiquidationCheck` | `requestLiquidityCheck` | 22 | allowPublic for liquidation |
| `liquidateWithProof` | `liquidateWithProof` | 18 | Already good |
| `requestUnshield` *(stub)* | `requestUnshield` | 15 | Full exit step 1: allowPublic |
| `unshieldWithProof` *(stub)* | `unshieldWithProof` | 18 | Full exit step 2: verify + transfer |
| `requestBorrowReveal` *(stub)* | `requestBorrowReveal` | 20 | allowPublic for borrow amount |

### Composer cross-contract functions (onlyComposer-gated)

| Current Name | Proposed Name | Length | Rationale |
|---|---|---|---|
| `supplyToLending` | `depositFor` | 10 | Composer deposits for user |
| `borrowFromLending` | `borrowFor` | 9 | Composer borrows for user |
| `repayBorrow` | `repayFor` | 8 | Composer repays for user |

### Composer user-facing functions

| Current Name | Proposed Name | Length | Rationale |
|---|---|---|---|
| `openLeveragedStrategy` | `openPosition` | 12 | Composer wraps Vault.openPosition + Pool + Router |
| `rebalance` | `rebalance` | 9 | Already good |
| `sweepToken` | `sweepToken` | 10 | Already good (admin) |

### Vault functions (already good naming)

| Current Name | Proposed Name | Length | Keep? |
|---|---|---|---|
| `openPosition` | `openPosition` | 12 | ✓ |
| `addCollateral` | `addCollateral` | 13 | ✓ |
| `closePosition` | `closePosition` | 13 | ✓ |
| `emergencyWithdraw` | `withdrawPaused` | 14 | Only when paused; parallel with Pool |
| `getUserPositions` | `getUserPositions` | 16 | ✓ |
| `getCollateral` | `getCollateral` | 13 | ✓ |
| `getDepositedAmount` | `getDepositedAmount` | 17 | ✓ |
| `getPositionMeta` | `getPositionMeta` | 15 | ✓ |

---

## 7. Rebalance Hook Bug — uint64 vs uint128

`useRebalance.ts` encrypts `repayAmount` and `newBorrowAmount` as `Encryptable.uint64()` but the contract expects `InEuint128`. After P1 (euint128 migration), this should use `Encryptable.uint128()`:

```
Line 52: .encryptInputs([Encryptable.uint64(params.repayAmount)])  // BUG: should be uint128
Line 58: .encryptInputs([Encryptable.uint64(params.newBorrowAmount)])  // BUG: should be uint128
```

---

## 8. Summary — Priority Fixes Before Frontend Refactor

### Must fix (will cause revert)

1. **BUG-1**: Remove `openLeveragedStrategyDirect` from `useComposer.ts`
2. **BUG-2**: Remove `liquidate()` from `useLendingActions.ts` (Pool has no such function)
3. **BUG-3**: Remove `emergencyWithdraw()` from `useLendingActions.ts` (Pool doesn't have it; Vault does)
4. **BUG-4**: Fix `useRebalance.ts` uint64→uint128 for repay/newBorrow encryption

### Should fix (stale references, no runtime impact)

5. Clean audit-onchain.ts Permit2 SKIP entries and PERMIT2 reads
6. Remove `EMODE_CATEGORY` enum from `constant.ts`
7. Remove `ENABLE_E_MODE` and `ENABLE_BORROWING` from `STEP_TYPE` enum
8. Rename `JOIN_STRATEGY` → `SWAP` in frontend + backend (10+ files)
9. Remove `BRIDGE`/`STAKE`/`UNSTAKE` from backend (6 files)
10. Rename `FHENIX` → `COFHE` in backend agent list + templates (12+ refs)

### ABI sync

11. Regenerate ABIs from latest compiled contracts (3 missing Pool functions)
12. After rename: update ABIs with new function names

### Naming refactor (requires contract changes + redeploy)

13. Rename `supply`→`shield`, `withdraw`→`partialUnshield`, `supplyToLending`→`depositFor`, etc.
14. This requires contract redeployment — defer until V3-2 phase
