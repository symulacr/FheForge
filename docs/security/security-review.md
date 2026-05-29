# FheForge Security Review

**Protocol:** FheForge -- Private Encrypted DeFi on Arbitrum Sepolia
**Review Date:** May 2026
**Scope:** Core smart contracts (Solidity 0.8.28, CoFHE SDK, OpenZeppelin)
**Chain:** Arbitrum Sepolia (421614)

---

## 1. Introduction

This document presents a structured security review of the FheForge protocol's core smart contract suite. The review covers 9 contracts that form the lending, position management, swap, oracle, execution, and governance layers of the protocol.

**Methodology:**

- Manual code review of each contract's critical functions and access control model
- Attack vector enumeration per contract with mitigation assessment
- Cross-contract dependency analysis for privilege escalation and reentrancy chains
- FHE-specific threat modeling covering ciphertext malleability, decryption oracle abuse, and proof replay
- Risk ratings based on impact and likelihood: Low (cosmetic or hard-to-exploit), Medium (exploitable under specific conditions), High (direct fund loss or permanent lock)

**Contracts reviewed:**

| Contract | Lines | Role |
|---|---|---|
| LendingPool | 607 | Core lending (supply, borrow, repay, liquidate, flash loan) |
| StrategyVault | 266 | Encrypted position management |
| SwapRouter | 253 | Intent-based DEX integration with Uniswap V3 |
| PriceOracle | 358 | Multi-source pricing (Pyth + fallback) |
| StrategyExecutor | 175 | Action pipeline execution with gas checkpointing |
| ExecutorContract | 49 | Ownable access proxy for SwapRouter executor |
| FheForgeComposer | 252 | Orchestration layer for multi-step strategies |
| FheForgeBase | 178 | Shared base (ownership, pausability, reentrancy, FHE helpers) |
| GovernanceModule | 122 | OZ Governor + TimelockController |

Supporting contracts (StrategyRegistry, TokenRegistry, FHESafeMath128, SharedStrategyMeta, TimelockedRotation) are included where they interact with the core.

---

## 2. Contract-by-Contract Security Analysis

### 2.1 LendingPool

**Purpose:** Core lending engine. Users supply encrypted amounts, borrow against encrypted collateral, repay, and liquidate undercollateralized positions using CoFHE threshold signatures.

**Critical functions and access control:**

| Function | Access | Description |
|---|---|---|
| `shield()` / `shieldEth()` | Public, nonReentrant | Deposit tokens with encrypted amount |
| `borrowWithLtvCheck()` | Public, nonReentrant | Borrow with user-supplied LTV numerator/denominator |
| `borrowWithOracle()` | Public, nonReentrant | Borrow with oracle-based collateral check |
| `repayDebt()` | Public, nonReentrant | Repay encrypted debt |
| `liquidateWithProof()` | Public, nonReentrant | Liquidate with CoFHE threshold signatures |
| `flashLoan()` | Public, nonReentrant | ERC-3156 flash loan (5 bps fee) |
| `depositFor()` / `borrowFor()` / `repayFor()` | onlyComposer | Composer-orchestrated operations |
| `setOracle()` / `setComposer()` / `setWeth()` | onlyOwner | Admin configuration |
| `partialUnshield()` / `unshieldWithProof()` | Public, nonReentrant | Withdrawal paths |

**Attack vectors:**

| Vector | Risk | Description | Mitigation |
|---|---|---|---|
| Dual plain+encrypted input skew | Medium | `_verifyEquality` uses caller-provided plaintext for equality check. Skew only affects caller's own transaction. | Known, documented; CoFHE ZK proof planned post-MVP |
| Oracle price manipulation | High | `borrowWithOracle()` and liquidation rely on `oracle.convertToUsd()`. | Staleness thresholds, fallback prices |
| Flash loan reentrancy | Medium | ERC-3156 callback could attempt reentrancy. | nonReentrant on all state-changing functions |
| Liquidation proof forgery | High | `FHE.verifyDecryptResult()` validates balance proofs. | CoFHE threshold signatures prevent forgery |
| Self-liquidation | Low | User could liquidate own position. | CannotSelfLiquidate() guard |
| Composer privilege | High | `borrowFor()` has no LTV or collateral check. Composer can borrow for any user. | Composer is owner-set; centralization risk |
| No oracle set | Medium | `OracleNotSet()` revert if oracle is address(0). | Mitigated |
| `totalPlainBorrow` unchecked arithmetic | Low | `unchecked { totalPlainBorrow += amount }` disables overflow checks. | Practically infeasible to overflow uint256 |

