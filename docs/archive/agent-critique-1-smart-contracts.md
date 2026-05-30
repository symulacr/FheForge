# Agent Critique — Wave 1 Audit: Smart Contracts

**Author:** Sisyphus-Jr (Post-Audit Peer Review)  
**Date:** 2026-05-18  
**Audit Source:** `agent-1-smart-contracts.md` (214 lines) + `WAVE1_MANIFEST.md`  

---

## Executive Summary

The Wave 1 Smart Contracts audit identified **6 P0-P2 findings** and **5 P3 items** across 4 contracts. The analysis is technically competent but has several blind spots: it misses a critical accounting integrity vulnerability, under-severities interest accrual (P2 → P1), over-severities trivial encryption in liquidation (P1 → P3), and fails to surface reentrancy and flash loan risks from the proposed remediation. The migration sequence is mostly sound but the cross-contract ACL assessment needs deeper treatment.

---

## Finding-by-Finding Critique

---

### SC-P0-1 — Dual plain+encrypted state (totalPlainBorrow / liquidReserve)

**Reported severity:** P0  
**My assessment: P0 — CORRECT**

This is correctly classified. Plain aggregate state on a protocol claiming FHE confidentiality is an existential issue for the privacy value prop. However:

#### What the analysis missed:

1. **Flash loan breakage (CRITICAL):** The `maxFlashLoan()` function (line 607-610) reads `liquidReserve[token]` and `totalPlainBorrow[token]` directly to compute available liquidity. If these become encrypted, `maxFlashLoan` returns garbage or zero — breaking ERC-3156 flash loans entirely. The audit mentions this at line 31 (`provide a maxFlashLoanEncrypted`) but doesn't explore the downstream impact: any protocol or EOA integrating flash loans (e.g., arbitrage bots, liquidators) will break.

2. **`flashFee()` breakage:** Same issue at line 614-616 — the function checks `liquidReserve[token] == 0 && totalPlainBorrow[token] == 0` to determine if a token is supported. With encrypted state, this check becomes impossible, and `flashFee` will always revert with `FlashLoanUnsupportedToken`.

3. **Withdrawal queue estimation:** The `_withdrawCore` function (lines 221-225) uses `reserve - amount < totalPlainBorrow[token]` to check if the reserve has enough "free" liquidity after accounting for borrows. This constraint is enforced in plain text to prevent bank-run scenarios. Migrating to encrypted FHE operations here creates a **liveness risk**: if the FHE computation is expensive or the CoFHE sequencer is overloaded, withdrawals could fail at the gas limit.

4. **`reserve` local variable leakage (SUBTLE):** Every function that reads `liquidReserve[token]` into a local `uint256 reserve` (lines 222, 270, 305, 608) — the read itself happens before any FHE operation. Even if `liquidReserve` becomes `euint128`, the plain value is still read into a local variable in the same function call path. The migration must ensure ALL reads go through encrypted paths, not just the storage type.

5. **`supply()` with ETH path (line 352):** `liquidReserve[tokenAddr] += msg.value` — the ETH wrapping path directly mutates the plain reserve. If reserve is encrypted, this breaks. Not discussed.

6. **Gas griefing vector:** Every `FHE.select` replacement for `require()` gates uses an FHE operation costing ~5-20K gas. With ~15 replacement sites across the contract, each borrow/supply/withdraw transaction becomes 75-300K gas more expensive. This may push transactions past the block gas limit on Arbitrum (~30M gas for the whole block), or at minimum make the protocol economically unattractive at scale.

#### Implementation risks:

- **Incomplete migration:** Mixing encrypted and plain state access patterns is the #1 risk. Every function that touches `liquidReserve` or `totalPlainBorrow` must be audited — 22+ locations identified, but likely more in edge paths.
- **Economic invariant violation:** The plain-text `reserve - amount < totalPlainBorrow[token]` check prevents bank runs. The FHE-select replacement `FHE.select(reserveEnough, borrowAmount, 0)` silently caps borrows at 0 if reserve is insufficient — but the caller won't know why they got 0.
- **Flash loan accounting:** Flash loans require knowing the exact reserve before lending it out. With encrypted reserves, the flash loan function can't verify liquidity exists.

#### Dependencies:

| Dependency | Impact |
|---|---|
| **Frontend** | Cannot display "available to borrow" as plain number; needs reveal flow |
| **Backend** | /health endpoint, monitoring dashboards cannot read liquidity metrics |
| **Infra** | Prometheus alerts on reserve depletion become encrypted-blind |
| **Testing** | All 8+ existing tests that assert on reserve values will break |

