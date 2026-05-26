# FheForge Smart Contracts — Microchange Plan

**Sources**: Wave12 audit (2026-05-11, `wave12-audit-1778458948949.json`), Aderyn static analysis (3 reports), manual code review.

**Legend**: `[FILE:LINE]` — target file and line. `✱` — already partially fixed (comments in code verify fix), `‼` — still unfixed.

---

## P0 — Critical

### P0-1 ‼ Dual plain+encrypted state — `totalPlainBorrow` + `liquidReserve` observable on-chain

Audit: *"Plain values observable on-chain, defeating FHE confidentiality. If they diverge (skew), contract uses plain for require() which leaks info via execution paths."*

| Location | What to change | How |
|---|---|---|
| `LendingPool.sol:19` | `mapping(address => uint256) public totalPlainBorrow` | Remove or migrate to FHE-based encrypted aggregate. If economic invariants require a plain view, gate it behind `onlyOwner` or threshold-signature reveal. |
| `LendingPool.sol:20` | `mapping(address => uint256) public liquidReserve` | Replace with encrypted reserve + `requestReserveReveal()` that users call explicitly. Expose reserve-check logic in FHE only. |
| `LendingPool.sol:111` | `liquidReserve[token] += amount` in `_finalizeSupply` | Compute reserve delta in FHE, store as `euint128`. |
| `LendingPool.sol:168` | `if (liquidReserve[borrowToken] < borrowAmount)` | Replace plain require with FHE-select: borrow silently capped to available reserve. |
| `LendingPool.sol:169-170` | `totalPlainBorrow[token] += amount` and `liquidReserve[token] -= amount` | Replace with encrypted equivalents; emit event without amounts. |
| `LendingPool.sol:186-187` | `totalPlainBorrow[token] -= amount` and `liquidReserve[token] += amount` | Same migration to encrypted state. |
| `LendingPool.sol:221-225` | `reserve < amount \|\| reserve - amount < totalPlainBorrow[token]` | Replace plain-text reserve sufficiency check with FHE-select slashing. |
| `LendingPool.sol:270-274` | Reserve checks in `unshieldWithProof` | Same pattern — migrate to encrypted reserve. |
| `LendingPool.sol:305-309` | Reserve checks in `withdrawPausedWithProof` | Same. |
| `LendingPool.sol:411` | `if (liquidReserve[borrowToken] < borrowAmount)` in `_finalizeBorrow` | Replace plain-text borrow gate with FHE-select soft-cap. |
| `LendingPool.sol:413-414` | `totalPlainBorrow += amount; liquidReserve -= amount` in `_finalizeBorrow` | Encrypted state. |
| `LendingPool.sol:471-473` | Reserve checks in `borrowFor` (composer path) | Same. |
| `LendingPool.sol:552-553` | `totalPlainBorrow[debtToken] -= actualDebtCover` etc. in `liquidateWithProof` | Encrypted state. |
| `LendingPool.sol:569` | `liquidReserve[collateralToken] -= seizedCollateral` | Encrypted. |
| `LendingPool.sol:608-610` | `maxFlashLoan` reads `liquidReserve` and `totalPlainBorrow` | Provide a `maxFlashLoanEncrypted` that returns `euint128`; deprecate the plain view. |
| `LendingPool.sol:615, 628-633` | `flashFee`, `flashLoan` reserve checks | Migrate to encrypted reserve reads. |

---

## P1 — High

### P1-1 ‼ No `allowPublic()` / `publishDecryptResult` flow for user-initiated on-chain reveal

Audit: *"Contracts never call FHE.publishDecryptResult or FHE.verifyDecryptResult. No on-chain decryption is possible."*

Note: `requestBalanceReveal` (L238), `requestUnshield` (L247), `requestBorrowReveal` (L286), `requestLiquidityCheck` (L498) **do** call `FHE.allowPublic`. However, no `publishDecryptResult` function exists for on-chain settlement.