**Risk rating: Medium-High**

Key concern: the Composer address has unchecked borrowing authority. If the Composer is compromised or misconfigured, user funds can be borrowed against without proper collateral checks.

---

### 2.2 StrategyVault

**Purpose:** Encrypted position management. Positions identified by `keccak256(abi.encode(user, nonce))`.

**Critical functions and access control:**

| Function | Access | Description |
|---|---|---|
| `openPosition()` | Public, nonReentrant | Create position. Position owner = _msgSender() (typically Composer). |
| `addCollateral()` | Public, nonReentrant | Add encrypted collateral. Uses SharedStrategyMeta.safeIncrease. |
| `closePosition()` | Public, nonReentrant | Close or partially withdraw. Checks positionOwner. |
| `withdrawPaused()` | Public, whenPaused | Emergency withdrawal during pause. |
| `getCollateral()` | Public | Returns encrypted collateral with ACL grant. |

**Attack vectors:**

| Vector | Risk | Description | Mitigation |
|---|---|---|---|
| Unauthorized close | High (resolved) | `closePosition()` checks `positionOwner[positionId]` | P-HIGH-6 fix applied in v1.1.0 |
| Position ID collision | Low | `keccak256(user, nonce)` with incrementing nonce | Preimage resistance of keccak256 |
| Same-block close | Medium | Flash-loan-based position manipulation | SameBlockClose guard |
| TVL manipulation | Medium | `closePosition()` decrements encrypted TVL | `_verifyEquality` ensures amount integrity |
| No minimum collateral | Low | Dust positions could spam storage | No enforcement |
| No health check on close | Low | Position can be closed regardless of liquidation status | By design (self-custody) |

**Risk rating: Low-Medium**

The vault benefits from several hardening passes (P-HIGH-6, P-CRIT-1, P-CRIT-4). Main residual risk is the Composer being the position owner rather than the end user.

---

### 2.3 SwapRouter

**Purpose:** DEX integration via Uniswap V3 with two modes: (1) direct swaps and (2) intent-based swaps with deadline bounds.

**Critical functions and access control:**

| Function | Access | Description |
|---|---|---|
| `submitSwapIntent()` | Public, whenNotPaused | Escrows tokenIn, creates intent with bounded deadline |
| `executeIntent()` | Executor only | Settles intent; transfers tokenOut to user, tokenIn to executor |
| `cancelIntent()` | Intent creator only | Cancels intent, returns escrowed tokens |
| `swapViaUniswapV3Single()` | Public, whenNotPaused | Direct Uniswap V3 single-hop swap |
| `swapViaUniswapV3MultiHop()` | Public, whenNotPaused | Direct Uniswap V3 multi-hop swap |
| `proposeExecutor()` | onlyOwner | Propose new executor with TimelockedRotation |
| `acceptExecutor()` | Public | Accept pending executor after timelock |

**Attack vectors:**

| Vector | Risk | Description | Mitigation |
|---|---|---|---|
| Executor compromise | High | Executor can execute intents at arbitrary outputAmount (above minOut) | Timelocked rotation, ExecutorContract proxy |
| Deadline manipulation | Medium | Bounded deadline prevents stale or never-expiry intents | MIN_DEADLINE_OFFSET / MAX_DEADLINE_OFFSET |
| Swap path injection | Medium | Multi-hop accepts arbitrary encoded path | forceApprove limits router to amountIn of tokenIn |
| Intent ID collision | Low | ChainId + router + user + nonce in hash | Sufficient uniqueness |

**Risk rating: Medium**

Primary risk is executor compromise, partially mitigated by timelocked rotation.

---

