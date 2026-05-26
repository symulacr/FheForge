# FheForge Solidity Repetition Analysis

Grounded on full read of all 6 core contracts (2,081 lines) + SharedStrategyMeta.sol + IStrategyRegistry.sol + V2_REFACTOR_EXECUTION_PLAN.md + CoFHE official docs (FHE.sol v0.1.3, ACL patterns, scaffold-eth, decryption flow, cross-contract handle passing).

---

## Files Analyzed

| Contract | Lines |
|---|---|
| LendingPool.sol | 547 |
| FheForgeComposer.sol | 388 |
| StrategyVault.sol | 330 |
| StrategyRegistry.sol | 330 |
| PriceOracle.sol | 301 |
| SwapRouter.sol | 188 |
| **Total** | **2,081** |

---

## R1. Error definitions duplicated across contracts

| Error | Pool | Composer | Vault | Registry | Oracle | Router |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `ZeroAddress()` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `ZeroAmount()` | ✓ | — | ✓ | — | ✓ | ✓ |
| `OnlyOwner()` | ✓ | — | ✓ | ✓ | ✓ | ✓ |
| `NotOwner()` | — | ✓ | — | — | — | — |
| `TokenMismatch()` | ✓ | — | ✓ | — | — | — |
| `EthTransferFailed()` | ✓ | — | — | — | ✓ | — |
| `TimelockNotElapsed()` | — | — | — | ✓ | — | ✓ |

**Inconsistency**: Composer uses `NotOwner()` while all others use `OnlyOwner()`. Same semantic, different name.

**V2 plan**: P8 replaces `onlyOwner` with `AccessControl` but does NOT propose a shared error library.

---

## R2. `onlyOwner` modifier + `_onlyOwner` internal — copy-pasted 5×

```solidity
modifier onlyOwner() { _onlyOwner(); _; }
function _onlyOwner() internal view {
    if (msg.sender != OWNER) revert OnlyOwner();
}
```

Identical in: Pool, Vault, Registry, Oracle, Router. Composer identical except `revert NotOwner()`.

**V2 plan**: P8 — replace with `AccessControl`. Not yet done.

---

## R3. `OWNER` immutable — declared independently in all 6 contracts

Every contract: `address public immutable OWNER;` + `OWNER = msg.sender;` in constructor.

**V2 plan**: P8 — remove OWNER immutable, replace with AccessControl role. Not done.

---

## R4. `pause()` / `unpause()` — identical boilerplate in 4 contracts

```solidity
function pause() external onlyOwner { _pause(); emit Paused(); }
function unpause() external onlyOwner { _unpause(); emit Unpaused(); }
```

In: Pool, Vault, Router, Composer.

**Bug**: All 4 declare custom `event Paused()` / `event Unpaused()` — but OZ `Pausable` already emits `Paused(address)` / `Unpaused(address)`. Custom events shadow OZ events and lose the `account` parameter.

**V2 plan**: Not addressed.

---

## R5. Timelocked rotation state machine — duplicated in Registry + Router

| Component | Registry (vault rotation) | Router (executor rotation) |
|---|---|---|
| Propose | `proposeVault(address)` | `proposeExecutor(address)` |
| Accept | `acceptVault()` | `acceptExecutor()` |
| Pending | `pendingVault`, `pendingVaultEarliest` | `pendingExecutor`, `pendingExecutorEarliest` |
| Delay | `VAULT_ROTATION_DELAY` immutable | `EXECUTOR_ROTATION_DELAY` immutable |
| Errors | `NoPendingVault`, `TimelockNotElapsed` | `NoPendingExecutor`, `TimelockNotElapsed` |

Same state machine, same logic, different names. Extractable into `TimelockedRotation` mixin.

**V2 plan**: Not addressed.

---

## R6. `_ZERO` immutable euint128 — identical initialization in 3 contracts