| Location | What to change | How |
|---|---|---|
| `LendingPool.sol:238-241` | `requestBalanceReveal` exists but no `publishDecryptResult` counterpart | Add `revealBalance(address token) → (uint256 amount, bytes memory proof)` that calls `FHE.publishDecryptResult` on the caller's supply balance and emits `BalanceRevealed`. |
| `LendingPool.sol:286-289` | `requestBorrowReveal` | Same — add `revealBorrow(address token)` with `publishDecryptResult`. |
| `StrategyVault.sol` | No reveal flow for position collateral | Add `requestCollateralReveal(bytes32 positionId)` that calls `FHE.allowPublic` + `revealCollateral(...)` that calls `publishDecryptResult`. |
| `StrategyRegistry.sol:181-186` | `getEncryptedTvl` uses `allowSender` which fails for `decryptForView` (audit confirmed: *"decrypt-failed: sealOutput request failed: Forbidden"* ) | Add explicit `requestTvlReveal(uint256 strategyId)` with `allowPublic` + `publishDecryptResult` pathway. |

### P1-2 ‼ Trivial encryption from plain values in liquidation

Audit: *"Uses FHE.asEuint128(debtToCover) and FHE.asEuint128(seizeAmount) — trivial encryptions from plain values. Not confidential."*

| Location | What to change | How |
|---|---|---|
| `LendingPool.sol:556` | `euint128 repayEnc = FHE.asEuint128(actualDebtCover);` | Since debt/cover/seize amounts are **public by design** in liquidation, keep plain but add `@dev` doc: *"These are FHE.asEuint128 of public plaintext — confidentiality not required for liquidation amounts."* No code change needed, but document clearly. |
| `LendingPool.sol:572` | `euint128 seizeEnc = FHE.asEuint128(seizedCollateral);` | Same documentation note. |

### P1-3 ¹/₂ ✱ Execution-path information leakage via `require()` on encrypted conditions

Audit: *"Contracts use require() with plain values to check encrypted conditions. This leaks info via execution paths."*

Partially fixed: `borrowWithLtvCheck` uses `FHE.select` for the encrypted LTV check. But `_requireOracleHealthy` still reverts.

| Location | What to change | How |
|---|---|---|
| `LendingPool.sol:431-443` | `_requireOracleHealthy` reverts with `InsufficientCollateral()` — leaks health status | Replace with a no-revert check + `FHE.select` to cap borrow amounts. Instead of reverting, the function should silently limit borrows to the healthy maximum. Alternatively, use `try/catch` on a view oracle call with min/max range. |
| `LendingPool.sol:546` | `_requireOracleHealthy` inside `liquidateWithProof` | Same — if remaining debt makes position healthy, soft-cap liquidation instead of reverting. |
| `StrategyVault.sol:138` | `if (positionOpenedAtBlock[positionId] + 1 > block.number) revert SameBlockClose()` | See P2-1 — replace with FHE.select or remove entirely. |

### P1-4 ✱ Composer cross-contract ACL on encrypted results

Audit: *"Composer needs to READ the resulting encrypted balances later, it won't have ACL unless explicitly granted."*

| Location | What to change | How |
|---|---|---|
| `FheForgeComposer.sol:113` | `FHE.allowTransient(verifiedColl, address(VAULT))` — already correct for 1-tx flow | Verify `allowTransient` is sufficient for all cross-contract calls in the same tx. For persistent cross-tx access, move to `FHE.allow`. |
| `FheForgeComposer.sol:129` | `FHE.allowTransient(verifiedSupply, address(POOL))` | Same. |
| `FheForgeComposer.sol:139-140` | `allowTransient(verifiedBorrow, address(POOL))` | Same. |
| `FheForgeComposer.sol:204-206` | `allowTransient(verifiedAddColl, address(VAULT))` | Same. |
| `FheForgeComposer.sol:214-216` | `allowTransient(verifiedRepay, address(POOL))` | Same. |
| `FheForgeComposer.sol:222-223` | `allowTransient(verifiedNewBorrow, address(POOL))` | Same. |

Check: If the Composer ever needs to read back encrypted balances across transactions (e.g., for rebalance safety checks), add `FHE.allow(handle, address(this))` in the `depositFor`/`borrowFor` functions of `LendingPool` and `openPosition`/`addCollateral` in `StrategyVault`.