### 2.4 PriceOracle

**Purpose:** Multi-source pricing with Pyth primary oracle and configurable fallback prices.

**Critical functions and access control:**

| Function | Access | Description |
|---|---|---|
| `setSource()` / `batchSetSources()` | onlyOwner | Configure Pyth price feed |
| `setCollateralFactor()` | onlyOwner | Set LTV and liquidation threshold BPS |
| `updatePriceFeeds()` | Public (payable) | Submit Pyth update data; caller pays fee |
| `getPriceWithFallback()` | Public view | Pyth price, fallback to owner-set price if stale |
| `convertToUsd()` / `convertFromUsd()` | Public view | Price conversion for collateral checks |
| `setFallbackPrice()` / `removeFallbackPrice()` | onlyOwner | Manage fallback prices |
| `sweepEth()` | onlyOwner | Withdraw accumulated ETH from update fees |

**Attack vectors:**

| Vector | Risk | Description | Mitigation |
|---|---|---|---|
| Fallback price manipulation | High | Owner sets arbitrary fallback price | Requires trust in owner multisig |
| Staleness threshold inconsistency | Medium | Global `stalenessThreshold` used in fallback path regardless of per-token thresholds | Minor; getPriceNoOlderThan still uses per-token threshold |
| Batch timestamp update | Medium | `updatePriceFeeds()` marks ALL tokens as fresh | Only affects fallback staleness check |
| Confidence interval too strict | Medium | Rejects prices with conf > 1% of price; may reject valid volatile prices | Conservative by design |
| Decimal mismatch | Medium | `convertToUsd` defaults to 18 decimals if not set | Operational; owner must configure correctly |

**Risk rating: Medium**

Multi-source architecture provides redundancy, but owner-controlled fallback prices introduce centralization risk.

---

### 2.5 StrategyExecutor

**Purpose:** Execute composable action pipelines (up to 8 action types: SHIELD_SUPPLY, BORROW_LTV, SWAP_INTENT, REPAY_DEBT, DEPOSIT_VAULT, ADD_COLLATERAL, WITHDRAW_VAULT, SWAP_UNISWAP_V3) with gas checkpointing.

**Critical functions and access control:**

| Function | Access | Description |
|---|---|---|
| `executePipeline()` | Public, nonReentrant | Iterates Action[] with gas check (100K reserve); saves checkpoint if gas low |
| `resetCheckpoint()` | onlyOwner | Reset gas checkpoint for a strategy |
| `sweepToken()` | onlyOwner | Recover accidentally sent tokens |

**Attack vectors:**

| Vector | Risk | Description | Mitigation |
|---|---|---|---|
| Checkpoint manipulation | Low | Attacker could intentionally trigger partial execution | Gas griefing only; no fund loss |
| Pipeline reordering | Medium | No dependency enforcement between actions | Only Composer submits to StrategyExecutor |
| Infinite approval | Medium | `_ensureApproval` grants type(uint256).max to POOL/VAULT/ROUTER | Standard batcher pattern; dependent on target contract security |
| Gas threshold calibration | Low | 100K reserve is arbitrary for Arbitrum L2 | Should be calibrated |

**Risk rating: Low-Medium**

Gas checkpointing is novel and appears correctly implemented.

---

### 2.6 ExecutorContract

**Purpose:** Thin Ownable proxy that holds the SwapRouter executor role.

**Critical functions and access control:**

| Function | Access | Description |
|---|---|---|
| `executeIntent()` | onlyOwner | Calls `ISwapRouter(router).executeIntent()` |
| `approveToken()` | onlyOwner | Grants token approval |
| `withdrawTokens()` | onlyOwner | Sweeps tokens to owner |

**Attack vectors:**

| Vector | Risk | Description | Mitigation |
|---|---|---|---|
| Owner key compromise | High | Unrestricted access to execute intents and withdraw tokens | Operational risk; multi-sig recommended |
| Arbitrary router address | Low | `executeIntent()` accepts arbitrary router address | By design (owner is trusted) |

**Risk rating: Medium**

Minimal surface area (3 functions, all onlyOwner). Security relies entirely on owner key management.