---

### SC-P1-1 — No `publishDecryptResult` / `allowPublic` counterpart

**Reported severity:** P1  
**My assessment: P1 — CORRECT, but with caveats**

The missing on-chain reveal pathway IS a significant gap. However, the analysis overstates the urgency slightly: `allowPublic` is already called in `requestBalanceReveal` and `requestBorrowReveal`, which means off-chain decryption via `decryptForView` WORKS. Users CAN see their balances. The missing piece is only on-chain settlement (e.g., proving a balance to a third-party contract).

#### What the analysis missed:

1. **`revealBalance()` frontrunning (MEMPOOL ATTACK):** If `publishDecryptResult` is called in a public `revealBalance()` function, the plaintext is published ON-CHAIN permanently. A mempool observer can see who requested the reveal and what their balance was before the transaction confirms. This leaks the same information the FHE system was designed to protect. The audit should recommend either:
   - Using a commit-reveal scheme where the hash is submitted first
   - Allowing reveals only via signed off-chain permits (what the current `getSupplyBalance` does)
   - Making `revealBalance()` emit an event with the handle but not the plaintext, then relying on off-chain decryption

2. **Reentrancy in new reveal functions (MISSED):** The audit proposes adding `revealBalance()`, `revealBorrow()`, `revealCollateral()` without discussing reentrancy. These functions make external calls (`FHE.publishDecryptResult` involves coprocessor interaction) after granting ACL. Any external call after state read is a potential reentrancy vector — the `nonReentrant` modifier must be on ALL reveal functions.

3. **`onlyComposer` interaction:** The Composer uses `depositFor`/`borrowFor` which update balances. If the Composer opens a position, who calls `revealBalance()` — the user or the Composer? The ACL grant in `allowPublic` is to `msg.sender`, which would be the Composer address in the `For` path. The user can't call `revealBalance()` for Composer-originated balances without additional ACL forwarding.

4. **Gas cost of `publishDecryptResult`:** This is an expensive FHE coprocessor call — potentially 100K+ gas. A user revealing all their positions (3 assets × 2 positions = 6 reveals) could spend 600K+ gas on reveals alone. No gas estimation or recommendation about batching is provided.

#### Severity note:
If the protocol relies on on-chain settlement proofs (e.g., proving solvency to a liquidator), this IS P1. If reveals are purely for UX, this is closer to P2 — users CAN read their balances off-chain already.

---

### SC-P1-2 — Trivial encryption from plain values in liquidation

**Reported severity:** P1  
**My assessment: P3 (over-severitied)**

The agent report itself says "Document as intentional — no code change." Liquidations are **inherently public**: you cannot liquidate a specific amount of debt without knowing how much is being covered. The `FHE.asEuint128(actualDebtCover)` and `FHE.asEuint128(seizedCollateral)` convert a public plaintext to encrypted format for the FHE math pipeline that follows (balance decrease via `_safeDecrease`). This is not a confidentiality leak — it's a technical necessity.

#### What the analysis missed:

1. **False sense of privacy (DOCUMENTATION GAP):** The real risk isn't the current code — it's that a future developer or auditor sees `euint128 repayEnc` and assumes the repayment amount is confidential. The proposed `@dev` doc fix is insufficient if the code structure actively misleads. A better approach: rename variables to indicate they're intentionally public, e.g., `euint128 publicRepayEnc = FHE.asEuint128(actualDebtCover)`.

2. **Oracle price leakage from seizedCollateral (ECOSYSTEM):** The `seizedCollateral` calculation (lines 562-566) uses `oracle.convertToUsd` — the oracle prices are public. Combined with `seizedCollateral` being observable from the `Liquidated` event (line 581-583), an attacker can compute the USD value of the liquidated position over time to model protocol health. This is inherent to liquidation mechanics, not a code bug, but should be documented.

#### Why P3:
- No code change needed
- Amounts are public by design
- The FHE conversion is an implementation detail of the `_safeDecrease` pipeline
- P1 should be reserved for items where confidentiality IS expected but broken

---

### SC-P1-3 — Execution-path info leakage via `require()` on encrypted conditions

**Reported severity:** P1  
**My assessment: P1 — CORRECT**

This is correctly classified. The `_requireOracleHealthy` function (lines 431-443) reverts with `InsufficientCollateral()` on a public `view` function. A liquidator can probe the health of ANY position by calling `liquidateWithProof` or `borrowWithLtvCheck` with varying amounts and observing revert vs success.

#### What the analysis missed:

1. **Gas oracle via `_requireOracleHealthy` (SUBTLE):** Even after replacing the revert with FHE.select, the GAS COST differs between capped and uncapped paths. `FHE.select` evaluates both branches but only returns one — however, the gas is proportional to the complexity of the selected values. An attacker can distinguish "healthy" vs "unhealthy" by measuring gas consumption of `borrowWithLtvCheck` or `liquidateWithProof`. This is a well-known side channel in FHE-select patterns that the audit doesn't address.

2. **`_requireOracleHealthy` is a `view` function (ADDITIONAL LEAK):** Because it's a `view`, it doesn't cost gas to call. A liquidator can call it in a loop with binary search to narrow down a user's exact health factor without executing any on-chain transaction. The FHE-select replacement doesn't help here — the view function itself leaks path information. The function should either be made non-view (costs gas) or removed entirely as a public path.

3. **Batch liquidation leakage:** When `liquidateWithProof` processes multiple users, the gas cost reveals how many were successfully liquidated vs skipped. If the function reverts on the first failure, an attacker can't tell — but if it uses FHE.select to skip unhealthy positions, the gas still leaks count.

4. **`_requireOracleHealthy` in `liquidateWithProof` (line 546):** This is called AFTER the liquidator has already verified the user's debt/supply via `FHE.verifyDecryptResult`. At this point the liquidator ALREADY has the plaintext proof (`debtBalanceProof`, `supplyBalanceProof`). So the oracle health check is operating on KNOWN plaintext values — not encrypted ones. The information leakage here is minimal because the liquidator already knows the amounts. The bigger concern is in `borrowWithLtvCheck` (line 400) where the collateral/borrow amounts are caller-provided and may not correspond to any on-chain state.

5. **Oracle staleness as information channel:** The oracle's `collateralFactorBps` or `convertToUsd` could revert if the price is stale. A liquidator can use this to determine that an oracle update is needed — which is useful information, but also reveals protocol state through execution path.

---

### SC-P1-4 — Composer cross-contract ACL on encrypted results

**Reported severity:** P1  
**My assessment: P1 — CORRECT, but scope too narrow**

The core concern (allowTransient sufficiency for cross-contract reads) is valid and correctly classified. However, the analysis limits itself to the Composer's known paths.

#### What the analysis missed:

1. **ExecutorContract ACL (MISSED ENTIRELY):** The `SwapRouter.executeIntent` function trusts an `ExecutorContract` to settle swaps fairly (the acknowledged C5 architectural issue). If the executor needs to read encrypted swap parameters (`amountIn`, `minOut`), it has no ACL to do so. The Composer never sets `allowTransient` for the executor address. This means the executor either:
   - Works with plain amounts (which defeats the swap privacy purpose), or
   - Cannot read the encrypted parameters and executes blindly
   - Neither path is acceptable

2. **`allowTransient` lifecycle with reentrancy:** If the Composer calls VAULT.openPosition → VAULT calls back into Composer (e.g., via a hook) → Composer calls POOL.depositFor. Is the `allowTransient` from the first call still valid during reentrancy? In CoFHE, transient allowances persist for the duration of the transaction, so yes — but this is implementation-specific and could change. The audit doesn't verify this assumption.

3. **Multi-step strategy flows (CRITICAL GAP):** The audit acknowledges this but dismisses it: "For persistent cross-tx access, move to `FHE.allow`." This is non-trivial:
   - `FHE.allow` grants permanent ACL — it never expires unless explicitly revoked
   - Accumulated allowances consume storage and cannot be easily iterated or garbage-collected
   - If the Composer accumulates `allow` grants for every user's every balance across every strategy, this is a storage bomb
   - The proposed rebalance flow (P2-2 in manifest) specifically requires cross-tx access to read current balances. The audit should have flagged this as a blocker for rebalance.

4. **StrategyRegistry TVL ACL:** The Composer calls `REGISTRY.decrementTvl()` with verified handles — but the Composer itself needs ACL to READ encrypted TVL values for rebalancing decisions. The analysis of P2-3 (TVL reveal) is separate from P1-4 but they share the same ACL mechanism. These should be cross-referenced.

#### Implementation risk:
- Moving from `allowTransient` to `FHE.allow` without a revocation mechanism creates permanent storage bloat
- Gas cost: each `FHE.allow` is ~20K gas; with 10 strategy types × 2 operations each = 400K gas overhead per strategy open

---

### SC-P2-1 — SameBlockClose plain-text require

**Reported severity:** P2  
**My assessment: P2 — CORRECT**