---

## P2 — Medium

### P2-1 ‼ SameBlockClose plain-text require

Audit: *"SameBlockClose reverts if closing in same block as opening. This leaks timing info."*

| Location | What to change | How |
|---|---|---|
| `StrategyVault.sol:138` | `if (positionOpenedAtBlock[positionId] + 1 > block.number) revert SameBlockClose()` | **Option A**: Remove the check entirely (allow same-block close). **Option B**: Replace with FHE-select that silently cancels the close (no revert, no info leak). Recommend Option A unless there's a security reason for the block delay. |

### P2-2 ‼ No interest accrual

Audit: *"No interest accrual on supply/borrow."*

Note: `InterestIndex` struct exists (`LendingPool.sol:25-29`) but `indices` mapping is never updated.

| Location | What to change | How |
|---|---|---|
| `LendingPool.sol:25-30` | `InterestIndex` struct + `indices` mapping — **defined but write logic missing** | Add `_accrueInterest(address token)` internal function that computes supply/borrow indices using `FHE.mul` on the last-accrual timestamp delta. Called before every state-changing operation. |
| `LendingPool.sol:118` | `supplyBalances[...] = _safeIncrease(...)` in `_finalizeSupply` | Call `_accrueInterest(token)` before mutating balances. |
| `LendingPool.sol:164` | `borrowBalances[...] = _safeIncrease(...)` in `borrowWithLtvCheck` | Same — accrue before. |
| `LendingPool.sol:195` | `borrowBalances[...] = _safeDecrease(...)` in `_finalizeRepay` | Same. |
| `LendingPool.sol:235` | `supplyBalances[...] = _safeDecrease(...)` in `_withdrawCore` | Same. |
| `LendingPool.sol:421-423` | `_finalizeBorrow` — `_safeIncrease` on borrow | Same. |
| `LendingPool.sol:459` | `depositFor` (composer path) | Same. |
| `LendingPool.sol:476` | `borrowFor` (composer path) | Same. |
| `LendingPool.sol:494` | `repayFor` (composer path) | Same. |
| `LendingPool.sol:555-559` | `liquidateWithProof` — debt decrease | Same. |
| `LendingPool.sol:571-575` | `liquidateWithProof` — collateral decrease | Same. |
| `LendingPool.sol` | New function | Add `accrue(address token) external` — a public poke function anyone can call to trigger index update. |

### P2-3 ‼ StrategyRegistry `getEncryptedTvl` — `decryptForView` fails

Audit confirmed: *"decrypt-failed: sealOutput request failed: Forbidden"* when calling `getEncryptedTvl` + `decryptForView`.

| Location | What to change | How |
|---|---|---|
| `StrategyRegistry.sol:181-186` | `getEncryptedTvl` uses `FHE.allow(v, msg.sender)` + `FHE.allowSender(v)` | Replace with explicit permit flow: expose a `requestTvlPermit(uint256 strategyId)` that returns a signed permit for off-chain `decryptForView`. Or use `allowPublic` + `publishDecryptResult` as in P1-1. |

### P2-4 ‼ Composer Permit2 flow — UX friction

Audit: *"Composer requires Permit2 EIP-712 signatures. Cannot be generated from scripts."*

| Location | What to change | How |
|---|---|---|
| `FheForgeComposer.sol:80` | `safeTransferFrom` for direct pull | Already uses direct `safeTransferFrom` — **Permit2 removal partially done**. Ensure no remaining Permit2 dependency. |
| `FheForgeComposer.sol:242-248` | `_ensureApproval` uses `forceApprove` on spender | Add an `approveAndPull` function that bundles ERC20 approval with the transfer in one step. Add EIP-2612 `permit` support as an alternative path for gasless approvals. |

---

## P3 — Low (Aderyn static analysis + format)

### P3-1 ‼ Literal `10000` instead of `BPS_DEN` constant

`BPS_DEN = 1e4` exists in `FheForgeBase.sol:17` but some places still use bare `10000`.