---

### 2.7 FheForgeComposer

**Purpose:** Orchestration contract for multi-step strategy opening (deposit collateral, supply to pool, borrow, swap). Also handles rebalancing.

**Critical functions and access control:**

| Function | Access | Description |
|---|---|---|
| `openPosition()` | Public, nonReentrant | Full strategy lifecycle: vault -> deposit -> borrow -> swap |
| `rebalance()` | Public, nonReentrant | Add collateral, repay debt, borrow new amount |
| `sweepToken()` | onlyOwner | Recover accidentally sent tokens |

**Attack vectors:**

| Vector | Risk | Description | Mitigation |
|---|---|---|---|
| Partial funding | Medium | Pulls `max(collateralAmount, poolSupplyAmount)` upfront | User must approve full amount |
| Infinite approval | Medium | `_ensureApproval` grants type(uint256).max to Vault/Pool/Router | Standard DeFi pattern |
| Borrowed tokens bypass | Low | If no swap needed, borrowed tokens go directly to user | By design |

**Risk rating: Low-Medium**

Correctly uses `_verifyEquality` for all encrypted amounts and `FHE.allowTransient` for cross-contract ACL.

---

### 2.8 FheForgeBase (Shared Infrastructure)

**Purpose:** Abstract base providing ownership (two-step transfer), pausability, reentrancy guard (custom bitflag), FHE helpers.

**Key security features:**

- Custom reentrancy guard using bit 1 of `_poolGuard`
- Pausability using bit 0 of `_poolGuard`
- Two-step ownership transfer
- Immutable `_ZERO` euint128 handle for uninitialized storage
- `_verifyEquality` -- FHE equality check with ciphertext validation
- `_safeIncrease` / `_safeDecrease` -- FHESafeMath128 wrappers with ACL grant

**Attack vectors:**

| Vector | Risk | Description | Mitigation |
|---|---|---|---|
| Reentrancy/pause bit collision | Low | Bit 0 (paused) and bit 1 (reentered) are independent | Mitigated |
| Ownership hijack | Low | Two-step pattern prevents wrong-address transfer | Mitigated |
| `_verifyEquality` ciphertext validation | Medium | Uses FHE.isInitialized + FHE.eq; FHE.select fallback to _ZERO | Mitigated |

**Risk rating: Low**

Well-structured base with appropriate guards. Custom bitflag is non-standard but correct.

---

### 2.9 GovernanceModule (FheForgeGovernor + FheForgeTimelock)

**Purpose:** Standard OpenZeppelin Governor with TimelockController for on-chain governance.

**Configuration:**

- Voting delay: 1 day
- Voting period: 3 days
- Proposal threshold: 100 FHE tokens (18 decimals)
- Quorum: Configurable BPS at construction
- Timelock minimum delay: 2 days
- Executors: Anyone (open execution after timelock)

**Attack vectors:**

| Vector | Risk | Description | Mitigation |
|---|---|---|---|
| Governance takeover | High | Requires 100 token proposal threshold + majority vote | Standard OZ pattern; mitigated by token distribution |
| Immutable quorum | Medium | `quorumBps` set in constructor with no setter | If token distribution shifts, quorum may become too easy/hard |
| Timelock bypass | Low | All queued operations respect minimum delay | Mitigated |
| Malicious proposals | High | Governance can change any owner-controlled parameter | Standard DAO risk; 2-day timelock provides exit window |

**Risk rating: Low-Medium**

Standard OZ Governor with no custom modifications. Security is equivalent to widely-used Governor patterns.

---

## 3. Attack Tree

