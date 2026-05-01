# Fix Manifest — Stage 4 of remediation protocol

**Sources:** `STRESS_FINDINGS.md` (10-run brutal test), `CONTRACT_AUDIT_FINDINGS.md`, slither (`slither contracts/`), solhint (`solhint 'contracts/**/*.sol'`), prettier (`prettier --check`), aderyn (`aderyn .`), `forge build` warnings, Stage 3 `BENCHMARK_PRE.md` deltas vs targets.

**Tracks:** A=core logic · B=FHE state · C=Reineira SDK integration · D=gas/throughput · E=registry/permissionless · F=deps · G=tests.

A finding is **CLOSED** only when:
1. Root cause edited in source (no suppress directive)
2. The producing tool exits clean for that specific finding
3. No new finding introduced
4. Full test suite passes after the fix

---

## Status legend
| Symbol | Meaning |
|---|---|
| OPEN | not yet addressed |
| IN-PROGRESS | being worked on |
| CLOSED | all 4 conditions met |
| DEFERRED | documented architectural reason, escalated to roadmap |

---

## §1 Findings from STRESS_FINDINGS / CONTRACT_AUDIT (53 GAPs · 13 WARNs · 2 LIMITs)

| # | ID | Source | Severity | File | Function/Line | What is wrong | Track | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | A.3 | stress | GAP | StrategyVault.sol | closePosition L210-236 | partial close strands collateral; deletes all state regardless of `collateralAmount` | A | OPEN |
| 2 | A.5b2 | stress | GAP | LendingPool.sol | (state invariant) | reserve(token) < Σ plainSupply after any borrow | A | OPEN |
| 3 | A.5c | stress | GAP | LendingPool.sol | withdraw L220-252 | passes plain check but ERC-20 transfer reverts when reserves were drained by a borrow | A | OPEN |
| 4 | C.3 | stress | GAP | StrategyRegistry.sol | Strategy.active L19 | flag set true at register, never updated | E | OPEN |
| 5 | C.4 | stress | GAP | StrategyRegistry.sol | setVault L84-90 | vaultAddress is one-shot; cannot rotate | E | OPEN |
| 6 | C.5 | stress | GAP | SwapRouter.sol | EXECUTOR L35 | immutable; no rotation path | A | OPEN |
| 7 | F.1 | stress | GAP | (all) | — | no batched ops anywhere | C | OPEN |
| 8 | F.2 | stress | GAP | StrategyVault.sol | openPosition / addCollateral | users approve+call vault directly; no Composer | C | OPEN |
| 9 | F.3 | stress | GAP | StrategyVault, LendingPool | (no payable) | no native ETH | C | OPEN |
| 10 | F.4 | stress | GAP | StrategyVault.sol | closePosition | no partial unwind / scaleDown | A | (resolved by Fix #1) |
| 11 | F.5 | stress | GAP | LendingPool.sol | (no accrueInterest, no liquidate) | borrows pay 0% APR forever; no liquidation | DEFERRED | DEFERRED — design choice, post-MVP |
| 12 | F.6 | stress | GAP | LendingPool.sol | withdraw L220 | not gated by outstanding borrow | A | (resolved by Fix #2 / #3) |
| 13 | F.7 | stress | GAP | StrategyRegistry.sol | (no batch register) | no EIP-712-signed batch | C | OPEN |
| 14 | F.8 | stress | GAP | SwapRouter.sol | (single intent only) | no batchSubmit | C | OPEN |
| 15 | F.9 | stress | GAP | (all) | — | no cross-layer triggers | C | OPEN |
| 16 | H.5 | stress | GAP | StrategyRegistry.sol | Strategy struct | strategies are not bound to tokens | E | OPEN |
| 17 | J.6 | stress | GAP | SwapRouter.sol | executeIntent L182 | no on-chain min-out enforcement | DEFERRED | needs ZK proof or oracle; v2 milestone |
| 18 | J.7 | stress | GAP | SwapRouter.sol | (no fee) | executor is altruistic | C | OPEN |
| 19 | M.3 | stress | GAP | (all) | — | no on-chain log of permit issuance | DEFERRED | requires CoFHE backend support |
| 20 | O.2 | stress | GAP | (target metric) | leveraged-flow gas 1.6M | v2 Composer must run ≤ 65% | C | OPEN |
| 21 | O.3 | stress | GAP | UX | 4-tx front-running window | composer single-tx removes it | C | OPEN |
| 22 | P.1 | stress | GAP | StrategyVault.sol | openPosition (plain+enc dual input) | no equality enforcement; user can lie about encrypted | DEFERRED | requires ZK proof of equality, post-MVP |
| 23 | P.2 | stress | GAP | StrategyVault.sol | addCollateral | same skew | DEFERRED | same |
| 24 | P.3 | stress | GAP | LendingPool.sol | supply/borrow/repay/withdraw | same skew | DEFERRED | same |
| 25 | Q.5 | stress | GAP | LendingPool.sol | checkLtvAndBorrow | reserve drainable with own collateral at 100/100 LTV | A | (resolved by Fix #2) |
| 26 | Q.6 | stress | GAP | StrategyRegistry.sol | registerStrategy | mempool front-run grabs strategyId | E | OPEN |
| 27 | S.2 | stress | GAP | StrategyRegistry.sol | (no lifecycle) | strategies live forever, no archive | E | OPEN |
| 28 | S.3 | stress | GAP | StrategyVault.sol | (no maturity) | positions can close any time | DEFERRED | strategist-defined; post-MVP |
| 29 | U.2 | stress | GAP | (FHE ACL) | — | no `allowAddress(third)` path | DEFERRED | CoFHE primitive not yet exposed |
| 30 | W.1 | stress | GAP | (deps) | — | no Permit2 / ERC-1363 | C | OPEN |
| 31 | W.2 | stress | GAP | StrategyVault.sol | — | not ERC-4626 | DEFERRED | shares-as-tokens is post-MVP, design impact too high |
| 32 | W.3 | stress | GAP | (no fee) | — | no protocol/creator fees | C | OPEN |
| 33 | W.4 | stress | GAP | (no automation) | — | no keeper hooks | DEFERRED | post-MVP |
| 34 | W.5 | stress | GAP | LendingPool.sol | — | no batched-sync primitive | C | OPEN |
| 35 | W.6 | stress | GAP | SwapRouter.sol | — | no router-level intent batching | C | OPEN |
| 36 | X.1–X.4 | stress | GAP | all | (no pause) | no circuit breakers | A | OPEN |
| 37 | X.5 | stress | GAP | all | — | no upgrade proxy | DEFERRED | UUPS migration is significant; post-MVP |
| 38 | X.6 | stress | GAP | LendingPool.sol | — | no emergency withdraw | A | OPEN |
| 39 | X.7 | stress | GAP | StrategyRegistry.sol | setVault | no timelock on admin | E | OPEN |
| 40 | X.8 | stress | GAP | StrategyVault, LendingPool | — | no view-only encrypted-balance read | DEFERRED | requires CoFHE peek API |
| 41 | Y.1 | stress | GAP | LendingPool.sol | checkLtvAndBorrow | LTV ignores token decimals | E | OPEN |
| 42 | Y.2 | stress | GAP | LendingPool.sol | — | no oracle | E | OPEN |
| 43 | Y.3 | stress | GAP | LendingPool.sol | — | no per-token LTV | E | OPEN |
| 44 | Y.4 | stress | GAP | StrategyRegistry.sol | encryptedTvls | TVL not normalised | DEFERRED | depends on Y.2 oracle wiring |
| 45 | Y.5 | stress | GAP | LendingPool.sol | — | no liquidation threshold | DEFERRED | depends on F.5 + Y.2 |
| 46 | Z.1–Z.5 | stress | GAP | governance | — | no DAO, no token, no human ID, no KYC, no cross-chain | DEFERRED | full DAO is roadmap-level |
| 47 | AA.1 | stress | WARN | LendingPool.sol | checkLtvAndBorrow | accepts ltvNum=0 | A | OPEN |
| 48 | AA.2 | stress | WARN | StrategyVault.sol | 6 mappings | un-packed Position state | D | OPEN |
| 49 | AA.3 | stress | WARN | LendingPool.sol | 4 mappings | un-packed balance state | D | OPEN |
| 50 | AA.4 | stress | WARN | StrategyVault.sol | addCollateral 330K gas | FHE precompile heavy | D | OPEN |
| 51 | AA.5 | stress | WARN | (all FHE mutators) | — | ACL grants not cached | DEFERRED | needs CoFHE batched grant API |
| 52 | AA.6 | stress | WARN | StrategyRegistry.sol | decrementTvl | full handle decrement | A | (resolved by Fix #1) |
| 53 | A.4 | stress | WARN | StrategyVault.sol | addCollateral | uses ZeroAddress for token mismatch | A | OPEN |
| 54 | B.5 | stress | WARN | StrategyRegistry.sol | registerStrategy | accepts empty name | E | OPEN |
| 55 | B.7a | stress | WARN | SwapRouter.sol | submitSwapIntent | accepts deadlineOffset=0 | A | OPEN |
| 56 | B.8 | stress | WARN | SwapRouter.sol | submitSwapIntent | no upper bound on deadlineOffset | A | OPEN |
| 57 | H.4 | stress | WARN | LendingPool.sol | supply WETH | reverts on missing balance/allowance (fine) | INFO | NO ACTION (expected behaviour) |
| 58 | Q.3 | stress | WARN | StrategyRegistry.sol | registerStrategy | accepts ZeroHash workflow | E | OPEN |
| 59 | Q.4 | stress | WARN | StrategyRegistry.sol | registerStrategy | duplicate names allowed | E | OPEN |
| 60 | B.6 (LIMIT) | stress | LIMIT | StrategyRegistry.sol | registerStrategy | 16KB name = 12M gas DoS | E | OPEN |

---

## §2 Findings from solhint (12 WARNs after `prettier --write`, all "gas" category)

| # | ID | File | Line | Rule | What is wrong | Track | Status |
|---|---|---|---|---|---|---|---|
| 61 | SH-1 | SwapRouter.sol | 52 | gas-indexed-events | `IntentSubmitted.tokenIn` not indexed | D | OPEN |
| 62 | SH-2 | SwapRouter.sol | 52 | gas-indexed-events | `IntentSubmitted.tokenOut` not indexed | D | OPEN |
| 63 | SH-3 | SwapRouter.sol | 52 | gas-indexed-events | `IntentSubmitted.deadline` not indexed | D | OPEN |
| 64 | SH-4 | SwapRouter.sol | 63 | gas-indexed-events | `IntentExecuted.outputAmount` not indexed | D | OPEN |
| 65 | SH-5 | SwapRouter.sol | 94 | gas-increment-by-one | `nonces[msg.sender]++` use `++variable` | D | OPEN |
| 66 | SH-6 | StrategyVault.sol | 78 | gas-indexed-events | `CollateralAdded.amount` not indexed | D | OPEN |
| 67 | SH-7 | StrategyVault.sol | 83 | gas-indexed-events | `PositionClosed.collateralAmount` not indexed | D | OPEN |
| 68 | SH-8 | StrategyRegistry.sol | 14 | gas-struct-packing | `Strategy` struct packing | D | OPEN |
| 69 | SH-9 | LendingPool.sol | 41 | gas-indexed-events | `Supplied.amount` not indexed | D | OPEN |
| 70 | SH-10 | LendingPool.sol | 57 | gas-indexed-events | `Repaid.amount` not indexed | D | OPEN |
| 71 | SH-11 | LendingPool.sol | 62 | gas-indexed-events | `Withdrawn.amount` not indexed | D | OPEN |
| 72 | SH-12 | LendingPool.sol | 129 | gas-strict-inequalities | use strict `<` instead of `<=` | D | OPEN |

---

## §3 Findings from slither (11 LOW/INFO; no HIGH/MEDIUM)

| # | ID | File | Line | Detector | What is wrong | Track | Status |
|---|---|---|---|---|---|---|---|
| 73 | SL-1 | StrategyVault.sol | 109-163 | reentrancy-benign | state writes after FHE precompile (intentional; FHE.asEuintN is cryptographic, not callback-capable) | A | DOCUMENT |
| 74 | SL-2 | SwapRouter.sol | 87-130 | reentrancy-benign | same | A | DOCUMENT |
| 75 | SL-3 | SwapRouter.sol | 87-130 | reentrancy-events | event emitted after FHE precompile | A | DOCUMENT |
| 76 | SL-4 | SwapRouter.sol | 158-165 | timestamp | `block.timestamp` use in `getAmountIn` for ownership check (false positive — comparing addresses, not timestamps) | A | DOCUMENT |
| 77 | SL-5 | SwapRouter.sol | 169-173 | timestamp | same false positive in `cancelIntent` | A | DOCUMENT |
| 78 | SL-6 | SwapRouter.sol | 182-202 | timestamp | INTENTIONAL — `block.timestamp > i.deadline` is the deadline gate | A | DOCUMENT |
| 79 | SL-7 | LendingPool.sol | 27 | naming-convention | `_ZERO` SCREAMING_SNAKE_CASE for immutable | A | DOCUMENT (Solidity style guide allows it) |
| 80 | SL-8 | StrategyRegistry.sol | 41 | naming-convention | `OWNER` immutable | A | DOCUMENT |
| 81 | SL-9 | StrategyRegistry.sol | 43 | naming-convention | `_ZERO` immutable | A | DOCUMENT |
| 82 | SL-10 | StrategyVault.sol | 54 | naming-convention | `REGISTRY` immutable | A | DOCUMENT |
| 83 | SL-11 | SwapRouter.sol | 35 | naming-convention | `EXECUTOR` immutable | A | DOCUMENT |

---

## §4 Findings from aderyn

aderyn currently fails to compile against the contracts because its default project resolver does not pick up our `foundry.toml` remappings. Adding `aderyn.toml` (committed in this stage) so it can resolve `@openzeppelin` and `@fhenixprotocol`. Re-run after compile fix.

| # | ID | Status |
|---|---|---|
| 84 | AD-config | FIX `aderyn.toml`; re-run | F | IN-PROGRESS (config done, will re-run after Track A patches land) |

---

## §5 Findings from prettier

`prettier --write` ran and re-formatted every contract; `prettier --check` now exits clean. 0 outstanding formatting diffs.

---

## §6 Findings from forge build

Compiles clean (46 files, 0 warnings, 0 errors).

---

## §7 Findings from forge test

Pre-existing tests: 4 hardhat (`StrategyVault.test.ts`) + 5 foundry (`NonFheConstructor.t.sol`) = 9/9 pass. Track G expands these.

---

## §8 Findings from BENCHMARK_PRE benchmark deltas

| # | ID | What | Track | Status |
|---|---|---|---|---|
| 85 | BM-lifecycle | Strategy lifecycle gas = 1 448 411; v2 target ≤ 941 467 (≤65% per O.2) | C | OPEN |
| 86 | BM-addCollateral | 330 K gas; v2 target ≤ 200 K (per AA.4 + V2_ARCHITECTURE §3.10) | D | OPEN |
| 87 | BM-throughput-perop | registerStrategy 166 K per op; constant under N=500. v2 target ≤ 80 K via batch primitive (W.5) | C | OPEN |

---

## §9 Track summary

| Track | Open | In-Progress | Closed | Deferred | Total |
|---|---:|---:|---:|---:|---:|
| A | 14 | 0 | 0 | 1 | 15 |
| B | 0 | 0 | 0 | 0 | 0 |
| C | 13 | 0 | 0 | 0 | 13 |
| D | 14 | 0 | 0 | 1 | 15 |
| E | 13 | 0 | 0 | 0 | 13 |
| F | 0 | 1 | 0 | 0 | 1 |
| G | 0 | 0 | 0 | 0 | 0 |
| DEFERRED | 0 | 0 | 0 | 18 | 18 |
| INFO | 0 | 0 | 0 | 1 | 1 |
| DOCUMENT | 0 | 0 | 0 | 11 | 11 |

**Total findings:** 87 unique fix candidates after de-duplication.

---

## §10 Dependency graph for parallel execution

| Shared file | Tracks that touch it | Sequence |
|---|---|---|
| `StrategyVault.sol` | A (closePosition, addCollateral validation, executor checks), D (struct packing, indexed events), C (Composer integration) | **A → D → C** |
| `LendingPool.sol` | A (reserve gate, withdraw check, emergencyWithdraw, pause), D (indexed events, strict inequalities, struct packing), E (oracle, per-token LTV), C (Composer + Reineira insurance) | **A → E → D → C** |
| `StrategyRegistry.sol` | E (lifecycle, vault rotation, name validation, commit-reveal, namespacedId), D (struct packing) | **E → D** |
| `SwapRouter.sol` | A (executor rotation timelock, deadline bounds), D (indexed events, ++pre nonce), C (Reineira escrow integration) | **A → D → C** |
| `IStrategyRegistry.sol` | E (signature changes for namespacedId, lifecycle, oracle) | E only |

Tracks F (deps) and G (tests) are file-disjoint from the contract patches and run anytime.

---

## §11 Stage 5 execution order (this session)

Given session-time constraints, fixes execute in this priority order:

1. **A.* funds-loss bugs** — close A.3, A.5b2/c, F.6, Q.5, AA.6: change closePosition to be partial-aware; add reserve-gated withdraw + healthFactor check; add emergencyWithdraw.
2. **A.* boundary fixes** — close A.4, B.7a, B.8, AA.1: rename token-mismatch error, deadline bounds, ltvNum=0 check.
3. **D.* gas-warning sweep** — close all 12 solhint warnings in §2: indexed events, ++pre, struct packing, strict inequalities.
4. **E.* registry hardening** — close C.3, C.4, X.7, S.2, B.5, Q.3, Q.4, Q.6, B.6: lifecycle, vault rotation timelock, name validation, commit-reveal id.
5. **A.4-X.* circuit breakers** — close X.1–X.4, X.6: OZ Pausable + emergency role.
6. **G.* tests** — add a forge test or hardhat test for each fix above.
7. **C.* Composer + Reineira (DESIGN ONLY in this session)** — scaffold `FheForgeComposer.sol` that wraps Reineira's `escrow.create()` for swap intents and `insurance.purchaseCoverage()` for borrow protection. Leave full implementation for follow-up session.
8. **F.* deps** — re-run aderyn after the contract changes land.

Stage 5 exit conditions are re-checked at the end. Anything still failing reopens with severity escalated.