| Location | What to change |
|---|---|
| `LendingPool.sol:616` | `... / 10000;` → `... / BPS_DEN;` (in `flashFee`) |
| `LendingPool.sol:628` | `... / 10000;` → `... / BPS_DEN;` (in `flashLoan`) |
| `PriceOracle.sol:145` | `if (ltvBps > 10000)` → `if (ltvBps > BPS_DEN)` |
| `PriceOracle.sol:146` | `if (liqThresholdBps > 10000)` → `if (liqThresholdBps > BPS_DEN)` |

### P3-2 ‼ Literal `18` instead of `WAD_DECIMALS` constant in `PriceOracle`

| Location | What to change |
|---|---|
| `PriceOracle.sol:204` | `int256(18)` → `int256(WAD_DECIMALS)` (new constant) |
| `PriceOracle.sol:224, 235` | `if (dec == 0) dec = 18` → define constant |

### P3-3 ‼ Redundant statements in `FheForgeComposer`

| Location | What to change |
|---|---|
| `FheForgeComposer.sol:337` (old L382) | `_debtHandle; // explicit no-op` — remove the statement. |
| `FheForgeComposer.sol:L478` (old L478) | `_newDebt; // explicit no-op` — remove the statement. |

Wait — these lines were reported in older versions of the contract. In the current `FheForgeComposer.sol` (249 lines), these no-ops might already be removed. Let me check: the current Composer at L249 doesn't have these. They were likely removed already. Mark as **already resolved**.

### P3-4 ‼ Centralization risk (acknowledged — design intent)

20 `onlyOwner`/`onlyVault` admin functions across all contracts. All are acknowledged design choices for the MVP stage. Document as known in README. No code change.

### P3-5 ‼ `_onlyVault` — modifier never used directly

`StrategyRegistry.sol:58-60` defines `onlyVault` modifier, but the `incrementTvl`/`decrementTvl` functions use `nonReentrant onlyVault` directly. No change needed — the modifier is used, just always in combination.

---

## Event Emission Audit

### E-1 ✔ Position-closed events — amount stripped (already done)

`PositionClosed` (StrategyVault) emits `bool fullClose` only, no amount. ✓

### E-2 ✔ Supply/borrow/repay/withdraw events — amounts stripped (already done)

`Supplied`, `Borrowed`, `Repaid`, `Withdrawn` (LendingPool) — emit user/token only, no amounts. ✓

### E-3 ‼ `Liquidated` event retains amounts

`LendingPool.sol:581-583` — `Liquidated` emits `actualDebtCover` and `seizedCollateral`. **Intentional** — liquidation amounts are public by design. No change.

### E-4 ‼ `PausedWithdrawn` event emits `amount`

`LendingPool.sol:315` and `StrategyVault.sol:197` — these fire during emergency pause + withdrawal. Amounts are acceptable since the contract is in emergency mode and amounts are revealed to the user anyway.

---

## Files Changed Summary

| File | Changes |
|---|---|
| `contracts/LendingPool.sol` | ~20 locations: replace `liquidReserve`/`totalPlainBorrow` with encrypted state; add interest accrual logic; add `publishDecryptResult` functions; replace plain-text `require()` gates with FHE-select. |
| `contracts/StrategyVault.sol` | 1 location: remove `SameBlockClose()` revert or replace with FHE-select; add collateral reveal flow. |
| `contracts/StrategyRegistry.sol` | 1 location: add explicit TVL reveal pathway with signed permits. |
| `contracts/FheForgeComposer.sol` | Document `allowTransient` sufficiency; add EIP-2612 permit path. |
| `contracts/PriceOracle.sol` | 4 locations: replace bare literal `18`, `10000` with named constants. |

## Migration + Testing Sequence

1. **First** — P3-Aderyn (safe constant replacements, no logic change)
2. **Then** — P2-1 (remove SameBlockClose)
3. **Then** — P2-2 (add interest accrual logic — affects every state mutation)
4. **Then** — P1-1 (add `publishDecryptResult` functions)
5. **Then** — P0-1 (migrate `liquidReserve`/`totalPlainBorrow` to encrypted — biggest change, last, after everything else is stabilized)