```
Root: Compromise user funds
|
+-- OR: Oracle manipulation
|   +-- Stale price submission
|   |   +-- Pyth price not updated within stalenessThreshold
|   |   +-- Mitigated: getPriceNoOlderThan enforces per-token threshold
|   |   +-- Residual: updatePriceFeeds marks ALL tokens as fresh
|   |
|   +-- Fallback price manipulation
|   |   +-- Owner sets arbitrary fallback price
|   |   +-- Pyth goes stale or unavailable
|   |   +-- Mitigated: multi-source architecture reduces likelihood
|   |   +-- Residual: single point of admin control
|   |
|   +-- Confidence interval bypass
|       +-- conf/price ratio exceeds 1% threshold
|       +-- Mitigated: revert on conf < 1 or conf * 10000 > absAnswer * 100
|
+-- OR: Liquidation manipulation
|   +-- Proof forgery
|   |   +-- Attacker creates fake CoFHE balance proof
|   |   +-- Mitigated: FHE.verifyDecryptResult with threshold signatures
|   |
|   +-- Front-running healthy positions
|   |   +-- Attacker observes pending liquidation and front-runs
|   |   +-- Mitigated: FHE privacy prevents viewing encrypted balances
|   |
|   +-- Self-liquidation
|       +-- User liquidates own position to extract value
|       +-- Mitigated: CannotSelfLiquidate() guard
|
+-- OR: Access control bypass
|   +-- Incorrect role assignment
|   |   +-- Composer address set to malicious contract
|   |   +-- Owner-only setComposer() prevents unauthorized change
|   |   +-- Residual: locked owner key = permanent Composer control
|   |
|   +-- Position ownership confusion
|   |   +-- closePosition without authorization
|   |   +-- Mitigated: positionOwner mapping check (P-HIGH-6 fix)
|   |
|   +-- Pause bypass
|       +-- withdrawPausedWithProof bypasses pause
|       +-- By design: emergency withdrawal path for user funds
|
+-- OR: Flash loan attack
|   +-- Oracle price manipulation via flash loan
|   |   +-- Attacker flash-loans large amount, swaps to manipulate Uniswap price
|   |   +-- Pyth price unaffected (Pyth is external oracle)
|   |   +-- Residual: sequential operations could use manipulated pool price
|   |
|   +-- Reentrancy in flash loan callback
|   |   +-- onFlashLoan calls back into LendingPool
|   |   +-- Mitigated: nonReentrant on all state-changing functions
|   |
|   +-- Flash loan + closePosition same block
|       +-- Attacker opens vault, flash-loans against it, closes in same block
|       +-- Mitigated: SameBlockClose guard in StrategyVault
|
+-- OR: FHE-specific attacks
|   +-- Decryption oracle abuse
|   |   +-- Attacker repeatedly calls requestBalanceReveal on own positions
|   |   +-- No fund loss: user can only reveal own balances
|   |   +-- Residual: gas cost for FHE operations
|   |
|   +-- Proof reuse / replay
|   |   +-- Attacker reuses old CoFHE signature to withdraw
|   |   +-- Mitigated: FHE.verifyDecryptResult binds proof to current ciphertext state
|   |   +-- Residual: signature validity period depends on CoFHE implementation
|   |
|   +-- Ciphertext malleability
|   |   +-- FHE ciphertexts can be modified without knowing plaintext
|   |   +-- Attacker could create valid-looking but inflated ciphertext
|   |   +-- Mitigated: _verifyEquality checks FHE.eq against claimed plaintext
|   |   +-- Residual: depositFor/borrowFor accept raw euint128 from Composer
|   |
|   +-- ACL bypass
|       +-- Unauthorized account decrypts another user's position
|       +-- Mitigated: per-user ACL via FHE.allow/allowSender/allowThis
|       +-- Cross-user isolation verified in testing
|
+-- OR: Pipeline / executor attacks
    +-- Checkpoint manipulation
    |   +-- Attacker triggers partial execution to leave checkpoint
    |   +-- Next execution resumes from checkpoint, skipping prior actions
    |   +-- Mitigated: completed flag + actionIndex are strategy-scoped
    |
    +-- Executor compromise
    |   +-- SwapRouter executor executes intents at unfavorable rates
    |   +-- Mitigated: timelocked executor rotation
    |   +-- Residual: executor EOA private key risk
    |
    +-- Infinite approval drain
        +-- StrategyExecutor has unlimited approvals to POOL/VAULT/ROUTER
        +-- If any target contract is compromised, held tokens are drained
        +-- Residual: dependent on upstream contract security
```

---

## 4. Key Security Properties