```solidity
euint128 private immutable _ZERO;
// constructor:
euint128 z = FHE.asEuint128(0);
FHE.allowThis(z);
_ZERO = z;
```

In: Pool, Vault, Registry.

**V2 plan**: Not addressed. CoFHE best practice (from scaffold-eth + docs): abstract base contract for FHE boilerplate.

---

## R7. `BPS_DEN` + `WAD` constants — duplicated across Pool + Oracle

```solidity
uint256 public constant BPS_DEN = 1e4;  // Pool + Oracle
uint256 public constant WAD = 1e18;     // Pool + Oracle
```

**V2 plan**: Not addressed.

---

## R8. `using SafeERC20 for IERC20` — declared in 4 files

Pool, Composer, Vault, Router. Minor duplication.

**V2 plan**: Not addressed (trivial).

---

## R9. FHE ACL grant pattern — `allowThis + allow(handle, user)` repeated ~15 times

```solidity
FHE.allowThis(newHandle);
FHE.allow(newHandle, user);
```

Occurrences:
- Pool: `_finalizeSupply`, `_finalizeRepay`, `_withdrawCore`, `_finalizeBorrow` (×2), `supplyEth`, `supplyToLending`, `borrowFromLending`, `repayBorrow`, `liquidateWithProof` (×2) — **11 times**
- Vault: via `SharedStrategyMeta.grantPositionAcl` + `grantUpdatedHandle` — **3 callsites** (extracted)
- Registry: `_modifyTvl` — `FHE.allowThis(result)` — **1 time**

Vault already extracts this into `SharedStrategyMeta`. Pool does NOT — inlines the pattern 11×.

**V2 plan**: Not addressed. Plan doesn't propose extending SharedStrategyMeta to Pool.

---

## R10. `FHE.isInitialized(stored) ? FHE.add(stored, incoming) : incoming` — repeated 5× in Pool

```solidity
euint128 newBalance = FHE.isInitialized(stored) ? FHE.add(stored, incoming) : incoming;
```

In: `_finalizeSupply`, `_finalizeBorrow`, `supplyEth`, `supplyToLending`, `borrowFromLending`.

Extractable into `_addToBalance(euint128 stored, euint128 incoming) → euint128`.

**V2 plan**: Not addressed.

---

## R11. User-facing + Composer-facing function pairs — duplicated FHE logic in Pool

| User function | Composer function | Shared logic |
|---|---|---|
| `supply` → `_finalizeSupply` | `supplyToLending` | supply balance increment + ACL |
| `repay` → `_finalizeRepay` | `repayBorrow` | borrow balance decrement + ACL |
| `borrow` → `_finalizeBorrow` | `borrowFromLending` | borrow balance increment + ACL |

Each pair duplicates the encrypted state update. Composer variants take `euint128 handle + address user` instead of `InEuint128 + _msgSender()`, but the FHE math is identical.

**V2 plan**: P1 says "merge overloads" but keeps separate user/Composer paths. No `_updateBalance` shared internal proposed.

---

## R12. InEuint128 + euint128 overloads — 10 duplicate function bodies

| Contract | Function | Overloads |
|---|---|---|
| Vault | `openPosition` | InEuint128 + euint128 (2 bodies) |
| Vault | `addCollateral` | InEuint128 + euint128 (2 bodies) |
| Registry | `incrementTvl` | InEuint128 + euint128 (2 bodies) |
| Registry | `decrementTvl` | InEuint128 + euint128 (2 bodies) |

Each overload pair has nearly identical bodies — InEuint128 version adds `FHE.asEuint128(encAmount)` then calls same logic.

**CoFHE best practice** (from docs): "Contract receives InEuint128, converts once to euint128, then passes euint128 internally." Overloads should share a single internal taking `euint128`.

**V2 plan**: P1 removed `InEuint64` overloads but doesn't address remaining `InEuint128` + `euint128` dual overloads in Vault/Registry.

---

## R13. Composer local interfaces duplicate actual contract interfaces

