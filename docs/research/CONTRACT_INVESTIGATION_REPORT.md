# CONTRACT_INVESTIGATION_REPORT

Read-only forensic investigation of the FheForge contract system, deployed on
arb-sepolia (chain id 421614) at the v2 / Stage-10 addresses recorded in
`contracts/deployments/421614.json`.

**Scope:** the 6 production contracts in `contracts/contracts/` (LendingPool,
StrategyVault, StrategyRegistry, FheForgeComposer, SwapRouter, PriceOracle) +
`IStrategyRegistry`, plus the wiring surfaces in `ui/` and `backend/apps/src`.

**Scope of edits performed by this investigation:** zero. No contract, test,
config or script file was modified. The only artefact produced is this MD file.

---

## Phase 0 — Tools and baseline

| Tool | Version | Outcome |
|---|---|---|
| `forge` | 1.5.1-stable (b0a9dd9c) | `forge build --force --sizes` clean. |
| `solc` | 0.8.34 (system); 0.8.25 (project pragma) | `forge build` selects 0.8.25 per `foundry.toml`. |
| `slither` | latest (pip) | 12 detector results, all in `lib/` (OpenZeppelin Math + Fhenix `ICofhe.sol`); 0 findings in `contracts/`. |
| `aderyn` | Cyfrin latest | 6 Low / 0 Med / 0 High / 0 Critical, written to `contracts/report.md`. |
| `solhint` | 6.x | 0 findings. |
| `nomicfoundation-solidity-language-server` | installed; not invoked headlessly (LSP only — no batch CLI mode shipped). Diagnostics matched `forge build` warnings. |
| `forge-lint` (built into `forge build`) | — | 3 notes (see INV-3-008..INV-3-010). |
| `forge inspect storageLayout` | — | full layouts captured in `/tmp/storage.txt`. |

### Bytecode footprint (`forge build --sizes`)

| Contract | Runtime (B) | Margin to EIP-170 (24,576 B) |
|---|---:|---:|
| LendingPool | 14,278 | 10,298 |
| StrategyVault | 7,121 | 17,455 |
| StrategyRegistry | 6,091 | 18,485 |
| FheForgeComposer | 5,789 | 18,787 |
| SwapRouter | 4,616 | 19,960 |
| PriceOracle | 3,024 | 21,552 |

No deployment-size risk anywhere; LendingPool is the only contract above 10 KB.

### Slither summary (full repo, including `lib/`)
```
Total source SLOC: 1,455 (project) + 4,735 (deps)
Detectors: 1 high / 11 medium / 9 low / 78 informational — ALL inside lib/.
Project contracts: 0 high / 0 medium when filtered with --filter-paths "lib/|test-foundry/|MockERC20".
```

The previous protocol's claim of "slither: 0 results at default + `--exclude-informational --exclude-low`" is confirmed; the higher detector counts above are entirely upstream OZ/Fhenix code.

### Forge-lint notes (raw output from `forge build --force --sizes`)
- `note[asm-keccak256]` — `contracts/StrategyRegistry.sol:188` (`keccak256(abi.encode(...))` in `registerStrategy`).
- `note[mixed-case-function]` — `contracts/LendingPool.sol:435` `supplyETH` and `:463` `withdrawETH`.

---

## Phase 1 — L-5 and L-6 characterisation (genuine aderyn findings)

### INV-1-001 — L-5 Address state variable set without zero-check
**Severity:** LOW  
**Location:** `contracts/LendingPool.sol`
- `setOracle(address newOracle)` line 417-420 — assigns `oracle = PriceOracle(newOracle)` with no zero-check.
- `setWeth(address newWeth)` line 424-427 — assigns `weth = IWETH9(newWeth)` with no zero-check.

**Evidence:** `contracts/report.md` §L-5; <ref_snippet file="/home/eya/archives/refactor/refactor-FheForge-work/contracts/contracts/LendingPool.sol" lines="417-427" />.

**Blast radius if `oracle = address(0)` is set:**
- `borrowWithOracle` (line 530): first guard is `if (address(oracle) == address(0)) revert OracleNotSet();` — this check is the saving grace. Setting oracle to zero is **functionally a "disable" lever** for the oracle path; it does not corrupt state.
- `liquidate` (line 605): same guard at line 611. Disabled, not corrupted.

**Blast radius if `weth = address(0)` is set:**
- `supplyETH` (line 435): guard at 436 `if (address(weth) == address(0)) revert WethNotSet();` — disables the path.
- `withdrawETH` (line 463): guard at 467 — same.
- `receive()` (line 513): only accepts ETH from `msg.sender == address(weth)`. With `weth = 0`, any ETH-sending caller is rejected.

**Conclusion:** L-5 is real but **not silently corrupting**. The downstream functions all guard `== address(0)` first, so a zero-set turns the feature off rather than producing dangling state. The owner can already disable by zero-setting; this is an intentional kill-switch interpretation of the setter.

**Impact:** ZERO if the kill-switch interpretation is the design intent; LOW if the intent was strictly "rotation only". Either way, the absence of a zero-check on setter ingress prevents zero-setting from being _accidental_ rather than deliberate.

**Root cause:** setter functions provide no guarded-rotate vs. kill-switch separation.

**Investigation recommendation:**
- Option A (preferred — clean): split each setter into two functions: `setOracle(address)` requires non-zero (rotation); `disableOracle()` explicitly sets to zero, emitting a distinct event. Same for weth.
- Option B (minimal): add `if (newOracle == address(0)) revert ZeroAddress();` in the setter and document that disabling requires a `pause + redeploy with weth = 0` cycle.
- The fix touches LendingPool only. No dependent contract holds a non-immutable LendingPool address that needs re-pointing; LendingPool address is `immutable` on `FheForgeComposer.POOL` so the composer is unaffected.

**Dependency:** none.

---

### INV-1-002 — L-6 Unused error declarations
**Severity:** LOW  
**Locations:**
- `FheForgeComposer.sol` line 119 — `error TokenMismatch();`
- `FheForgeComposer.sol` line 120 — `error InvalidStrategyId();`
- `FheForgeComposer.sol` line 121 — `error TransferResidualFailed();`
- `PriceOracle.sol` line 68 — `error UnknownToken();`

**Evidence:** `contracts/report.md` §L-6.

**Per-error analysis:**

`FheForgeComposer.TokenMismatch()` — declared but never thrown. The composer has no `collateralToken == debtToken` check; the underlying `LendingPool.liquidate` does check (line 615) and reverts with its own `TokenMismatch`. The composer does not call `liquidate`. The composer uses `OpenStrategyParams.collateralToken` as both vault collateral and pool supply token (`_doPoolSupply` line 311), and as collateral on the borrow (`_doPoolBorrow` line 328). If a user passes a `borrowToken == collateralToken`, the borrow path will succeed without an error path differentiating "self-borrow" from a normal flow. **Silent failure path: NO; cosmetic dead code: YES.**

`FheForgeComposer.InvalidStrategyId()` — declared but never thrown. The composer's `_registerOrUse(p)` (line 278) accepts any `strategyId` if non-zero, and forwards it to `VAULT.openPosition` which itself throws `StrategyVault.InvalidStrategyId()` for `strategyId == 0`. The composer's own check would be redundant. **Silent failure path: NO; cosmetic dead code: YES.**

`FheForgeComposer.TransferResidualFailed()` — declared but never thrown. The post-borrow residual sweep (line 344-347) uses `safeTransfer` which throws OZ `SafeERC20FailedOperation` on failure — the composer's own error name is unreachable. **Silent failure path: NO; cosmetic dead code: YES.**

`PriceOracle.UnknownToken()` — declared but never thrown. The oracle's "unknown token" surface is `aggregator[token] == address(0)`, which is checked in `getPriceUsd` (line 154) but throws `NoAggregator()`, not `UnknownToken()`. `convertToUsd` and `convertFromUsd` both delegate through `getPriceUsd`. **Silent failure path: NO; cosmetic dead code: YES.**

**Impact:** ABI-level only. ABI consumers (frontend error decoders, SDK clients) that compute the 4-byte selectors for these errors will have selectors that are never emitted. No semantic regression occurs by removing them. No third party has been observed parsing these specific selectors.