### 4.1 FHE Privacy Properties

- **Encrypted state:** All supply balances, borrow balances, and vault collateral amounts are stored as `euint128` ciphertexts. No plaintext amounts are persisted on-chain.
- **MEV / frontrunning resistance:** Encrypted balances prevent searchers from identifying undercollateralized positions for liquidation frontrunning. Liquidators must obtain CoFHE threshold signatures to prove position health.
- **Selective disclosure:** Users can reveal balances via `requestBalanceReveal()` / `requestUnshield()`, or via `FHE.verifyDecryptResult()` with threshold signatures. ACL is per-user: user B cannot decrypt user A's ciphertexts.
- **Cross-user isolation:** Verified in testing. Each `FHE.allow()` call is scoped to the target address. Contract-level `allowThis` enables internal computation without revealing to external callers.

### 4.2 Reentrancy Protection

- **Custom bitflag reentrancy guard:** All state-mutating functions across all contracts use `nonReentrant`. The implementation uses bit 1 of `_poolGuard` to track reentered state.
- **CEI pattern verification:** Token transfers happen before encrypted state updates. Cross-contract reentrancy is blocked because each contract has its own `nonReentrant` guard.
- **Limitation:** The custom guard is a non-standard implementation. While correct, it should be verified with formal fuzz testing to confirm the bitflag states cannot collide.

### 4.3 Oracle Security

- **Staleness prevention:** `getPriceNoOlderThan(id, threshold)` enforces per-token staleness thresholds at the Pyth SDK level. `getPriceWithFallback()` has an additional `_isPythStale()` check.
- **Confidence validation:** Pyth prices with `conf < 1` or `conf > 1%` of the price are rejected. This prevents low-confidence prices from being used in collateral calculations.
- **Multi-source redundancy:** Pyth + owner-set fallback prices provide availability even if Pyth is down. Fallback prices are a centralization vector but prevent complete protocol halt.
- **Per-token collateral factors:** `collateralFactorBps` limits the maximum loan-to-value ratio per token. `liquidationThresholdBps` defines when positions become liquidatable. Both are owner-set and bound by `BPS_DEN` (10000).

### 4.4 FHE Math Safety

- **FHESafeMath128:** Provides homomorphic overflow/underflow detection using `FHE.gte`. On failure, the original value is preserved via `FHE.select`, not reverted.
- **`_verifyEquality`:** Validates that a ciphertext equals `claimedPlain` using `FHE.eq`. Mismatched values are zeroed out via `FHE.select`. Prevents ciphertext/plaintext mismatch from entering state.
- **`_ensureInitialized`:** Returns `_ZERO` for uninitialized handles, ensuring that arithmetic on empty storage produces predictable results.

### 4.5 Access Control Architecture

- **Two-step ownership:** All Ownable contracts use `transferOwnership()` / `acceptOwnership()`. Prevents transfers to incorrect addresses.
- **Timelocked rotations:** SwapRouter executor and StrategyRegistry vault use `TimelockedRotation` mixin. Proposed changes require a configurable delay before acceptance.
- **Composer privilege:** The Composer address (set by owner) has bypass-level access to LendingPool (deposit/borrow/repay for any user without LTV checks). This is intentional for the strategy pipeline but represents a centralization point.
- **Executor privilege:** The ExecutorContract owner can execute any swap intent and withdraw any token. This is a hot wallet role.

---

## 5. Recommendations

### Priority: High

**R1 -- Implement CoFHE ZK proof of equality for dual-input functions.**
The dual plain+encrypted input pattern in LendingPool's `shield()`, `borrowWithLtvCheck()`, `repayDebt()`, and `partialUnshield()` relies on `_verifyEquality` which uses the same plaintext provided by the caller. A CoFHE ZK proof of equality would cryptographically link the client-side encrypted amount to the plaintext, preventing any mismatch between the user's intent and the on-chain commitment. Already planned for post-MVP but should be prioritized.
*Affects: LendingPool, FheForgeComposer, StrategyVault*