Composer.sol defines 4 inline interfaces:
- `IRegistry` (lines 10-19) — duplicates `IStrategyRegistry.sol`
- `IStrategyVault` (lines 21-61) — duplicates StrategyVault's actual signatures
- `ILendingPool` (lines 63-106) — duplicates LendingPool's actual signatures
- `ISwapRouter` (lines 108-116) — duplicates SwapRouter's actual signatures

Maintenance hazard: if Pool/Vault/Registry changes, Composer's local interfaces may silently diverge.

**V2 plan**: Not addressed.

---

## R14. `IWETH9` interface defined locally in Pool

4-function interface (`deposit`, `withdraw`, `balanceOf`, `transfer`) instead of importing from shared location.

**V2 plan**: Not addressed.

---

## R15. `SharedStrategyMeta` library underutilized

Currently only used by Vault. Provides `grantPositionAcl` and `grantUpdatedHandle`. Pool does the same `allowThis + allow` pattern 11 times inline.

**V2 plan**: Not addressed.

---

## R16. PriceOracle: `getPriceUsd` + `_normalizePythPrice` — overlapping validation

Both perform same 5 checks: zero price, negative price, confidence floor, confidence ratio, exponent range. `getPriceUsd` has validation inline. `getPriceWithFallback` calls `_normalizePythPrice` which also validates. Two codepaths, same checks.

**V2 plan**: P9 adds fallback/staleness but doesn't deduplicate Pyth validation.

---

## R17. PriceOracle: `isStale` + `_isPythStale` — duplicated staleness logic

`isStale(address)` (public) and `_isPythStale(bytes32, address)` (internal) both compute:
```
age = publishTime > 0 ? block.timestamp - publishTime : block.timestamp - lastPriceUpdate
stale = age > stalenessThreshold
```

`isStale` does NOT call `_isPythStale` — duplicates the same 8-line calculation.

**V2 plan**: Not addressed.

---

## R18. `FHE.allowSender` inconsistency across getter functions

| Contract | Getter | ACL pattern |
|---|---|---|
| Registry | `getEncryptedTvl` | `FHE.allow(v, msg.sender); FHE.allowSender(v);` ✓ |
| Vault | `getCollateral` | `FHE.allow(pos.collateral, _msgSender()); FHE.allowSender(pos.collateral);` ✓ |
| Pool | No getters for supply/borrow balances | ✗ Missing |

CoFHE docs: always `allowSender` on returned encrypted values so caller can `decryptForView`. Pool has no getters — users can only read balances via `requestEmergencyBalance` (`allowPublic`, too permissive).

**V2 plan**: Not addressed.

---

## R19. `FHE.asEuint128` on already-decrypted proof values in `liquidateWithProof`

```solidity
euint128 incomingDebt = FHE.asEuint128(debtBalanceProof);
euint128 repayEnc128 = FHE.asEuint128(uint256(actualDebtCover));
euint128 newDebt = FHE.sub(incomingDebt, FHE.min(repayEnc128, incomingDebt));
```

Pattern: verified plain value → re-encrypt → encrypted subtraction → store. Gas-heavy. Same pattern appears twice (debt + collateral) in one function. Could be factored into `_applySeize` helper.

**V2 plan**: P5 addresses decryption flow but doesn't optimize the re-encryption pattern.

---

## R20. Redundant `Paused`/`Unpaused` custom events shadowing OZ

All 4 Pausable contracts declare:
```solidity
event Paused();
event Unpaused();
```

But OZ's `Pausable._pause()` already emits `Paused(address account)`. Custom events shadow OZ events, lose the `account` parameter, and emit duplicate event logs.

**V2 plan**: Not addressed.

---

## V2 Plan Coverage Summary