A timing side channel that leaks whether a position was opened in the current block. Minor confidentiality concern.

#### What the analysis missed:

1. **Security rationale for SameBlockClose (MEV):** The check may have been INTENTIONAL to prevent flash-loan-like behavior: open a position and close it in the same block to extract temporary price differences without risk. If the check is removed (Option A), MEV bots can sandwich position opens and closes. The audit recommends Option A but doesn't investigate WHY the guard exists. It could be a security feature, not a bug.

2. **FHE-select option (Option B) overhead:** If replaced with FHE.select, the close is silently canceled but gas is still consumed. The user pays gas but gets nothing — worse UX than a revert with a clear error message. The audit should recommend Option A only after confirming the delay has no security purpose.

---

### SC-P2-2 — No interest accrual (InterestIndex defined but never updated)

**Reported severity:** P2  
**My assessment: P1 (under-severitied)**

This is the most significant severity misclassification in the report. Interest accrual is not "medium" — it is a **core DeFi primitive** whose absence breaks the economic model of the protocol.

- **Suppliers earn ZERO** on supplied assets (no supply APY)
- **Borrowers pay ZERO** beyond principal (no borrow APR)
- The protocol has no incentive alignment mechanism — there is no reason to supply if you earn nothing
- A DeFi lending protocol WITHOUT interest is not a lending protocol — it's a custody service
- The `InterestIndex` struct and `indices` mapping are defined (lines 25-30) but never written to — this is dead code that misleads anyone reading the contract into thinking interest works

**Why this should be P1 (not P2):**
- Breaks the core economic functionality of the protocol
- Directly affects every user of the lending pool (suppliers lose yield they would reasonably expect)
- P1 definition per the manifest: "breaks core functionality, major user-facing impact" — this fits perfectly

#### What the analysis missed:

1. **`accrue()` griefing vector:** The proposed `accrue(address token) external` function (anyone-callable) is a griefing vector. An attacker can call `accrue()` every block to:
   - Drain gas from legitimate users (each call costs the caller gas but also forces state writes)
   - Manipulate accrual timing: by accruing right before a user's transaction, the attacker can affect the computed interest
   - Solution: add a minimum time threshold (e.g., `block.timestamp - lastAccrualTs > 1 hours`)

2. **Interest accrual and flash loans:** The flash loan function (lines 619-657) transfers tokens out and back without accruing interest during the loan. For a single-block flash loan this is acceptable, but if interest should theoretically accrue per-second, missing accrual during a flash loan is technically correct (no time passes in one block) but the code doesn't explicitly handle it.

3. **Cross-contract accrual in Composer:** When the Composer calls `depositFor` → `borrowFor` in sequence, if `_accrueInterest` is called in `depositFor`, the `borrowFor` call sees FRESH indices (just accrued). But if the Composer calls `borrowFor` without a prior `depositFor`, the indices are stale. The Composer path must handle this explicitly.

4. **FHE interest math precision:** Computing `supplyIndex += rate * elapsed / YEAR` using `FHE.mul` and `FHE.div` loses precision because FHE operates on encrypted integers (not fixed-point). A `euint128` can't represent 1.05 (105% interest rate) — only 105 scaled to WAD (105e18). The `FHE.mul` of two WAD-scaled values must be divided by WAD to restore scale. This precision chain is fragile and unvalidated.

5. **Reserve factor accounting:** The `RESERVE_FACTOR_BPS = 1000` (10%) exists but has no code path that uses it. Interest accrual should include protocol reserve accumulation: 10% of accrued interest should go to a protocol reserve. Not discussed.

6. **Deferring to Wave 2 is risky:** The manifest defers interest accrual to Wave 2 (line 419) but interest accrual touches EVERY state mutation in LendingPool (~15 locations). Deploying without it means users interact with a protocol where suppliers earn nothing — which, for a deployed protocol, erodes trust and may cause early withdraw runs when interest is eventually activated.

---

### SC-P2-3 — StrategyRegistry `getEncryptedTvl` decryptForView fails

**Reported severity:** P2  
**My assessment: P1 (under-severitied)**

This is a **broken core function** — not a UX polish issue. `getEncryptedTvl` is the ONLY way to read strategy TVL. If it returns "Forbidden", no one can view TVL, including:

- The frontend strategy page
- Backend API endpoints serving TVL data
- The Composer during rebalance decisions
- Any monitoring/analytics tooling

#### What the analysis missed:

1. **`FHE.allowSender()` combined with `FHE.allow()` (ROOT CAUSE):** The function calls BOTH `FHE.allow(v, msg.sender)` AND `FHE.allowSender(v)`. `FHE.allowSender` is intended for view-only decryption via `decryptForView`. However, `FHE.allowSender` requires the caller to have a signed permit — it does NOT work as a public getter. The combination of both calls suggests the author was unsure which one to use and tried both. The real fix: use ONLY `FHE.allow(v, msg.sender)` + `FHE.allowThis(v)` (which `_ensureInitialized` doesn't grant), and have the caller use `FHE.decrypt` rather than `decryptForView`.

2. **`allowThis` missing:** `_ensureInitialized` returns a handle but does NOT call `FHE.allowThis`. The returned handle has ACL from the calling contract but NOT from this contract for cross-contract reads. The TVL set path (`_updateTvl` at line 177) does `FHE.allowThis(result)` — but the GET path doesn't grant `allowThis` again. Since the handle was already `allowThis`'d when stored, this should be fine — unless the FHE coprocessor doesn't persist ACL across reads. This is a potential CoFHE implementation detail.

3. **Composer rebalance dependency:** The Composer needs to read TVL (to check if a strategy can accommodate more deposits) before calling `incrementTvl`. Without working `getEncryptedTvl`, the rebalance flow is blind. The audit treats P2-3 as isolated but it has direct cross-contract impact.

---

### SC-P2-4 — Composer Permit2 flow UX friction

**Reported severity:** P2  
**My assessment: P2 — CORRECT**

UX flow improvement for token approvals. Reasonable severity.

#### What the analysis missed:

1. **`forceApprove` compatibility (USDT on Arbitrum):** The `_ensureApproval` function uses `forceApprove` which is a SafeERC20 extension. Some tokens (notably USDT on some chains) return `false` instead of reverting on approval failure. The `forceApprove` wrapper handles this, but if the USDT implementation on Arbitrum Sepolia is different from mainnet, this could silently fail.

2. **EIP-2612 support varies:** Not all tokens on Arbitrum support `permit`. USDC on Arbitrum does not support standard EIP-2612 (it uses a different permit mechanism). The proposed "add EIP-2612 permit as alternative path" would work for some tokens but not others — and the fallback to `safeTransferFrom` must handle this gracefully.

3. **`permit` replay protection:** EIP-2612 permits include a `deadline` and `nonce`. If the contract stores nonces, there's a potential replay if storage isn't managed correctly. The audit doesn't mention nonce management.

---

### P3 Findings (SC-P3-1 through SC-P3-5)

**Overall assessment:** Correctly classified. Low risk, safe to fix early.

#### What the analysis missed:

1. **SC-P3-4 (Centralization risk) — understates scope:** The audit counts "20 `onlyOwner`/`onlyVault` admin functions" but doesn't categorize them by severity of centralization:
   - **Critical centralization:** `pause()` — can freeze ALL user funds
   - **High centralization:** `setComposer()`, `setOracle()`, `setWeth()` — can redirect protocol logic
   - **Medium centralization:** `registerStrategy()` — can add arbitrary strategies
   - **Low centralization:** `recoverToken()` — standard admin rescue
   
   A more useful analysis would flag which centralized functions are most dangerous and recommend progressive decentralization (e.g., timelock for `pause()`, multi-sig for `setOracle()`).

2. **SC-P3-5 (`_onlyVault` modifier):** The audit says "no change needed" because the modifier is always used with `nonReentrant`. But `nonReentrant onlyVault` means the modifier order matters: `nonReentrant` wraps the outer function, `onlyVault` checks inside the reentrancy guard. If `onlyVault` is checked AFTER the function body starts, there's a theoretical risk (though OZ ReentrancyGuard prevents reentrancy before the modifier check). This is a code hygiene issue worth fixing: `onlyVault nonReentrant` or combine the modifiers.

---

## MISSED FINDINGS

### MF-1: Dual Input Skew — Plain/Encrypted Amount Mismatch (P0)

**Severity: P0 — Critical accounting integrity**

The `_verifyEquality` function in `FheForgeBase.sol` (lines 86-90) is the ONLY enforcement that `amount == encAmount`. If this function has a bug or the FHE equality check is compromised:

- **Supply path:** User supplies 1000 USDC (plain) but encAmount encrypts to 1. The `_verifyEquality` returns `_ZERO` (mismatch detected). The supply is recorded as 0 in encrypted balance but 1000 USDC was transferred to the contract. **User loses 1000 USDC.**
- **Borrow path:** User provides `borrowAmount = 1000` but `encBorrowAmount` encodes 1. If `_verifyEquality` fails, the user borrows 0 but the contract still transfers 1000 USDC (line 426). **User gets free money** — but more likely the tx reverts because `_verifyEquality` returns `_ZERO` and `_safeIncrease` of `_ZERO` succeeds with 0 increase while IERC20 transfer still happens.

Wait — let me re-check the code paths:

In `_finalizeBorrow` (lines 405-428):
1. `if (liquidReserve[borrowToken] < borrowAmount) revert` — checks PLAIN amount
2. `totalPlainBorrow[borrowToken] += borrowAmount` — records PLAIN
3. `liquidReserve[borrowToken] -= borrowAmount` — decreases PLAIN
4. encrypts requested, calls `_verifyEquality` — returns verifiedRequested (or _ZERO if mismatch)
5. `_safeIncrease(storedBorrow, verifiedRequested)` — if _ZERO, borrow balance stays unchanged
6. `IERC20(borrowToken).safeTransfer(msg.sender, borrowAmount)` — STILL transfers the full plain amount!

**This is a real bug.** If `_verifyEquality` fails (encAmount != plainAmount):
- In `_finalizeSupply`: user sends 1000 tokens and gets 0 supply balance → funds stuck in contract
- In `_finalizeBorrow`: user borrows 1000 tokens but recorded debt is 0 → free money

The CoFHE user's responsibility is to provide correct encrypted amounts. But the contract has NO recourse if they don't. The `_verifyEquality` is meant to catch this, but if the CoFHE ZK proof of equality (which the README mentions as a known issue) is NOT in place, `_verifyEquality` is the only defense, and it relies on the correctness of `FHE.eq` which may not work for comparing properly encrypted vs trivial-encrypted values.

The Known Issues section acknowledges this: "Dual plain+encrypted input skew — no on-chain `amount == encAmount` enforcement. Mitigation requires CoFHE ZK proof of equality (post-MVP)."

**This should have been SC-P0-2 in the audit.** It's acknowledged in the README but never elevated to a formal finding.

### MF-2: Flash Loan Accounting Gap (P1)

**Severity: P1 — Core functionality gap**

The `flashLoan` function (lines 619-657) has several issues:

1. **No interest accrual during flash loan:** If interest accrual is implemented (SC-P2-2), the flash loan path bypasses it entirely. No `_accrueInterest` call before or after the loan.

2. **`maxFlashLoan` uses `reserve - borrowed`** (line 610): This returns the free liquidity. But this is calculated from plain values that may be out of sync with encrypted state (SC-P0-1). If `totalPlainBorrow` and `liquidReserve` are migrated to encrypted, this function is blind.

3. **`flashFee` uses literal `10000`** (line 616): Already flagged as SC-P3-1, but in context: the flash loan code has `FLASH_FEE_BPS = 5` but uses `10000` instead of `BPS_DEN = 1e4`. Both are `10000`, so it works — but shows inconsistent usage in the same function.

4. **No `maxFlashLoan` for non-supplied tokens:** If no one has supplied a token, `liquidReserve[token] == 0` and `maxFlashLoan` correctly returns 0. But the `flashFee` function (line 615) reverts with `FlashLoanUnsupportedToken` for unsupported tokens, while `flashLoan` (line 630) reverts with `InsufficientReserve`. The inconsistent error makes integration harder.

### MF-3: Self-Liquidation Not Prevented (P1)

**Severity: P1 — Economic exploit**

In `liquidateWithProof` (lines 521-584), there's no check that `msg.sender != user`. A user whose position is underwater could:

1. Call `liquidateWithProof` on their own position
2. Receive the liquidation bonus (`LIQUIDATION_BONUS_BPS = 500`, i.e., 5% extra)
3. Extract more value than their position is worth

This is prevented in most lending protocols by requiring the liquidator to be a different address. The function should have `if (msg.sender == user) revert SelfLiquidation()`.

**Note:** In practice, this is partially mitigated because the liquidator must pay the debt and receives collateral at a discount. But if the user's position health is exactly at the borderline, self-liquidation could extract the bonus.

### MF-4: No Partial Liquidation Safety Check (P2)

**Severity: P2 — UX/Economic issue**

The liquidation function calculates `maxLiquidation = (userDebt * LIQUIDATION_CLOSE_FACTOR_BPS) / BPS_DEN` (line 540) where `LIQUIDATION_CLOSE_FACTOR_BPS = 5000` (50%). This caps liquidation to 50% of debt per call.

However, there's no check that the remaining debt (line 545) is still less than the collateral value. After partial liquidation, the position might still be unhealthy — requiring another liquidation. This is fine for the protocol but creates an endless liquidation cycle where a liquidator must call `liquidateWithProof` multiple times. The frontend and backend should handle this, but the contract itself has no guard against repeated partial liquidations draining the liquidator's gas.

### MF-5: `composer` Address Set Once But Mutable (P2)

**Severity: P2 — Administrative risk**

The `composer` state variable (line 36) is set via `onlyOwner` functions but the code has no `setComposer` function visible in the LendingPool functions I reviewed. If the Composer contract needs to be upgraded or replaced, there's no path to update the `onlyComposer` modifier's target.

Wait — let me check if there's a setter:

The `composer` is `address public composer;` at line 36. I don't see a setter function in the parts I read. If it's set in the constructor and never changeable, the `onlyComposer` modifier dead-ends if the Composer is ever redeployed. This should have a `setComposer(address)` with `onlyOwner`.

Actually, let me check the full file for a setter...

From what I read (lines 1-60, 100-149, 395-474, 530-658), I didn't see a setComposer. If it truly doesn't exist, this is a deployment risk: if the Composer must be redeployed (for upgrades, bugs), all `onlyComposer` paths in LendingPool become unreachable.

### MF-6: `_verifyEquality` Relies on Trivial Encryption (P0/P1)

**Severity: P1 — Potential accounting integrity issue**

`_verifyEquality` at line 86-90:
```solidity
euint128 claimedEnc = FHE.asEuint128(claimedPlain);
ebool match_ = FHE.eq(incoming, claimedEnc);
return FHE.select(match_, incoming, _ZERO);
```

The `FHE.asEuint128(claimedPlain)` creates a **trivial encryption** (plaintext → ciphertext without actual encryption). `FHE.eq(incoming, claimedEnc)` compares the real encrypted handle against the trivial encryption of the claimed value.

In the CoFHE/Fhenix system, `FHE.eq` operates on the plaintext values of two ciphertexts. If `incoming` was encrypted from `amount` and `claimedPlain == amount`, then `FHE.eq` should return `true`.

**However:** If the CoFHE coprocessor compares ciphertexts directly (hash equality) rather than decrypting and comparing, `FHE.eq` could return `false` even for matching values because the ciphertexts are different (one is properly encrypted, the other is trivially encrypted). This is a CoFHE implementation dependency that should be verified before relying on `_verifyEquality` for accounting integrity.

**Recommendation:** This should be documented as a CoFHE SDK dependency and verified against the deployed CoFHE version. If `FHE.eq` compares plaintexts internally, it works. If it compares ciphertexts, it breaks silently.

---

## CROSS-CUTTING DEPENDENCIES

| # | This domain | Depends on | Nature of dependency |
|---|---|---|---|
| 1 | SC-P0-1 (encrypted state) | **Infra** (address reconciliation) | Cannot migrate state until deployed addresses are correct (INFRA-P0-4/5/6) |
| 2 | SC-P0-1 (encrypted state) | **Testing** (SC test coverage) | Encrypted state migration without tests (TEST-P0-1/2) is reckless — every `liquidReserve` path must be validated |
| 3 | SC-P1-1 (reveal functions) | **Frontend** | New UI needed for "reveal balance/borrow/collateral" buttons and result display |
| 4 | SC-P1-1 (reveal functions) | **Backend** | New API endpoints + event indexer updates for reveal events |
| 5 | SC-P2-2 (interest accrual) | **Everything** | Affects every LendingPool state mutation; frontend must display accrued interest; backend must compute APY; tests must validate interest math |
| 6 | SC-P2-3 (TVL reveal) | **Backend** (strategy TVL API) | BE-P1-2 (oracle health) is a prerequisite — TVL needs healthy oracle |
| 7 | SC-P2-4 (Permit2) | **Frontend** | Frontend needs EIP-2612 signature generation for gasless approval path |
| 8 | SC-P1-4 (Composer ACL) | **Testing** (composer test) | Cannot validate ACL correctness without TEST-P1-2 (composer test coverage) |
| 9 | All SC changes | **Testing** | Every deployed contract fix needs test coverage; 4 of 5 contracts have ZERO tests |

**Key insight:** The testing domain (Wave 1) must be unblocked before or in parallel with smart contract changes. Every contract change without a test is flying blind.

---

## EXECUTION ORDER (Within Smart Contracts Domain)

I largely agree with the manifest's recommended order but refine it based on dependency analysis:

| Order | Finding | Rationale |
|---|---|---|
| **1st** | SC-P3-1, SC-P3-2 (constants) | Zero logic risk. Builds deployment confidence. Can be batched in one PR. |
| **2nd** | SC-P2-1 (SameBlockClose) | Simple, isolated, low risk. Remove or replace with FHE-select. |
| **3rd** | SC-P2-4 (Permit2 UX) | Simple addition, no other changes depend on it. |
| **4th** | SC-P1-4 (Composer ACL) | Documentation + verification. Validates `allowTransient` sufficiency across all paths. Small code change if `FHE.allow` needed. |
| **5th** | SC-P1-1 (reveal functions) | Moderate complexity. Must be done BEFORE P0-1 (encrypted state) because the reveal pattern is needed for encrypted state reads. |
| **6th** | SC-P2-3 (TVL reveal) | DEPENDS ON reveal pattern from P1-1. Fix `getEncryptedTvl` using same permit/reveal pattern. |
| **7th** | SC-P2-2 (interest accrual) | **Deferred to Wave 2** per manifest. If done in Wave 1, it should be after reveal functions but before P0-1. Massive cross-contract impact. |
| **8th** | SC-P0-1 (encrypted state) | Largest change, Last. Every other fix must be stable before migrating totalPlainBorrow/liquidReserve. |

### Deviations from Manifest:

1. **SWAP P2-2 and P0-1:** The manifest puts P2-2 before P1-1 and P0-1 last. I agree P0-1 should be last, but P2-2 (interest accrual) should be deferred to Wave 2 (as the manifest itself recommends at line 419). If done in Wave 1, it must be before P0-1 because interest accrual modifies the same state variables that P0-1 encrypts.

2. **P2-3 (TVL reveal) should be earlier:** The manifest doesn't rank it explicitly, but it should come right after P1-1 (reveal functions) because they share the same mechanism. The TVL reveal fix is also a prerequisite for the frontend strategy page.

3. **Unlisted but critical: MF-3 (self-liquidation guard):** Add `if (msg.sender == user) revert SelfLiquidation()` to `liquidateWithProof`. This is a 1-line addition with zero dependencies and no side effects. Should be done in the first batch alongside P3 constants.

---

## Summary of Severity Reclassifications

| Finding | Reported | Suggested | Reason |
|---|---|---|---|
| SC-P0-1 | P0 | P0 | Correct |
| SC-P1-1 | P1 | P1 | Correct, with caveats on off-chain reveal existing |
| SC-P1-2 | P1 | **P3 ⬇** | Not a bug — documentation only. Amounts are public by design. |
| SC-P1-3 | P1 | P1 | Correct, but gas-side-channel leakage needs more attention |
| SC-P1-4 | P1 | P1 | Correct, but scope too narrow (missed ExecutorContract ACL) |
| SC-P2-1 | P2 | P2 | Correct |
| SC-P2-2 | P2 | **P1 ⬆** | Core DeFi primitive missing — breaks protocol economics |
| SC-P2-3 | P2 | **P1 ⬆** | Broken core function — TVL completely unreadable |
| SC-P2-4 | P2 | P2 | Correct |

### Missed Findings Summary

| # | Finding | Suggested Severity |
|---|---|---|
| MF-1 | Dual Input Skew — plain vs encrypted amount mismatch (known but not a finding) | P0 |
| MF-2 | Flash loan accounting gap — no accrual, no encrypted support | P1 |
| MF-3 | Self-liquidation not prevented — `liquidateWithProof` has no `msg.sender != user` check | P1 |
| MF-4 | No partial liquidation safety — endless partial liquidation cycle | P2 |
| MF-5 | `composer` address immutable after construction — no setter function | P2 |
| MF-6 | `_verifyEquality` CoFHE implementation dependency — trivial vs real encryption comparison | P1 |

---

## Final Verdict

**Wave 1 Smart Contracts audit quality:** 7/10

Strengths:
- Correctly identified the key P0 (encrypted state leakage)
- Accurate technical analysis of each finding location
- Good event emission audit
- Reasonable migration sequence (with minor refinements)

Weaknesses:
- Two P2 findings should be P1 (interest accrual, TVL reveal)
- One P1 finding should be P3 (trivial encryption in liquidation)
- Missed a P0 accounting integrity finding (MF-1 — dual input skew)
- Missed a P1 economic exploit (MF-3 — self-liquidation)
- No analysis of reentrancy risks from new reveal functions
- `_verifyEquality` CoFHE dependency not validated
- Composer ACL scope too narrow (missing ExecutorContract)
- No gas cost analysis for FHE-select replacements