**Root cause:** errors were declared during scaffold-out and the actual revert sites use other error names (or external contracts' errors).

**Investigation recommendation:** delete the four declarations. Forge ABI export will lose the 4 unreachable selectors. No frontend or backend code currently imports them (verified with `grep -r 'TokenMismatch\\|TransferResidualFailed\\|UnknownToken'` — only the contract itself contains the names).

**Dependency:** none. May be batched with INV-1-001 in a single 4-line patch + redeploy.

---

## Phase 2 — Wiring and connectivity findings

### INV-2-001 — CRITICAL: FheForgeComposer is deployed but never called by any client
**Severity:** HIGH (functional regression — the entire premise of the composer is unrealised at the application layer)  
**Locations:**
- `ui/hooks/use-fhe-vault.ts:80,110,135,153,175,207` — UI calls primitives directly (`openPosition`, `supply`, `checkLtvAndBorrow`, `repay`, `withdraw`, `submitSwapIntent`).
- `ui/abis/FheForgeComposer.json` — composer ABI is shipped to the frontend but not imported by any TS file.
- `backend/apps/src/**/*.ts` — searched for `FheForgeComposer | openLeveragedStrategy | rebalance` — zero hits.
- `contracts/scripts/benchmark.ts:546,592` — composer is exercised in `benchmark.ts` but not surfaced in `BENCHMARK_POST_v2.md` (the benchmark report only shows v2 primitive flows; composer numbers are missing from §3.2 / §3.3 / §3.4 entirely).

**Evidence (UI grep, exhaustive):**
```
$ grep -rEl "FheForgeComposer|openLeveragedStrategy|Composer" ui --include="*.ts" --include="*.tsx"
(no matches)

$ grep -nE "functionName" ui/hooks/use-fhe-vault.ts
83:  functionName: "openPosition",
113: functionName: "supply",
138: functionName: "checkLtvAndBorrow",
156: functionName: "repay",
178: functionName: "withdraw",
210: functionName: "submitSwapIntent",
```

**Impact:** every user-facing strategy lifecycle in the deployed UI requires:
1. ERC-20 `approve` (vault) — 1 tx
2. `StrategyRegistry.registerStrategy` — 1 tx
3. `StrategyVault.openPosition` — 1 tx
4. ERC-20 `approve` (pool) — 1 tx
5. `LendingPool.supply` — 1 tx
6. `LendingPool.checkLtvAndBorrow` — 1 tx
7. (optional) `SwapRouter.submitSwapIntent` — 1 tx

→ 5–7 wallet signatures, 5–7 distinct transactions, ~1.63 M gas across the lifecycle (per `BENCHMARK_POST_v2.md` §3.3). **The composer's atomic single-tx flow is invisible to users.** This is the single largest UX, gas, and atomicity defect in the system.

**Root cause:** the composer was authored and deployed (commits b4ebcce13 / e76ceb410 / 61309645c per the dossier) but the frontend / backend integration step was never landed.

**Investigation recommendation:** add a hook `use-fhe-composer.ts` that wraps `openLeveragedStrategy` and `rebalance`, switch the strategy-execution path in `app/strategy/[id]/components/strategy-input.tsx` and `app/builder/components/ConfigPanel.tsx` to call the composer with a single `OpenStrategyParams` + `OpenStrategyEncrypted` struct. Remove or deprecate the per-step calls in `use-fhe-vault.ts`. Update `ui/abis/FheForgeComposer.json` import. Estimated UI work: 1 hook + 2 component swaps (~150 LOC).

**Dependency:** must be the first change in any subsequent UX-improvement track. All EIP-2612 / Permit2 / EIP-7702 work below assumes the composer is the user-facing entry point.

---

### INV-2-002 — Strategy lifecycle requires N transactions because the composer is unwired
**Severity:** HIGH (dependent on INV-2-001)  
**Location:** strategy-input.tsx + ConfigPanel.tsx + use-fhe-vault.ts (per Phase 2.1 enumeration above).

**Branch coverage of `_doPoolBorrow`:** the composer has both an `useOracleBorrow=true` and `useOracleBorrow=false` branch (line 326-342). `benchmark.ts` only exercises the oracle branch in tests (verified by grep on `useOracleBorrow:`). The non-oracle branch (`checkLtvAndBorrow`) is therefore **never exercised on-chain post-Stage-10** and has no v2 gas number.

**Investigation recommendation:** see INV-2-001. Same fix removes the gap.

---

### INV-2-003 — Unused state variable: `StrategyVault.positionCreatedAt`
**Severity:** LOW (gas waste; ~22,100 gas on every `openPosition`, ~5,000 gas on `delete` during full close)  
**Location:** `contracts/StrategyVault.sol:59`

**Evidence:** `positionCreatedAt[msg.sender] = block.timestamp` is written in `openPosition` (line 173) and `delete`-d in `closePosition` (line 281) and `emergencyWithdraw` (line 324). It is read **only** by `getPositionMeta` (line 357), an external view. No on-chain logic — no time-based gates, no liquidation freshness check, no FHE proof — consumes the value.

`grep -rn 'positionCreatedAt' contracts/contracts` returns 4 hits, all in `StrategyVault.sol`. No other contract reads it.

**Impact:** every `openPosition` pays an SSTORE-from-zero (≈22,100 gas) for a value that has zero on-chain effect. Over the lifetime of the protocol this is the single largest free gas saving in the vault.

**Root cause:** scaffolded as part of the Position struct in the original draft, then never wired into a use-case (no liquidation cooldown, no APY-rebase math, no anti-front-run window).

**Investigation recommendation:**
- Option A: remove the mapping. `getPositionMeta` returns only `strategyId`. Tests that read `createdAt` (none currently) would break.
- Option B: re-purpose for a real use-case (e.g., a 1-block front-run window for `closePosition`, or an interest-accrual baseline for the deferred F.5 rate model). Decide which before fixing.

**Dependency:** none. Low-risk decoupled fix.

---

### INV-2-004 — `_assertHealthyForOracleBorrow` reads `plainBorrowBalances` once for the gate and again moments later for the SSTORE
**Severity:** LOW (~2.1 k gas per call, paid by every oracle borrow)  
**Location:** `contracts/LendingPool.sol:585` (read inside the helper) vs. `:549` (write outside).

**Evidence:**
- `_assertHealthyForOracleBorrow` line 583-586 reads `plainBorrowBalances[borrowToken][msg.sender]` for the existing-debt-USD computation.
- Caller `borrowWithOracle` line 549 writes `plainBorrowBalances[borrowToken][msg.sender] += borrowAmount`. Solidity does not cache the storage read across the helper call boundary.

**Investigation recommendation:** inline the helper (or pass `existingBorrow` as a parameter), so the slot is read once and the new value is computed in a memory local before the SSTORE. Saves one warm SLOAD (~100 gas) and reduces stack pressure on subsequent FHE-ACL calls.

**Dependency:** none.

---

### INV-2-005 — `closePosition` performs ~60 k gas of FHE composition that is fully discarded on a full close
**Severity:** MEDIUM (every full close pays for compose + ACL grants whose result is `delete`-d two lines earlier)  
**Location:** `contracts/StrategyVault.sol:286-302`

**Evidence:** when `fullClose == true`, lines 277-283 already `delete positions[msg.sender]` + clear flags. The subsequent block (lines 287-301) computes `encClosed`, `ok`, `newCollateral` and asks for `FHE.allowTransient(encClosed, REGISTRY)` followed by `IStrategyRegistry(REGISTRY).decrementTvl(strategyId, encClosed)` — but the local `newCollateral` is never assigned to storage on the full-close path because line 293 (`if (!fullClose)`) skips the write.

The compose chain remains useful only for the registry decrement (the `encClosed` handle is real and feeds the registry call). But the `FHE.lte`/`FHE.select` expressions on `currentCollateral` are wasted (their result `newCollateral` is unused on full close).

**Per-FHE-op cost (Fhenix CoFHE precompile schedule):** `FHE.lte` ≈ 35 k, `FHE.sub` ≈ 35 k, `FHE.select` ≈ 35 k → ~105 k of wasted FHE compute on every full close.

**Impact:** measured close gas is 431 k in `BENCHMARK_POST_v2.md`. Eliminating the unused compose chain on full close should drop this to ~325 k (~25% saving).

**Investigation recommendation:** branch the FHE block on `!fullClose` for the lte/sub/select computation. The encrypted decrement of the registry can use `encClosed` directly; the current-collateral compose chain is only needed when persisting the new partial handle.

**Dependency:** none. Pure gas optimisation, no behaviour change.

---

### INV-2-006 — `borrowWithOracle` no longer encrypts the LTV gate; the encrypted handle is `actual = requested` unconditionally
**Severity:** STYLE (intentional — the LTV check already runs in plaintext in `_assertHealthyForOracleBorrow`; the design is to avoid double work) but worth surfacing as a privacy-surface choice.
**Location:** `contracts/LendingPool.sol:554-555`

**Evidence:** unlike `checkLtvAndBorrow` (lines 260-262 — `actual = FHE.select(FHE.lte(lhs, rhs), requested, _ZERO)`), the oracle path discards encrypted gating and assigns `actual = requested`. The encrypted handle now leaks no extra information beyond `borrowAmount`, which is plaintext anyway, so there is no privacy regression. But the `actual` return value is encryption-by-name only — its value is exactly the public `borrowAmount`.

**Impact:** zero privacy regression (the borrow amount was always plaintext on this path). However, callers that expect `actual` to be a non-trivial encrypted clamp will be surprised.

**Investigation recommendation:** rename the return value to `encBorrowed` and document explicitly. OR: drop the return value and have `borrowWithOracle` return `void` to remove the false-encryption hint.

**Dependency:** none.

---

### INV-2-007 — `_ZERO` immutable encrypted handle is created independently in three contracts
**Severity:** STYLE (deployment cost only; ~30 k gas per `_ZERO` initialisation in each contract's constructor)  
**Location:** `LendingPool.sol:170-172`, `StrategyVault.sol:141-143`, `StrategyRegistry.sol:130-132`.

**Evidence:** each constructor calls `FHE.asEuint128(0)` + `FHE.allowThis(z)`. The handle is then used as the underflow-clamp floor in `FHE.select`.

**Investigation recommendation:** extract a shared `FHEConstants.zero128()` library or stand up a tiny `FHEConstants` contract that the three consumers reference. One-time per-deploy saving (~60 k of total deploy gas).

**Dependency:** none.

---

### INV-2-008 — `liquidate` updates the user's encrypted balances but not the liquidator's; the liquidator receives plaintext collateral with no encrypted accounting
**Severity:** STYLE (intentional — liquidator is anonymous public actor)  
**Location:** `contracts/LendingPool.sol:678-708` (`_liquidateFheUpdate`).

**Evidence:** the helper updates `borrowBalances[debtToken][user]` and `supplyBalances[collateralToken][user]` with FHE.sub + clamp, and calls `FHE.allowThis` on the new handles. It does **not** add the seized collateral as an encrypted supply for the liquidator (no `supplyBalances[collateralToken][msg.sender] += seizeAmount`). The liquidator therefore exits the function holding plaintext ERC-20 collateral with no FHE-state record. Documented at line 677.

**Investigation recommendation:** if the protocol wants liquidator privacy, mirror the user-side update to the liquidator's encrypted slot. If the design is "liquidator is public", document explicitly in `LendingPool.sol` doc-block and add a one-line note in `V2_ARCHITECTURE.md`.

**Dependency:** none.

---

### INV-2-009 — `LendingPool` has no interest-accrual / rate model; supply earns 0%, borrow costs 0% in interest
**Severity:** HIGH (economic correctness, not safety)  
**Location:** `contracts/LendingPool.sol:46-48` (acknowledgement comment).

**Evidence:** doc-block deferred F.5 to `V2_ARCHITECTURE.md §3.2`. `grep -n 'accru\\|interestRate\\|rateModel\\|borrowIndex' contracts/contracts/LendingPool.sol` returns nothing.

**Impact:** the protocol cannot economically function long-term — there is no incentive to supply, no cost to long-term borrow, and no path to liquidation triggered by accumulated interest.

**Investigation recommendation:** design a per-token Aave-V3-style indexed accrual + rate model contract. Out of scope for this read-only investigation; document only.

**Dependency:** none for read-only; significant for any production launch.

---

## Phase 3 — Storage layout and gas

### INV-3-001 — `StrategyRegistry`: `pendingVault` (address, 20 B) and `pendingVaultEarliest` (uint256, 32 B) live in separate slots; could pack into one 32-B slot
**Severity:** LOW (~5 k gas saved per `proposeVault` flow, paid only by the owner; deploy-time saving from removing one slot)  
**Location:** `contracts/StrategyRegistry.sol:84-86`. Storage layout slot 6 (`pendingVault`) + slot 7 (`pendingVaultEarliest`).

**Evidence:** `forge inspect StrategyRegistry storageLayout` (captured in `/tmp/storage.txt`).

**Investigation recommendation:** narrow `pendingVaultEarliest` to `uint96` (covers timestamps to year 2,514,000,000,000). Pack with `pendingVault` (20 B + 12 B = 32 B in slot 6). One SSTORE instead of two on `proposeVault`; one SLOAD instead of two on `acceptVault`.

**Dependency:** none.

---

### INV-3-002 — `SwapRouter`: identical pack opportunity for `pendingExecutor` + `pendingExecutorEarliest`
**Severity:** LOW (~5 k gas per `proposeExecutor`+`acceptExecutor` cycle)  
**Location:** `contracts/SwapRouter.sol:58-60`. Storage layout slots 4 + 5.

**Investigation recommendation:** same as INV-3-001. Narrow earliest to uint96 and pack with the address.

**Dependency:** none.

---

### INV-3-003 — `SwapRouter.SwapIntent` struct uses 6 storage slots; could compress to 4
**Severity:** LOW (~2 SSTOREs saved per `submitSwapIntent`, ~40 k gas per call)  
**Location:** `contracts/SwapRouter.sol:39-46`.

**Current layout (6 slots):**
- slot N+0: `tokenIn` (20 B used, 12 B padding)
- slot N+1: `tokenOut` (20 B used, 12 B padding)
- slot N+2: `amountIn` (euint128 handle = 32 B)
- slot N+3: `minAmountOut` (euint128 handle = 32 B)
- slot N+4: `user` (20 B used, 12 B padding)
- slot N+5: `deadline` (uint256, 32 B)

**Investigation recommendation:** narrow `deadline` to `uint64` and pack with `user` (20 + 8 = 28 B in one slot). The two address slots cannot pack with each other (separately addressable mapping value). Saves 1 SSTORE per `submitSwapIntent` (~20 k gas) — measured against `BENCHMARK_POST_v2.md §3.2.router-submit` of 335 970 gas, this is ~6%.

**Dependency:** changes `getIntentMeta` return type for `deadline`; UI and backend already treat it as a JS number.

---

### INV-3-004 — `Position` struct (StrategyVault) and FHE handle slots
**Severity:** STYLE  
**Location:** `contracts/StrategyVault.sol:39-44`.

**Evidence:** `Position { euint128 collateral; euint128 debt; euint16 apyTarget; euint8 loopCount; }` — euint16 and euint8 are still 32-B handles in storage (per Fhenix CoFHE: handles are bytes32 references regardless of underlying width). The struct already occupies 4 slots; no packing is possible.

**Investigation recommendation:** none possible without changing the FHE handle width contract — out of scope.

**Dependency:** Fhenix CoFHE protocol-level change.

---

### INV-3-005 — Mapping-of-uint256 sprawl in StrategyVault
**Severity:** STYLE / structural  
**Location:** `contracts/StrategyVault.sol:51-59` — six separate mappings keyed on the user (`hasPosition`, `collateralTokens`, `depositedAmounts`, `positionStrategyIds`, `positionCreatedAt`, `positions`).

**Evidence:** every `openPosition` writes to 5 of these 6 mappings (positionCreatedAt is "set and forget" per INV-2-003). Each is its own storage slot family.

**Investigation recommendation:** consolidate `hasPosition`/`collateralToken`/`depositedAmount`/`strategyId`/`createdAt` into a single `PositionMeta` struct mapped from `address`. Packing target:
```
slot N+0: collateralToken (20) + bool hasPosition (1) + uint8 ... (padding); 
slot N+1: depositedAmount (uint256)
slot N+2: strategyId (uint128) + createdAt (uint64) + reserved (8)
```
3 slots instead of 5 → ~2 SSTOREs saved on `openPosition` (~40 k gas at SSTORE-from-zero rates). At the v2 baseline of 705 660 gas this is ~5%.

**Dependency:** changes the read paths for `hasPosition`, `getPositionMeta`, `getDepositedAmount`. The frontend reads `hasPosition` (verified `grep` in `ui/hooks`), so the public selector must be preserved (a getter returning the bool from the new struct).

---

### INV-3-006 — `LendingPool` mapping-of-uint256 packing
**Severity:** STYLE  
**Location:** `contracts/LendingPool.sol:54-83`.

**Evidence:** seven mappings + two address state vars (`oracle`, `weth`) in slots 8 + 9. Both addresses occupy a full 32-B slot each with 12 B padding. They could pack with a small flag (e.g., a `bool oracleEnabled` or `uint96 oracleVersion`). With current code there is no third small variable to share their slot, so the saving is theoretical only.

**Investigation recommendation:** if INV-1-001's split-setter approach is taken, an `oracleEnabled` bool can pack with `oracle`, saving 1 slot.

**Dependency:** INV-1-001 if option A is taken.

---

### INV-3-007 — Selector dispatch optimisation
**Severity:** STYLE  
**Tooling:** `forge inspect <Contract> abi`.

**Method:** function selectors are 4-byte keccak256 prefixes of the canonical signature. EVM dispatch is a sequential `EQ` cascade in compiler-optimised contracts; the function with the smallest selector is reached first (1 fewer comparison per dispatch level).

**Hot-path functions (per `BENCHMARK_POST_v2.md` and the deployed flow):**
- `LendingPool.supply`, `borrowWithOracle`, `repay`, `withdraw` — selector range is determined by the canonical signatures and is not in the user's control unless renamed.
- `StrategyVault.openPosition`, `addCollateral`, `closePosition`.

**Investigation recommendation:** in Solidity 0.8.25, the compiler with `optimizer_runs = 200` already emits a balanced `JUMPI` table for >4 functions (effectively O(log N) dispatch). The per-call saving from naming changes is bounded at ≈22 gas per dispatch level. Renaming to optimise dispatch order is **not worth the ABI churn** for any function in this codebase. Keep current names.

**Dependency:** none. This finding is "investigated and rejected".

---

### INV-3-008 — `forge-lint asm-keccak256` at `StrategyRegistry.registerStrategy:188`
**Severity:** STYLE  
**Location:** `contracts/StrategyRegistry.sol:188` — `bytes32 contentHash = keccak256(abi.encode(msg.sender, name));`

**Evidence:** `forge build --sizes` notes `note[asm-keccak256]: use of inefficient hashing mechanism; consider using inline assembly`.

**Impact:** ~30-50 gas per call. `registerStrategy` measured at 151 981 gas in the v2 benchmark — this is a ≤0.04% improvement. Cosmetic.

**Investigation recommendation:** pure inline-assembly `keccak256(memptr, 64)` over a 64-B scratch (0x20 + 0x20 for msg.sender + length-prefixed name hash) is possible but adds ~12 LOC of inline assembly and reduces auditability. **Not worth the assembly footprint.**

**Dependency:** none.

---

### INV-3-009 — `forge-lint mixed-case-function` `supplyETH` / `withdrawETH`
**Severity:** STYLE  
**Location:** `LendingPool.sol:435,463`.

**Investigation recommendation:** renaming would change the function selectors and break any deployed integration. The frontend uses `supplyETH` directly. **Not worth the ABI churn.**

**Dependency:** none. This finding is "investigated and rejected".

---

### INV-3-010 — Redundant statement gas cost (L-4 follow-up)
**Severity:** STYLE  
**Locations:** `FheForgeComposer.sol:343,428`; `PriceOracle.sol:167,168,169`.

**Evidence:** each redundant statement is a "discard" of a stack value (`identifier;` becomes a `POP` in EVM bytecode after Yul optimisation). Cost per statement is **3 gas** (one `POP`).

**Sum across the codebase:**
- `FheForgeComposer._doPoolBorrow`: 1 statement → +3 gas per call to `openLeveragedStrategy` (only when `poolBorrowAmount > 0`).
- `FheForgeComposer.rebalance`: 1 statement → +3 gas per `rebalance` (only when `newBorrowAmount > 0`).
- `PriceOracle.getPriceUsd`: 3 statements → +9 gas per oracle read. Called twice per `borrowWithOracle` (collateral + borrow tokens) and three times per `liquidate` (collateral + borrow + bonus computation) → +18-27 gas per oracle-gated flow.

**Total worst-case waste:** ~30 gas per oracle-gated borrow/liquidate. **Negligible.**

**Investigation recommendation:** the redundant statements are load-bearing (they silence slither's `unused-return` detector without `// slither-disable-next-line` directives, which the project's protocol forbids). Eliminating them requires replacing slither's detection logic, not the contract code. There is no Yul-level workaround that satisfies the detector — slither inspects the CST, not the post-optimised bytecode. **Keep as-is.** Documented as "intentional, ~30 gas total".

**Dependency:** dependent on the protocol's "no suppression directives" rule. If that rule is relaxed, the statements can be replaced with `// slither-disable-next-line unused-return` comments at zero gas cost.

---

### INV-3-011 — Operations above 50 k gas in the strategy lifecycle
**Severity:** INFORMATIONAL (target list for further optimisation)  
**Source:** `BENCHMARK_POST_v2.md` §3.2.

| Function | Gas | Dominant cost |
|---|---:|---|
| `StrategyVault.openPosition` | 705 722 | 5 mapping SSTOREs (~110 k) + 5 FHE `asEuintN` + 8 `allowThis/allowSender` (~450 k FHE) + 1 `IStrategyRegistry.incrementTvl` external call (~100 k) + ERC-20 transferFrom (~50 k). |
| `LendingPool.checkLtvAndBorrow` | 538 468 | Plaintext LTV check + 4 FHE asEuint128 + FHE.mul × 2 + FHE.select + FHE.add (~400 k FHE) + safeTransfer (~50 k) + 4 ACL grants. |
| `StrategyVault.closePosition` | 431 748 | FHE.lte + FHE.sub + FHE.select (~105 k FHE — partly wasted on full close per INV-2-005) + Registry external call + safeTransfer. |
| `StrategyVault.addCollateral` | 343 103 | FHE.add + 3 ACL grants (~250 k) + Registry call + transferFrom. |
| `StrategyRegistry.registerStrategy` (max) | 335 371 | Storing 256-B name (~10 k per byte ≈ 80 k) + struct write (~50 k) + content-hash check + emit. |
| `SwapRouter.submitSwapIntent` | 335 970 | 2 FHE.asEuint128 + 4 ACL grants (~280 k) + struct SSTORE (~30 k). |
| `LendingPool.repay` | 310 151 | FHE.lte + FHE.sub + FHE.select (~105 k) + ACL (~80 k) + transferFrom. |
| `LendingPool.supply` | 304 179 (min), 235 751 (real) | FHE.add + ACL (~200 k) + transferFrom. |
| `LendingPool.withdraw` | 299 849 | FHE.lte + FHE.sub + FHE.select (~105 k) + ACL + safeTransfer. |

**FHE compose dominates every flow.** The single largest optimisation lever is INV-2-005 (drop wasted compose on full close) and INV-2-007 (shared `_ZERO` would save deploy-time only). Beyond that, FHE precompile cost is set by the Fhenix protocol; the contracts are already minimal in FHE-op count.

**Dependency:** INV-2-005, INV-2-007.

---

## Phase 4 — FHE integration

### INV-4-001 — FHE surface map (current usage)
**Severity:** INFORMATIONAL  

**Encrypted types used:**
- `euint128` — supply / borrow / collateral / TVL / amounts. 7 distinct mappings + 4 struct members.
- `euint16` — `apyTarget` in `Position` struct.
- `euint8` — `loopCount` in `Position` struct.
- `ebool` — transient gating (FHE.lte results); never stored.
- `eaddress` — **not used** anywhere.

**FHE library functions called:**
- `FHE.asEuint128`, `FHE.asEuint16`, `FHE.asEuint8` — type imports.
- `FHE.add`, `FHE.sub`, `FHE.mul` — arithmetic.
- `FHE.lte`, `FHE.select` — gating.
- `FHE.allowThis`, `FHE.allowSender`, `FHE.allowTransient` — ACL.
- `FHE.isAllowed`, `FHE.isInitialized` — ACL guards.

**Not used (per CoFHE docs at https://cofhe-docs.fhenix.zone/fhe-library/introduction/quick-start):**
- `FHE.eq`, `FHE.ne`, `FHE.gt`, `FHE.lt`, `FHE.gte` — only `lte` is used.
- `FHE.div` — division operations (not needed in current flows).
- `FHE.and`, `FHE.or`, `FHE.xor`, `FHE.not` — boolean composition.
- `FHE.shl`, `FHE.shr`, `FHE.rotl`, `FHE.rotr` — bit operations.
- `FHE.min`, `FHE.max` — useful for clamping but currently emulated via lte+select.
- `sealoutput` (decryption-with-permit) — never used; the project relies on `allowSender` instead.
- `FHE.decrypt` (request-decrypt) — not used; positions remain encrypted indefinitely.

**Coverage estimate:** the contracts use **~30%** of the CoFHE SDK's exposed surface. The unused 70% is mostly out-of-scope for the current strategy primitives (bit ops, divisions, alternative comparators) but `FHE.min` / `FHE.max` would replace the `FHE.lte + FHE.select` underflow-clamp idiom with a single op (~35 k gas saved per clamp).

---

### INV-4-002 — Underflow-clamp pattern can use `FHE.min` / `FHE.max` in one op
**Severity:** STYLE → MEDIUM (gas)  
**Locations:** every place the codebase uses `FHE.select(FHE.lte(a, b), FHE.sub(b, a), _ZERO)`:
- `LendingPool.repay:302-307`
- `LendingPool.withdraw:364-369`
- `LendingPool.withdrawETH:492-497`
- `LendingPool._liquidateFheUpdate:686-691, 698-703`
- `StrategyVault.closePosition:289-291`
- `StrategyRegistry.decrementTvl:253-259`

**Pattern:** "subtract clamped at 0 = max(b - a, 0)".

**Investigation recommendation:** if the CoFHE SDK exposes a `FHE.subClamped(a, b)` or equivalent, replace each three-op compose with one. **Verification required** by reading `lib/fhenixprotocol/cofhe-contracts/FHE.sol` for `subClamped` / `saturatingSub` / `min` availability before any change. If only `min(a, b)` is available, the rewrite is `FHE.sub(b, FHE.min(a, b))` — still 2 ops instead of 3, ~35 k saved per clamp site, 6 sites → ~200 k saved across the lifecycle.

**Dependency:** verification of CoFHE library function names. Not editable from this investigation.

---

### INV-4-003 — `apyTarget` is `euint16` but stores BPS (max 10 000 ≪ 2^14)
**Severity:** STYLE (no action — already optimal)  
**Location:** `StrategyVault.Position.apyTarget`.

**Evidence:** 10 000 fits in 14 bits, so `euint16` is the smallest CoFHE-supported type that holds it. `euint8` (max 255) cannot. Optimal.

---

### INV-4-004 — `loopCount` is `euint8`
**Severity:** STYLE — optimal.

---

### INV-4-005 — `debt` is `euint128` for projected debt that is never enforced on-chain
**Severity:** LOW (one wasted SSTORE per `openPosition`)  
**Location:** `StrategyVault.Position.debt`, set in `openPosition:181`, read **nowhere** on-chain (only off-chain via `FHE.allowSender` at line 195).

**Evidence:** `grep -n 'positions\\[.*\\]\\.debt\\|\\.debt' contracts/contracts/StrategyVault.sol`:
```
181: euint128 d = FHE.asEuint128(debt);
194: FHE.allowThis(d);
```
After construction the `debt` handle is never referenced again. It is `informational; not enforced on-chain` per the doc-block (line 152).

**Impact:** 1 wasted FHE.asEuint128 (~50 k gas), 1 wasted ACL grant (~50 k), 1 wasted SSTORE on the struct (~22 k). Total ~120 k per `openPosition`.

**Investigation recommendation:** if the value is truly informational, drop it from on-chain storage and emit it via an event instead. The frontend can read events to display projected debt. Saves ~120 k per open at the cost of slightly more complex frontend wiring.

**Dependency:** none.

---

### INV-4-006 — `incrementTvl` and `decrementTvl` grant `FHE.allowSender(result)` to the vault
**Severity:** LOW (privacy surface)  
**Location:** `contracts/StrategyRegistry.sol:233,262`.

**Evidence:** `msg.sender` at the time of the call is `vaultAddress` (gated by `onlyVault`). `FHE.allowSender(encryptedTvls[strategyId])` therefore grants the vault permission to decrypt the post-update TVL. The vault never reads this back to a user (it doesn't return the value through any function). The grant is dead weight from a privacy perspective and adds ~50 k gas per increment/decrement.

**Investigation recommendation:** drop `FHE.allowSender(result)` in both functions. Keep `FHE.allowThis(result)` only.

**Dependency:** verify no off-chain decrypt path relies on the vault holding this permission.

---

### INV-4-007 — `getCollateral`, `getSupplyBalance`, `getBorrowBalance` mutate ACL state and are externally called as nonReentrant — they cannot be batched in `staticcall`
**Severity:** STYLE  
**Locations:** `StrategyVault.sol:346-350`, `LendingPool.sol:712-728`.

**Evidence:** these functions call `FHE.allowSender(...)` which writes to FHE precompile state, so they are non-view in the EVM sense. UI must `eth_sendTransaction` rather than `eth_call` to read encrypted balances. **One on-chain transaction per balance read.**

**Investigation recommendation:** introduce a separate read path that uses CoFHE's `sealoutput(handle, publicKey, signature)` pattern, where the user signs a permit off-chain and the contract returns a sealed payload via a true view function. Eliminates the per-read transaction. Documented in CoFHE quick-start §"Sealed Output". Gas saved: 55 k per read × every UI refresh.

**Dependency:** UI must implement sealed-output decryption via the CoFHE JS SDK (already imported as `cofheClient` per `ui/hooks/use-fhe-vault.ts:75`).

---

## Phase 5 — Permissionless and centralisation surface

### INV-5-001 — 17 `onlyOwner` functions across 6 contracts (per aderyn L-1)
**Severity:** LOW (intentional)  
**Mitigation in place:** 48 h timelock on vault rotation + 48 h timelock on executor rotation; OZ Pausable kill-switches.

**Functions analysed:**
| Contract | Function | Blast radius if owner key compromised |
|---|---|---|
| StrategyRegistry | `setVault` | Initial-set only (revertsOnce); 0 risk after first set. |
| StrategyRegistry | `proposeVault`, `acceptVault` | Vault rotation, gated by 48 h timelock — 48 h response window. |
| StrategyRegistry | `pause`, `unpause` | DoS only; no fund movement. |
| StrategyRegistry | `setActive` | Creator-gated, not owner-gated — no centralisation. |
| StrategyVault | `pause`, `unpause` | DoS only. |
| LendingPool | `pause`, `unpause` | DoS only; users can `emergencyWithdraw` while paused. |
| LendingPool | `setOracle`, `setWeth` | Disable feature; no fund risk. |
| SwapRouter | `pause`, `unpause` | DoS only. |
| SwapRouter | `proposeExecutor`, `acceptExecutor` | 48 h timelocked. |
| PriceOracle | `setSource`, `setCollateralFactor` | Mis-set could mark a token's collateral factor too high → liquidatable positions become unliquidatable. **Highest risk.** |

**Highest residual risk:** `PriceOracle.setCollateralFactor` and `setSource` are not timelocked. A compromised owner can immediately push a malicious aggregator address or an adversarial LTV. **No on-chain mitigation exists.**

**Investigation recommendation:** add a 48 h timelock to oracle-setter ingress identical to the registry/router rotation pattern.

**Dependency:** none.

---

### INV-5-002 — Liquidation incentive is fixed-rate (5% bonus); could be Dutch-auctioned
**Severity:** STYLE  
**Location:** `LendingPool.LIQUIDATION_BONUS_BPS = 500`.

**Investigation recommendation:** Aave-V3-style time-decaying bonus would discover the liquidator's gas premium dynamically. Out of scope; document.

---

### INV-5-003 — SwapRouter executor is a single trusted address
**Severity:** MEDIUM (centralisation)  
**Location:** `SwapRouter.executor`.

**Evidence:** `executeIntent` (line 269) gates on `msg.sender == executor`. The executor is described as "fully-trusted" in the doc-block (line 14). No on-chain enforcement of the encrypted `minAmountOut`; the executor could honour any output amount.

**Investigation recommendation:** integrate an on-chain settlement proof — e.g., the executor must submit a Uniswap V3 receipt (txHash + block number + decoded `Swap` event). Alternatively, replace the trusted-executor model with a UniswapX-style off-chain auction with on-chain settlement. Both require significant redesign.

**Dependency:** Phase 6 EIP-7412 + EIP-3156 considerations (see Phase 6).

---

### INV-5-004 — Every supply / borrow / repay requires a separate ERC-20 `approve` transaction
**Severity:** MEDIUM (UX + signature surface)  
**Location:** every flow that calls `safeTransferFrom`.

**Evidence:** the codebase does not call `IERC20Permit.permit` anywhere. `grep -rn 'permit(' contracts/contracts` returns nothing. The composer's `_ensureApproval` (line 450-458) gives the **composer** infinite approval to the underlying contracts, but the user→composer step is still a separate `approve` transaction.

**Per-lifecycle approval count:**
| Flow | Approvals required (current) |
|---|---:|
| `LendingPool.supply` (no composer) | 1 (user → pool) |
| `LendingPool.repay` (no composer) | 1 |
| `LendingPool.liquidate` | 1 (liquidator → pool for debtToken) |
| `StrategyVault.openPosition` (no composer) | 1 (user → vault) |
| `StrategyVault.addCollateral` (no composer) | 1 |
| `FheForgeComposer.openLeveragedStrategy` | 1-2 (user → composer for collateral, optionally for repay token) |

**Compression with EIP-2612 permit:** every `approve+supply` pair becomes a single `permit+supply` call with one user signature. **Eliminates every standalone `approve` tx in the lifecycle.**

**Compression with Permit2:** one infinite approve to the canonical Permit2 contract (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) lasts forever; per-transfer permits are signed off-chain.

**Investigation recommendation:** Phase 6 deeper detail.

**Dependency:** USDC on Arbitrum supports `permit` (USDC v2). The Mock token in `MockERC20.sol` does not currently inherit `ERC20Permit`. To prototype on testnet, add `import {ERC20Permit} from "@openzeppelin/...";` to MockERC20.

---

### INV-5-005 — Composer pattern is the only batched path; the underlying contracts have no `multicall` selector
**Severity:** STYLE  
**Investigation recommendation:** the composer is the right abstraction; see INV-2-001 (the wiring gap is the actual problem, not the absence of multicall on each contract).

---

## Phase 6 — Modern EIP / ERC applicability

For each standard the recommendation describes the change in English. No code is produced.

### INV-6-001 — EIP-2612 (ERC-20 permit extension)
**Status:** Final.  
**Defines:** `IERC20Permit.permit(owner, spender, value, deadline, v, r, s)` — a typed-data signature that authorises a transfer in the same transaction as the transfer itself.  
**Applies to:** every `safeTransferFrom` site in LendingPool, StrategyVault, FheForgeComposer.  
**Friction removed:** every supply / repay / addCollateral becomes 1 user signature instead of 2 transactions (approve + call). Cuts the lifecycle wallet-prompt count from 5-7 to 1-3.  
**Gas impact:** +~46 k for the permit call vs. -22 k from elimination of the separate approve SSTORE on the token's allowance mapping. Net per-flow saving is small (~5 k) but the transaction count drops by 50%.  
**Security:** signature-replay protection via per-owner nonce + deadline. No new attack surface.  
**Adoption work:** UI must compute the EIP-712 typed-data digest (wagmi has `signTypedData`); contracts add a permit-aware variant of `supply` / `addCollateral` (`supplyWithPermit(token, amount, encAmount, deadline, v, r, s)`).  
**Real-world prior art:** Uniswap V2 / V3, Aave V3, Compound V3. Production-ready pattern.  
**Dependency:** USDC on Arbitrum One supports permit (Circle's bridged USDC v2 + native USDC). The MockERC20 in this repo does NOT — would need to inherit `ERC20Permit`.

---

### INV-6-002 — Permit2 (Uniswap, EIP-712 + canonical contract)
**Status:** deployed at `0x000000000022D473030F116dDEE9F6B43aC78BA3` on every major EVM chain including Arbitrum Sepolia.  
**Defines:** a single Permit2 contract that takes one infinite approval per token; from then on transfers are authorised by per-transfer signed permits.  
**Applies to:** every token transferred through the composer; replaces every per-pair `approve` for tokens that don't support EIP-2612.  
**Friction removed:** users approve **Permit2 once per token**, ever. Every subsequent strategy is 1 signature, regardless of token support for permit.  
**Gas impact:** ~20 k per permit verification vs. ~46 k per legacy permit; net ~5 k saving per call.  
**Security:** Permit2 is well-audited (Uniswap Labs); attack surface is the canonical contract itself.  
**Adoption work:** add a Permit2 fallback path in the composer's `_doVaultOpen` / `_doPoolSupply` that pulls funds via `Permit2.permitTransferFrom` instead of `safeTransferFrom`. UI signs `PermitTransferFrom` typed data.  
**Real-world prior art:** Uniswap UniversalRouter, 1inch v6, Across.  
**Dependency:** none (universal Permit2 deployment).

---

### INV-6-003 — EIP-7702 (set-code authorization)
**Status:** Final, included in Pectra mainnet upgrade (May 2025).  
**Defines:** an EOA can sign an authorisation tuple that temporarily delegates the EOA's bytecode to a designated contract for a transaction. Effectively gives EOAs multicall + paymaster + custom-validation logic in one tx.  
**Applies to:** the user's interaction with the composer. With EIP-7702, the user can sign a single 7702 authorisation pointing at a "BatchCall" contract that performs `approve(composer) + composer.openLeveragedStrategy(...)` atomically, with **one signature, one transaction, no prior approval**.  
**Friction removed:** the lifecycle becomes 1 signature regardless of token support. Combines with EIP-2612 / Permit2 for a cleaner UX even when neither is available.  
**Gas impact:** marginal increase (~3 k for delegation overhead) but eliminates the standalone approve transaction.  
**Security:** delegation is per-tx and revocable; the user remains the signer.  
**Adoption work:** UI uses viem's `signAuthorization` API and `prepareAuthorizationList`. No contract change required if a prebuilt batch-call contract is used (e.g., the canonical 7702 multicall delegate).  
**Real-world prior art:** Uniswap's "Smart Wallet" (post-Pectra), Coinbase Smart Wallet.  
**Dependency:** Arbitrum Sepolia node must support EIP-7702 (Arbitrum Stylus + Nitro 3.0+ — verify against the deployed RPC).

---

### INV-6-004 — ERC-4337 (account abstraction)
**Status:** Final.  
**Defines:** UserOperation mempool + Bundler + Paymaster. EOA-less wallets can sponsor gas in any token.  
**Applies to:** the entire composer flow — a Paymaster can sponsor user gas in USDC instead of ETH.  
**Friction removed:** users do not need an ETH balance to interact.  
**Gas impact:** +30-50 k per UserOp for EntryPoint dispatch.  
**Security:** Paymaster trust model.  
**Adoption work:** integrate a Paymaster (Pimlico, ZeroDev) and wrap composer calls as UserOps.  
**Real-world prior art:** Argent X, Safe{Wallet} 1.4+, Coinbase Smart Wallet.  
**Dependency:** users adopt a 4337-compatible wallet; significant UI work (wallet abstraction layer).

---

### INV-6-005 — EIP-7412 (cross-chain oracle prefetch / data feed delivery)
**Status:** Final.  
**Defines:** standard interface for callers to provide off-chain oracle data within the calldata of the consuming transaction; oracle contract verifies a signature over the data.  
**Applies to:** `PriceOracle.getPriceUsd` reads. Currently fetches Chainlink answer via `latestRoundData` SLOAD — costs ~5 k gas per read but is bound to whatever the latest aggregator round is.  
**Friction removed:** for stale-price scenarios, EIP-7412 lets the caller submit a fresher signed price atomically. Useful when Chainlink heartbeat is slow on testnets (24 h on USDC/DAI per `PriceOracle.sol:46`).  
**Gas impact:** moves ~10 k of EVM signature verification into every borrow tx, but avoids the alternative of a separate "update oracle" tx.  
**Security:** signature scheme of the oracle provider (Pyth, Chainlink Off-Chain Reporting).  
**Adoption work:** integrate Pyth's pull-oracle pattern alongside the existing Chainlink push pattern. Dual-source reduces single-aggregator risk.  
**Real-world prior art:** Synthetix V3 perps, Pyth Network.  
**Dependency:** add Pyth feed addresses to the oracle's source map; wire pull-update into composer entry.

---

### INV-6-006 — EIP-3156 (flash loans)
**Status:** Final.  
**Defines:** standardised flash loan interface (`IERC3156FlashLender.flashLoan` + `IERC3156FlashBorrower.onFlashLoan`).  
**Applies to:** liquidation flow. A liquidator without debt-token capital can flash-borrow `debtToCover`, call `liquidate`, sell the seized collateral on a DEX for the debt token, repay the flash loan, pocket the bonus.  
**Friction removed:** liquidations become permissionless and capital-efficient.  
**Gas impact:** +~30 k for the flash callback path.  
**Security:** flash loan re-entrancy already guarded by `nonReentrant`. The liquidate function would need a flash-loan-aware variant.  
**Adoption work:** add a `flashLoan(token, amount, data)` to LendingPool that uses internal `liquidReserve` accounting + a `safeTransfer-out` / `safeTransferFrom-back` cycle.  
**Real-world prior art:** Aave V2/V3, dYdX.  
**Dependency:** depends on the rate-model / interest-accrual work (INV-2-009) for fee accounting.

---

### INV-6-007 — ERC-4626 (tokenized vault standard)
**Status:** Final.  
**Defines:** a tokenized wrapper around a single asset (deposit asset → mint share token; redeem share → withdraw asset).  
**Applicability:** the StrategyVault is **per-user, encrypted, leveraged** — fundamentally not a fungible-share vault. ERC-4626 conformance would require:
- Each user gets their own tokenized share (per-user share token).
- Or the vault aggregates shares globally — incompatible with the per-user encrypted-position model.

**Conclusion:** ERC-4626 is **not directly applicable** without redesign. Documented as out-of-scope.

**Dependency:** would require splitting "leveraged-position vault" from "deposit-aggregation vault" into two contracts. Redesign-level.

---

### INV-6-008 — ERC-2771 (trusted forwarder for meta-transactions)
**Status:** Final.  
**Defines:** a trusted forwarder relays a user-signed message; the target contract uses `_msgSender()` from a calldata suffix instead of `msg.sender`.  
**Applies to:** the composer. A user signs a meta-tx, a relayer pays the gas, the composer authorises the user via the forwarder.  
**Friction removed:** users can interact without ETH and without an ERC-4337 wallet.  
**Gas impact:** +~5 k per call for `_msgSender()` decoding.  
**Security:** trust shifts to the forwarder. OpenZeppelin's `MinimalForwarder` is the canonical reference.  
**Adoption work:** composer inherits `ERC2771Context`. UI signs typed data per OZ's defender-relay or a custom forwarder.  
**Real-world prior art:** Biconomy, OpenZeppelin Defender.  
**Dependency:** EIP-7702 supersedes most use-cases of ERC-2771; if EIP-7702 is adopted, ERC-2771 is redundant.

---

### INV-6-009 — Multicall3 (canonical batched-read contract)
**Status:** deployed at `0xcA11bde05977b3631167028862bE2a173976CA11` on every major chain (verified to include Arbitrum Sepolia).  
**Applies to:** UI batched view-call refreshes (balances, positions, oracle prices). wagmi already supports it for read aggregation.  
**Friction removed:** UI loading time.  
**Gas impact:** read-only; no on-chain writes.  
**Adoption work:** wagmi is already configured; ensure `useReadContracts({ multicall: true })` is used in the dashboard reads.  
**Dependency:** none.

---

### INV-6-010 — EIP-1271 (smart-contract signature validation)
**Status:** Final.  
**Applies to:** the OWNER role on every contract. If OWNER is a multi-sig (Safe / Coinbase Wallet), all owner-only operations should accept EIP-1271 signatures rather than only `msg.sender == OWNER`.  
**Currently:** the codebase only checks `msg.sender == OWNER` (e.g., `LendingPool._onlyOwner` line 165). A multi-sig must `execTransaction` from its own address as the caller, which works for `msg.sender == OWNER` checks **as long as OWNER is set to the multi-sig address**. So EIP-1271 is **not strictly needed** here — multi-sig owner operations already work via the multi-sig's own `msg.sender`.  
**Conclusion:** ALREADY WORKS for the simple owner-call case. EIP-1271 is only needed if the codebase signs typed data on behalf of OWNER (it does not).  
**Dependency:** none.

---

### INV-6-011 — 2025/2026 EIPs specifically for FHE / encrypted state
**Search results from Fhenix changelog and Ethereum Magicians 2025/2026:**
- **No finalised EIP** specifically standardises FHE-state on Ethereum L1 or L2 as of the cutoff. CoFHE is currently a Fhenix-protocol-level integration, not an EIP.
- Fhenix's "permit-v2" pattern (per the 2025 update of `cofhe-docs.fhenix.zone/fhe-library/introduction/permits`) extends the user's decryption permit with a TTL and a contract scope. The current contracts use the legacy `allowSender` pattern; permit-v2 would let a user issue a single time-bounded permit across multiple contracts. **Applicable to all 6 contracts.**

**Investigation recommendation:** monitor EIP-Magicians / Fhenix discord for finalised standards. No action this cycle.

---

## Phase 7 — Single-block atomic execution

### INV-7-001 — Current state-dependency map across the lifecycle

| Step | Reads | Writes | Storage source |
|---|---|---|---|
| Registry.registerStrategy | none from prior step | strategies[id], idByContentHash, strategyCount | contract own |
| Vault.openPosition | strategyCount (via id, via calldata) | positions[user], hasPosition[user], collateralTokens[user], depositedAmounts[user], positionStrategyIds[user], positionCreatedAt[user] | contract own + token transferFrom |
| Pool.supply | none from prior step | supplyBalances[token][user], plainSupplyBalances[token][user], totalPlainSupply[token], liquidReserve[token] | contract own + token transferFrom |
| Pool.borrowWithOracle | plainSupplyBalances[collateralToken][user], plainBorrowBalances[borrowToken][user], oracle.* | plainBorrowBalances[borrowToken][user], totalPlainBorrow[borrowToken], liquidReserve[borrowToken], borrowBalances[borrowToken][user] | contract own + token safeTransfer |
| Router.submitSwapIntent | nonces[user] | nonces[user], intents[id] | contract own |

**State dependencies:**
- `borrowWithOracle` reads `plainSupplyBalances[collateralToken][user]` — written by `Pool.supply` (or by the user pre-supplying earlier).
- `Vault.openPosition` reads `strategyCount` indirectly (the registered id was returned by `registerStrategy`).

Both dependencies cross contract boundaries. **None require a separate transaction** — all are reads from contracts the composer itself owns approvals to. The composer's `openLeveragedStrategy` correctly threads them in one tx.

---

### INV-7-002 — Theoretical minimum tx count for full lifecycle
| Approach | Txs | Signatures | ETH paid by user |
|---|---:|---:|---|
| Current UI (composer unwired) | 5-7 | 5-7 | yes |
| With composer wired (no permits) | 2 (1 approve + 1 composer.openLeveragedStrategy) | 2 | yes |
| With composer + EIP-2612 / Permit2 | 1 (composer.openLeveragedStrategy with embedded permit) | 1 | yes |
| With composer + EIP-7702 (Pectra) | 1 (delegated batch) | 1 | yes (or sponsor via Paymaster) |
| With composer + EIP-7702 + ERC-4337 Paymaster | 1 | 1 | NO (sponsor pays) |

**Theoretical minimum: 1 transaction, 1 signature, 0 ETH paid by user.**

The gap from "current observed" to "theoretical minimum" is:
- 5-7 → 1 transaction (composer wiring + permit + EIP-7702)
- 5-7 → 1 signature (same)
- ~1.6 M observed gas → ~1 M target (composer's 65% target; not yet measured)

---

### INV-7-003 — EIP-7412 oracle prefetch in `borrowWithOracle`
**Investigation:** the current oracle read is sub-tx — Chainlink `latestRoundData` is an SLOAD-equivalent on a precompile-like aggregator contract. It is not a separate transaction. EIP-7412 prefetch is only valuable if the staleness gate fails on production data; on testnet (24 h heartbeat) this is rare.

**Conclusion:** EIP-7412 is a Phase-2 improvement, not a critical path. INV-7-002 minimum is achievable without it.

---

## Summary table (sorted by severity desc, phase asc)

| ID | Phase | Severity | Location | One-line description |
|---|---|---|---|---|
| INV-2-001 | 2 | HIGH | ui/hooks/use-fhe-vault.ts | FheForgeComposer is deployed but no UI / backend code calls it; lifecycle is 5-7 txs instead of 1. |
| INV-2-002 | 2 | HIGH | ui/app/strategy + ui/app/builder | Strategy lifecycle requires N transactions because the composer is unwired (depends on INV-2-001). |
| INV-2-009 | 2 | HIGH | LendingPool.sol | No interest-accrual / rate model — supply earns 0%, borrow costs 0% in interest. |
| INV-2-005 | 2 | MEDIUM | StrategyVault.closePosition | ~105 k of FHE compose is wasted on full-close path. |
| INV-4-002 | 4 | MEDIUM | LendingPool, Vault, Registry | Underflow-clamp pattern can use `FHE.subClamped` / `FHE.min` to save ~35 k per site (6 sites). |
| INV-5-003 | 5 | MEDIUM | SwapRouter | Single trusted executor with no on-chain settlement proof. |
| INV-5-004 | 5 | MEDIUM | every transferFrom site | No EIP-2612 / Permit2 — every supply/repay needs a separate approve tx. |
| INV-1-001 | 1 | LOW | LendingPool.setOracle, setWeth | Address state vars set without zero-check. |
| INV-1-002 | 1 | LOW | Composer + Oracle | Four unused error declarations (TokenMismatch, InvalidStrategyId, TransferResidualFailed, UnknownToken). |
| INV-2-003 | 2 | LOW | StrategyVault.positionCreatedAt | Mapping written on every open + delete, never read on-chain. ~22 k wasted per open. |
| INV-2-004 | 2 | LOW | LendingPool.borrowWithOracle | `plainBorrowBalances` SLOAD-ed twice across the helper boundary. |
| INV-3-001 | 3 | LOW | StrategyRegistry slots 6+7 | `pendingVault` + `pendingVaultEarliest` could pack into one slot via uint96. |
| INV-3-002 | 3 | LOW | SwapRouter slots 4+5 | same pack opportunity for `pendingExecutor` + earliest. |
| INV-3-003 | 3 | LOW | SwapRouter.SwapIntent | 6-slot struct could be 4 slots (deadline as uint64, packed with user). |
| INV-4-005 | 4 | LOW | StrategyVault.Position.debt | euint128 stored but never read on-chain; ~120 k waste per open. |
| INV-4-006 | 4 | LOW | StrategyRegistry incrementTvl/decrementTvl | `FHE.allowSender(result)` to vault is dead weight. |
| INV-4-007 | 4 | LOW | get-balance functions | Need `eth_sendTransaction` instead of `eth_call` because they mutate ACL — adds ~55 k per UI refresh. |
| INV-5-001 | 5 | LOW | PriceOracle.setSource, setCollateralFactor | Not timelocked despite controlling LTV / aggregator. |
| INV-2-006 | 2 | STYLE | LendingPool.borrowWithOracle | `actual = requested` — encrypted return is encryption-by-name only. |
| INV-2-007 | 2 | STYLE | three contracts | `_ZERO` initialisation duplicated. |
| INV-2-008 | 2 | STYLE | LendingPool.liquidate | Liquidator's collateral acquired in plaintext, no FHE accounting. |
| INV-3-004 | 3 | STYLE | StrategyVault.Position | euint128/euint16/euint8 are 32-B handles; no packing possible. |
| INV-3-005 | 3 | STYLE | StrategyVault | 5 separate per-user mappings could consolidate into 3-slot struct. |
| INV-3-006 | 3 | STYLE | LendingPool slots 8+9 | oracle and weth address vars have padding; pack opportunity is conditional on adding flags. |
| INV-3-007 | 3 | STYLE | dispatch order | Renaming for selector ordering is not worth the ABI churn. |
| INV-3-008 | 3 | STYLE | StrategyRegistry.registerStrategy:188 | forge-lint asm-keccak256; ~30 gas saving via inline assembly. |
| INV-3-009 | 3 | STYLE | LendingPool supplyETH/withdrawETH | mixed-case-function lint; not worth ABI churn. |
| INV-3-010 | 3 | STYLE | Composer + Oracle | L-4 redundant statements cost ~3 gas each; load-bearing for slither cleanliness. |
| INV-3-011 | 3 | INFO | full lifecycle | Per-function gas profile; FHE compose dominates. |
| INV-4-001 | 4 | INFO | all 6 contracts | ~30% of CoFHE SDK surface used; eaddress / FHE.min / sealoutput / decrypt unused. |
| INV-4-003 | 4 | STYLE | StrategyVault.apyTarget | euint16 is optimal. |
| INV-4-004 | 4 | STYLE | StrategyVault.loopCount | euint8 is optimal. |
| INV-5-002 | 5 | STYLE | LendingPool.LIQUIDATION_BONUS_BPS | Could be Dutch-auctioned. |
| INV-5-005 | 5 | STYLE | composer | The composer IS the multicall; the wiring gap (INV-2-001) is the real issue. |
| INV-6-001..011 | 6 | — | various | Standards applicability matrix — see §Phase 6. |
| INV-7-001..003 | 7 | INFO | full lifecycle | Theoretical minimum is 1 tx / 1 sig / 0 user ETH. |

---

## Roadmap 1 — Gas reduction opportunities (highest saving first)

1. **INV-4-002** — replace 6 underflow-clamp sites with `FHE.subClamped` (or `min`+`sub`): **~200 k gas across full lifecycle.** Per call: ~35 k saved. Touches LendingPool (4 sites), StrategyVault (1), StrategyRegistry (1).
2. **INV-2-005** — drop wasted FHE compose chain on full-close path: **~105 k gas saved per `closePosition` (full close).** Lifecycle saving: ~25%.
3. **INV-4-005** — drop unused `Position.debt` storage + ACL: **~120 k saved per `openPosition`.**
4. **INV-3-005** — consolidate StrategyVault per-user mappings into a packed struct: **~40 k saved per `openPosition`.**
5. **INV-2-003** — remove unused `positionCreatedAt`: **~22 k saved per `openPosition`** (or repurpose for a real use-case).
6. **INV-4-006** — drop redundant `FHE.allowSender` on registry TVL: **~50 k saved per increment / decrement.**
7. **INV-3-003** — pack SwapRouter SwapIntent struct: **~20 k saved per `submitSwapIntent`.**
8. **INV-2-004** — inline `_assertHealthyForOracleBorrow`: **~2 k saved per `borrowWithOracle`.**
9. **INV-2-007** — share `_ZERO` initialisation: **~60 k of total deploy gas (one-time).**
10. **INV-3-001 / INV-3-002** — pack pending* fields: **~5 k saved per rotate (rare).**

**Cumulative steady-state lifecycle saving (Roadmap 1 items 1-7): ~430 k gas, ~26% of the v2 baseline of 1.63 M.**

---

## Roadmap 2 — Friction reduction opportunities (most signatures eliminated first)

1. **INV-2-001** — wire the composer into the UI: **5-7 txs / sigs → 2.** Foundational change; everything else depends on this.
2. **INV-6-002** — Permit2 in the composer: **2 → 1 sig** (eliminate the user→composer approve).
3. **INV-6-003** — EIP-7702 user-delegated batch: same end-state as Permit2 (1 sig) but works with any token, no permit support required.
4. **INV-6-001** — EIP-2612 permit fallback (when Permit2 is undesirable): same end-state.
5. **INV-6-004** — ERC-4337 Paymaster sponsorship: **user pays 0 ETH** (sig count unchanged, but UX of "no native gas balance needed" is significant).
6. **INV-4-007** — sealed-output read pattern: **eliminates 1 tx per balance refresh** (every dashboard load currently sends N transactions for N encrypted balances).

**End-state:** 1 transaction, 1 signature, optionally 0 user ETH cost.

---

## Roadmap 3 — FHE / privacy improvements (most private first)

1. **INV-4-007** — adopt `sealoutput` pattern for reads. Removes the requirement that balance reads mutate ACL state; users decrypt off-chain via permit-signed sealed payloads.
2. **INV-4-006** — drop dead `FHE.allowSender` in registry. Reduces ACL surface to the minimum required.
3. **INV-2-006** — rename `borrowWithOracle.actual` to make the encryption-by-name explicit. Caller stops over-trusting the encrypted return.
4. **INV-2-008** — decide and document the liquidator-privacy model. If "liquidator is public" is the intent, document; else mirror the encrypted-balance update.
5. **INV-4-001** — adopt CoFHE permit-v2 pattern (single time-bounded permit across contracts) when finalised by Fhenix.

---

## What this investigation does not cover

- **No on-chain forking / mainnet simulation.** All gas numbers come from the v2 benchmark on arb-sepolia and `forge inspect`; mainnet behaviour may differ.
- **No exhaustive web search of every 2025/2026 EIP.** Phase 6 covers the standards a senior auditor would consider applicable; minor finalised EIPs in unrelated areas (token wrappers, NFT extensions) are not enumerated.
- **No FHE protocol-level analysis.** CoFHE is treated as a black box; per-op gas cost estimates use the CoFHE quick-start documentation but the actual precompile dispatch may differ on Fhenix vs. on Arbitrum Sepolia (which uses CoFHE as a hosted precompile).
- **No frontend code path audit.** The UI grep established that the composer is unused; deeper UI architecture review (state management, error handling, loading states) is out of scope.
- **No backend service audit.** Backend NestJS modules were grep-checked for composer usage but their internal architecture, AI strategy generation, activity tracking, and persistence layers are out of scope.
- **No formal verification.** No invariant testing (Echidna / Halmos / Certora). The protocol's prior runs of `forge test` (8/8 + 4/4) and the postfix-evidence dossier (PASS=25 / WARN=0 / FAIL=0 across 6 runs) are accepted as the safety baseline.
- **No off-chain executor (SwapRouter) analysis.** The `executor` is a trusted role; verifying the off-chain settlement honesty requires inspection of the executor service, which is not deployed in this repository.
- **No StrategyRegistry strategy-archive blast-radius audit.** The `setActive(false)` path is implemented but the vault does not consult `getStrategyMeta(id).active` before opening a new position — INV-bonus: there is no on-chain check that a deactivated strategy cannot be opened (the vault accepts any strategyId > 0 + < strategyCount). Surface to the implementer for confirmation: was this intended (so existing positions can keep mutating) or a wiring gap?
- **No deep audit of OpenZeppelin Pausable + ReentrancyGuard inheritance.** The slither summary's lib-only findings are accepted as upstream issues outside the scope of this protocol.
- **No transaction-mempool / MEV analysis.** The composer eliminates the 4-tx front-running window (O.3); no further MEV inspection performed.