| # | Repetition | Plan addresses? | Phase | Done? |
|---|---|:---:|:---:|:---:|
| R1 | Shared errors | ✗ | — | Unplanned |
| R2 | `onlyOwner` + `_onlyOwner` | ✓ | P8 | Not done |
| R3 | `OWNER` immutable | ✓ | P8 | Not done |
| R4 | `pause/unpause` boilerplate | ✗ | — | Unplanned |
| R5 | Timelocked rotation | ✗ | — | Unplanned |
| R6 | `_ZERO` initialization | ✗ | — | Unplanned |
| R7 | `BPS_DEN` / `WAD` constants | ✗ | — | Unplanned |
| R8 | `using SafeERC20` | ✗ | — | Trivial |
| R9 | `allowThis + allow` pattern (×15) | ✗ | — | Unplanned |
| R10 | `isInitialized ? add : incoming` (×5) | ✗ | — | Unplanned |
| R11 | User/Composer function pair duplication | Partial | P1 | Overloads merged only |
| R12 | InEuint128 + euint128 overloads (×10) | Partial | P1 | euint64 gone; InEuint128 remain |
| R13 | Composer local interfaces | ✗ | — | Unplanned |
| R14 | `IWETH9` local interface | ✗ | — | Unplanned |
| R15 | `SharedStrategyMeta` underutilized | ✗ | — | Unplanned |
| R16 | Oracle price validation duplication | ✗ | — | Unplanned |
| R17 | Oracle staleness check duplication | ✗ | — | Unplanned |
| R18 | `allowSender` inconsistency / missing getters | ✗ | — | Unplanned |
| R19 | Re-encryption pattern in liquidation | ✗ | — | Unplanned |
| R20 | Redundant Paused/Unpaused events | ✗ | — | Unplanned |

**3 of 20 addressed** (R2/R3 via P8, R11/R12 partially via P1). **17 of 20 unplanned.**

---

## Recommended Shared Abstractions (per CoFHE docs + scaffold-eth pattern)

### 1. `FheForgeBase.sol` — abstract contract

```
- OWNER / onlyOwner / _onlyOwner
- _ZERO euint128 initialization
- pause() / unpause() (without redundant events — rely on OZ's Paused/Unpaused)
- Common errors: ZeroAddress, ZeroAmount, OnlyOwner
- Common constants: BPS_DEN, WAD
- _grantAcl(euint128 handle, address user) internal
- _initBalance(euint128 stored, euint128 incoming) → euint128 internal
```

### 2. `TimelockedRotation.sol` — mixin

Generic propose/accept state machine for role rotation (vault, executor, etc.).

### 3. `interfaces/` directory

Extract `ILendingPool`, `IStrategyVault`, `IRegistry`, `ISwapRouter`, `IWETH9` from Composer inline definitions to shared files.

### 4. Extend `SharedStrategyMeta.sol`

Add `_grantSingleAcl` and `_initBalance` so Pool can use it.

---

## CoFHE FHE Architecture Violations Found

1. **Pool has no `getSupplyBalance`/`getBorrowBalance` getters with `allowSender`** — users cannot `decryptForView` their own balances. Only `requestEmergencyBalance` exists (uses `allowPublic`, too permissive).

2. **Custom `Paused()`/`Unpaused()` events shadow OZ events** — OZ already emits `Paused(address)`. Custom events lose the account field and emit duplicate logs.

3. **Composer still passes `InEuint128` to Vault's `openPosition`** in `_openVaultPosition` — passes `e.collateral` (InEuint128) instead of `incomingColl` (euint128). The InEuint128 overload on Vault calls `FHE.asEuint128(encAmount)` which requires Vault to be ACL-authorized. With `allowTransient` already granted, the euint128 overload should be used instead. Same bug pattern as the Pool cross-contract fix that was already applied.

4. **Vault + Registry InEuint128 overloads are dead code for Composer flow** — Composer always converts InEuint128 → euint128 + allowTransient before calling. The InEuint128 overloads exist for direct user calls but the Composer is the only caller in practice.

---

*Generated 2026-05-10 from full code read + CoFHE docs cross-reference.*