**R2 -- Migrate to multi-sig governance for owner roles.**
The owner role controls oracle addresses, fallback prices, collateral factors, composer address, executor address, and pause/unpause across all contracts. A single EOA owner represents a single point of failure. Deploy a multi-sig (e.g., Gnosis Safe) as the owner of all contracts with threshold 2-of-3 or higher.
*Affects: All contracts*

**R3 -- Add minimum delay for Composer address changes.**
The Composer address has unchecked borrowing authority (`borrowFor` has no LTV or collateral check). Currently `setComposer()` is immediate via `onlyOwner`. Add a timelock (reuse `TimelockedRotation` or similar) so users have a window to exit if a malicious composer is set.
*Affects: LendingPool*

### Priority: Medium

**R4 -- Fix per-token timestamp tracking in `updatePriceFeeds()`.**
`PriceOracle.updatePriceFeeds()` updates `lastPriceUpdate` for ALL registered tokens regardless of which feeds were actually updated. Only update `lastPriceUpdate[token]` for tokens whose Pyth feeds are included in `updateData`.
*Affects: PriceOracle*

**R5 -- Enforce supply and borrow caps on-chain.**
TokenRegistry stores `borrowCap` and `supplyCap` but no contract checks them. Add hooks in LendingPool's `shield()` and `borrowWithOracle()` to enforce these caps.
*Affects: TokenRegistry, LendingPool*

**R6 -- Add position health check to StrategyVault `closePosition()`.**
`closePosition()` allows partial withdrawal without checking whether the remaining collateral is still healthy. Consider adding an optional oracle health check for partial closes when a strategy is associated.
*Affects: StrategyVault*

**R7 -- Separate vault position ownership from Composer.**
In `openPosition()`, `positionOwner[positionId] = _msgSender()` means the Composer is always the position owner. Change this to use the beneficiary address so the end user owns their position directly.
*Affects: StrategyVault*

**R8 -- Add revocable ACL for position privacy.**
`requestLiquidityCheck()` and `requestBalanceReveal()` call `FHE.allowPublic()` which is irreversible. Add a mechanism to rotate the user's encryption key or re-encrypt their position so previously-granted public ACLs become invalid.
*Affects: LendingPool (requires CoFHE runtime support)*

### Priority: Low

**R9 -- Add minimum absolute flash loan fee.**
The flash loan fee is `(amount * 5) / 10000` with no minimum. Consider adding a minimum fee (e.g., 1 wei) to prevent dust flash loan spam.
*Affects: LendingPool*

**R10 -- Remove `receive()` from LendingPool.**
`LendingPool.receive()` accepts ETH from any source. Only the WETH unwrap path (`partialUnshieldEth`) is a legitimate source. Remove `receive()` or add a `whenNotPaused` guard.
*Affects: LendingPool*

---

## Summary

| Contract | Risk Rating | Key Concerns |
|---|---|---|
| LendingPool | Medium-High | Dual-input verification gap, composer privilege, oracle dependence |
| StrategyVault | Low-Medium | Position owner is Composer, no health check on close |
| SwapRouter | Medium | Executor compromise risk, timelocked rotation mitigates |
| PriceOracle | Medium | Fallback price centralization, batch timestamp issue |
| StrategyExecutor | Low-Medium | Infinite approval pattern, checkpoint reuse |
| ExecutorContract | Medium | Single-owner hot wallet |
| FheForgeComposer | Low-Medium | Multi-step atomicity, orchestrator privilege |
| FheForgeBase | Low | Well-structured base, custom guard is non-standard but correct |
| GovernanceModule | Low-Medium | Standard OZ Governor, standard DAO risks |

The protocol demonstrates a thoughtful security architecture with FHE-specific mitigations (ciphertext verification, safe math, ACL isolation). The highest-priority findings relate to the centralization of privileged roles (owner, composer, executor) and the residual verification gap in the dual plain+encrypted input pattern. Moving toward multi-sig governance and CoFHE ZK proofs for input verification would significantly reduce the protocol's trust assumptions.

---

*Review conducted for FheForge v1.2.0. Contracts deployed on Arbitrum Sepolia. CoFHE runtime on Fhenix TaskManager.*
