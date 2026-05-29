# Dual Input / Ciphertext Equality Audit — `_verifyEquality()`

**Protocol:** FheForge — Private Encrypted DeFi on Arbitrum Sepolia  
**Audit Date:** May 2026  
**Scope:** All `_verifyEquality()` call sites across LendingPool, FheForgeComposer, StrategyVault  
**Reference Doc:** `contracts/contracts/FheForgeBase.sol` (definition, lines 166–173)  
**Relevant Standards:** CoFHE SDK `FHE.eq`, `FHE.asEuint128`, `FHE.select`

---

## 1. Executive Summary

`_verifyEquality` is the **sole on-chain gate** preventing a mismatch between a caller-provided plaintext amount and its corresponding encrypted (`euint128`) value. It appears at **13 call sites across 3 contracts**. The function trivial-encrypts the claimed plaintext and uses `FHE.eq` to compare against the provided ciphertext, returning either the original ciphertext (match) or `_ZERO` (mismatch).

### The Fundamental Gap

`_verifyEquality` checks **internal consistency** between two caller-provided values — it does **not** cryptographically prove that the encrypted value matches the user's intent. A CoFHE ZK proof of equality (planned post-MVP) would provide this link. Without it, the following invariant holds:

> Any caller who can provide a pair `(plaintext, ciphertext)` that passes `FHE.eq` can operate the function. The ciphertext is what persists in state, so a mismatch can only affect the current transaction — but that transaction's token transfers execute independently of the equality result.

**Risk Classification Summary:**

| Category | Count | Description |
|---|---|---|
| **HIGH** | 9 | Direct user entry points + StrategyVault.closePosition: token transfer executes regardless of `_verifyEquality` result |
| **MEDIUM** | 4 | Composer-mediated paths: verification upstream, token flow decoupled from equality check |
| **LOW** | 0 | Pre-verified internal-only calls |

---

## 2. The `_verifyEquality` Function

**File:** `contracts/contracts/FheForgeBase.sol` — lines 166–173

```solidity
function _verifyEquality(euint128 incoming, uint256 claimedPlain) internal returns (euint128 result) {
    _validateCiphertext(incoming);                              // revert if uninitialized handle
    euint128 claimedEnc = FHE.asEuint128(claimedPlain);         // trivial-encrypt claimed value
    ebool match_ = FHE.eq(incoming, claimedEnc);                // FHE equality comparison
    result = FHE.select(match_, incoming, _ZERO);               // incoming on match, _ZERO on mismatch
    FHE.allowThis(result);
    return result;
}
```

### Mechanism

| Step | Operation | Security Property |
|---|---|---|
| 1 | `_validateCiphertext(handle)` | Reverts if `!FHE.isInitialized(handle)` — prevents null/dummy handle injection |
| 2 | `FHE.asEuint128(claimedPlain)` | Trivial-encrypts the plaintext (converts uint256 → euint128 without actual encryption) |
| 3 | `FHE.eq(incoming, claimedEnc)` | CoFHE ciphertext comparison — result is an `ebool` (encrypted boolean) |
| 4 | `FHE.select(match_, incoming, _ZERO)` | Selects `incoming` if equality holds, `_ZERO` otherwise — prevents uninitialized state writes |
| 5 | `FHE.allowThis(result)` | Grants the contract ACL to read the result for downstream operations |

### Critical CoFHE Dependency

`FHE.eq` on the CoFHE runtime compares the **plaintext values** of two ciphertexts by decrypting internally. Three scenarios exist:

- **Scenario A — Both properly encrypted, same value:** `FHE.eq` → `true` (expected, safe)
- **Scenario B — One trivial (`FHE.asEuint128`), one real, same value:** `FHE.eq` compares decrypted plaintexts → `true` (expected, this is the normal `_verifyEquality` path)
- **Scenario C — Implementation compares ciphertext hashes, not plaintexts:** `FHE.eq` → `false` even for same value (CoFHE version-dependent — must be verified against deployed coprocessor)

> **Known Issue (README, ADR-002):** If Scenario C is the CoFHE implementation behavior, every `_verifyEquality` call would silently fail, returning `_ZERO` for all operations. This has not been verified against the deployed CoFHE TaskManager on Arbitrum Sepolia.

### Return Value Behavior

| Condition | Return | Downstream effect |
|---|---|---|
| `FHE.eq` → `true` | `incoming` (original ciphertext) | Encrypted state mutated by `amount` |
| `FHE.eq` → `false` | `_ZERO` (encrypted zero) | Encrypted state unchanged (safe math adds/subtracts 0) |

**The critical observation:** The return value only affects **encrypted state mutations**. All **plaintext token transfers and plaintext accounting** execute before or independently of the equality check (see §4).

---

## 3. Complete Call Site Inventory

### 3.1 LendingPool — 6 call sites (all HIGH)

| # | Line | Function | Call | Plaintext Source | Encrypted Source |
|---|---|---|---|---|---|
| 1 | 87 | `shield()` | `_verifyEquality(incoming, amount)` | `amount` (calldata param) | `encAmount` (calldata) |
| 2 | 110 | `borrowWithLtvCheck()` | `_verifyEquality(requested, borrowAmount)` | `borrowAmount` (calldata param) | `encBorrowAmount` (calldata) |
| 3 | 143 | `repayDebt()` | `_verifyEquality(incoming, amount)` | `amount` (calldata param) | `encAmount` (calldata) |
| 4 | 175 | `_withdrawCore()` | `_verifyEquality(incoming, amount)` | `amount` (calldata param) | `encAmount` (calldata) |
| 5 | 292 | `shieldEth()` | `_verifyEquality(incoming, msg.value)` | `msg.value` (intrinsic) | `encAmount` (calldata) |
| 6 | 334 | `borrowWithOracle()` | `_verifyEquality(requested, borrowAmount)` | `borrowAmount` (calldata param) | `encBorrowAmount` (calldata) |

**Note on #5 (`shieldEth`):** Uses `msg.value` as the plaintext reference. This is **intrinsically trustworthy** — `msg.value` is set by the Ethereum protocol, not by calldata. However, the encrypted `encAmount` is still caller-provided, so a mismatch means the encrypted state records zero while `msg.value` ETH was deposited. This is the same risk pattern as #1.

### 3.2 FheForgeComposer — 6 call sites (all MEDIUM)

| # | Line | Function | Call | Plaintext Source | Encrypted Source |
|---|---|---|---|---|---|
| 7 | 106 | `_openVaultPosition()` | `_verifyEquality(incomingColl, p.collateralAmount)` | `p.collateralAmount` (struct) | `e.collateral` (calldata) |
| 8 | 126 | `_depositToPool()` | `_verifyEquality(incomingSupply, supplyAmount)` | `supplyAmount` (local var) | `e.supplyEnc` (calldata) |
| 9 | 137 | `_borrowFromPool()` | `_verifyEquality(incomingBorrow, p.poolBorrowAmount)` | `p.poolBorrowAmount` (struct) | `e.borrowEnc` (calldata) |
| 10 | 205 | `rebalance()` | `_verifyEquality(addCollEnc, p.addCollateralAmount)` | `p.addCollateralAmount` (struct) | `e.addCollateralEnc` (calldata) |
| 11 | 219 | `rebalance()` | `_verifyEquality(repayEnc, p.repayAmount)` | `p.repayAmount` (struct) | `e.repayEnc` (calldata) |
| 12 | 226 | `rebalance()` | `_verifyEquality(newBorrowEnc, p.newBorrowAmount)` | `p.newBorrowAmount` (struct) | `e.newBorrowEnc` (calldata) |

**Note:** These are classified MEDIUM (not HIGH) because the Composer mediates the calls via `onlyComposer`-gated functions (`depositFor`, `borrowFor`, `repayFor`) in LendingPool. The Composer performs `_verifyEquality` before handing verified handles downstream. However, the end user is still the ultimate source of both plaintext and encrypted values — the Composer adds orchestration but does not authenticate the link between them.

### 3.3 StrategyVault — 1 call site (HIGH)

| # | Line | Function | Call | Plaintext Source | Encrypted Source |
|---|---|---|---|---|---|
| 13 | 177 | `closePosition()` | `_verifyEquality(encClosed, collateralAmount)` | `collateralAmount` (calldata param) | `encCollateralAmount` (calldata) |

**Note:** This is classified HIGH because `closePosition()` is a public (owner-only) function that transfers tokens via `safeTransfer` (line 189) *after* the equality check. If `_verifyEquality` returns `_ZERO`, the position's encrypted collateral remains unchanged (for partial close) but the plaintext token transfer still executes.

---

## 4. Failure Mode Analysis

For each category, the following table describes what happens when `_verifyEquality` **fails** (returns `_ZERO` due to `FHE.eq` returning `false`).

### 4.1 LendingPool — Direct Token Transfer Paths

| Call Site | Token Movement | Plaintext Accounting | Encrypted State | Result on Failure |
|---|---|---|---|---|
| `shield()` (L87) | `safeTransferFrom` BEFORE equality check | `liquidReserve` increased BEFORE check | `supplyBalance` → unchanged (adds 0) | **User loses tokens** — transferred in but supply credited as 0 |
| `borrowWithLtvCheck()` (L110) | `safeTransfer` AFTER equality check | `totalPlainBorrow`/`liquidReserve` changed AFTER check | `borrowBalance` → unchanged (adds 0) | **Free money** — tokens sent, debt recorded as 0 |
| `repayDebt()` (L143) | `safeTransferFrom` BEFORE equality check | `totalPlainBorrow`/`liquidReserve` changed BEFORE check | `borrowBalance` → unchanged (subtracts 0) | **User overpays** — tokens taken, debt not reduced |
| `_withdrawCore()` (L175) | `safeTransfer` AFTER equality check | `liquidReserve` decreased BEFORE check | `supplyBalance` → unchanged (subtracts 0) | **Protocol loses liquidity** — tokens withdrawn, supply not reduced |
| `shieldEth()` (L292) | `weth.deposit` AFTER equality check | `liquidReserve` increased BEFORE check | `supplyBalance` → unchanged (adds 0) | **User loses ETH** — deposited but supply credited as 0 |
| `borrowWithOracle()` (L334) | `safeTransfer` AFTER equality check | `totalPlainBorrow`/`liquidReserve` changed AFTER check | `borrowBalance` → unchanged (adds 0) | **Free money** — tokens sent, debt recorded as 0 |

### 4.2 FheForgeComposer — Mediated Paths

| Call Site | Token Movement | Downstream Effect on Failure |
|---|---|---|
| `_openVaultPosition()` (L106) | Tokens transferred to Composer before this call; Composer calls `VAULT.openPosition` with `verifiedColl` | Position opened with 0 encrypted collateral; tokens already taken from user |
| `_depositToPool()` (L126) | Tokens approved to POOL; `POOL.depositFor` called with `verifiedSupply` | Supply credited as 0; tokens already transferred to POOL |
| `_borrowFromPool()` (L137) | `POOL.borrowFor` called with `verifiedBorrow` | Debt recorded as 0; tokens still transferred via `borrowFor` which calls `safeTransfer` |
| `rebalance()` addColl (L205) | Tokens transferred to Composer; `VAULT.addCollateral` called with `verifiedAddColl` | Collateral unchanged; tokens already taken |
| `rebalance()` repay (L219) | Tokens transferred to Composer; `POOL.repayFor` called with `verifiedRepay` | Debt not reduced; tokens already taken |
| `rebalance()` borrow (L226) | `POOL.borrowFor` called with `verifiedNewBorrow` | Debt recorded as 0; tokens still transferred via `borrowFor` |

### 4.3 StrategyVault

| Call Site | Token Movement | Plaintext Accounting | Encrypted State | Result on Failure |
|---|---|---|---|---|
| `closePosition()` (L177) full close | `safeTransfer` AFTER equality check | Position `delete`d BEFORE check | TVL decremented by 0 | **TVL inflation** — position deleted, collateral withdrawn, TVL unchanged |
| `closePosition()` (L177) partial close | `safeTransfer` AFTER equality check | `positionDepositedAmount` decreased BEFORE check | Collateral unchanged; TVL decremented by 0 | **Double-withdrawal vector** — collateral unchanged, tokens withdrawn, can repeat |

### 4.4 Summary of Financial Impact

| Failure Impact | Value at Risk | Affected Sites |
|---|---|---|
| User loss (tokens taken, state not updated) | Full `amount` | shield, shieldEth, repayDebt, all Composer user→protocol flows |
| Protocol loss (tokens sent, debt not recorded) | Full `amount` | borrowWithLtvCheck, borrowWithOracle, _withdrawCore, _borrowFromPool, rebalance borrow |
| TVL inflation / double-withdrawal | Up to full position size | closePosition (partial close path) |

---

## 5. Risk Categorization Detail

### 5.1 HIGH — 9 Sites

**Criteria:** Direct user entry point where plaintext token/value transfer executes independently of `_verifyEquality` result. A failure inequitably affects the protocol or user.

| # | Contract | Function | Specific Risk |
|---|---|---|---|
| 1 | LendingPool | `shield()` | Tokens transferred before equality check; supply not credited on failure |
| 2 | LendingPool | `borrowWithLtvCheck()` | Tokens transferred regardless; debt not recorded on failure |
| 3 | LendingPool | `repayDebt()` | Tokens transferred before equality check; debt not reduced on failure |
| 4 | LendingPool | `_withdrawCore()` (→ `partialUnshield`) | Tokens transferred; supply not reduced on failure |
| 5 | LendingPool | `shieldEth()` | ETH deposited; supply not credited on failure |
| 6 | LendingPool | `borrowWithOracle()` | Tokens transferred; debt not recorded on failure |
| 13 | StrategyVault | `closePosition()` | Tokens transferred; collateral unchanged on partial close; TVL inflated on full close |

### 5.2 MEDIUM — 4 Sites

**Criteria:** Composer-mediated call. User provides both values through a struct but the Composer acts as an intermediary. Token flow is decoupled from equality check.

| # | Contract | Function | Specific Risk |
|---|---|---|---|
| 10 | FheForgeComposer | `rebalance()` — addCollateral | Tokens taken, vault collateral unchanged |
| 11 | FheForgeComposer | `rebalance()` — repay | Tokens taken, debt unchanged |
| 8 | FheForgeComposer | `_depositToPool()` | Tokens taken, supply unchanged |
| 9 | FheForgeComposer | `_borrowFromPool()` | Tokens sent, debt unchanged |

### 5.3 LOW — 0 Sites

**Criteria:** Internal calls where both values are computed on-chain (no user-provided dual input), or where the equality check results in a clean revert (no token transfer).

No sites meet LOW criteria. All 13 sites receive dual input from an external caller.

---

## 6. Code Flow Details

### 6.1 LendingPool.shield (lines 77–91)

```
safeTransferFrom(user → contract, amount)       ← Token moves BEFORE verify
liquidReserve[token] += amount                   ← Plaintext state updated
incoming = FHE.asEuint128(encAmount)             ← Decrypt incoming handle
verifiedIncoming = _verifyEquality(incoming, amount)  ← Equality gate
supplyBalances[token][user] += verifiedIncoming  ← Encrypted state (0 if fail)
```

### 6.2 LendingPool.borrowWithLtvCheck (lines 93–130)

```
incoming = FHE.asEuint128(encBorrowAmount)
verifiedBorrow = _verifyEquality(incoming, borrowAmount)   ← Equality gate
newBorrow = borrowBal + verifiedBorrow                      ← 0 if fail
[LTV check on newBorrow]
actual = FHE.select(isHealthy, verifiedBorrow, _ZERO)       ← Dual gate
borrowBalances += actual                                     ← Encrypted state (0 if fail)
liquidReserve -= borrowAmount                               ← Plaintext state changes
IERC20(borrowToken).safeTransfer(user, borrowAmount)        ← Token moves AFTER verify
```

### 6.3 LendingPool.repayDebt (lines 132–151)

```
safeTransferFrom(user → contract, amount)       ← Token moves BEFORE verify
totalPlainBorrow[token] -= amount                ← Plaintext state updated
liquidReserve[token] += amount                    ← Plaintext state updated
incoming = FHE.asEuint128(encAmount)
verifiedIncoming = _verifyEquality(incoming, amount)
borrowBalances[token][user] -= verifiedIncoming  ← Encrypted state (0 if fail)
```

### 6.4 LendingPool._withdrawCore (lines 164–182)

```
liquidReserve[token] -= amount                   ← Plaintext state updated BEFORE verify
incoming = FHE.asEuint128(encAmount)
verifiedIncoming = _verifyEquality(incoming, amount)
supplyBalances[token][user] -= verifiedIncoming  ← Encrypted state (0 if fail)
safeTransfer(contract → user, amount)            ← Token moves AFTER verify
```

### 6.5 LendingPool.borrowWithOracle (lines 315–345)

```
[_requireOracleHealthy runs in plaintext — no encrypted state read]
liquidReserve -= borrowAmount                    ← Plaintext state updated
totalPlainBorrow += borrowAmount                  ← Plaintext state updated
requested = FHE.asEuint128(encBorrowAmount)
verifiedRequested = _verifyEquality(requested, borrowAmount)
borrowBalances += verifiedRequested               ← Encrypted state (0 if fail)
IERC20(borrowToken).safeTransfer(user, borrowAmount)  ← Token moves AFTER verify
```

### 6.6 FheForgeComposer flows (lines 98–140, 188–232)

All follow the same pattern:
```
incoming = FHE.asEuint128(e.field)
verified = _verifyEquality(incoming, p.field)
FHE.allowTransient(verified, address(CONTRACT))
CONTRACT.method(plainAmount, verified, ...)
```

The downstream contracts (`depositFor`, `borrowFor`, `repayFor`) trust the verified handle — they do **not** re-call `_verifyEquality`.

### 6.7 StrategyVault.closePosition (lines 146–192)

```
positionDepositedAmount[positionId] = remaining   ← Plaintext state updated
if (fullClose) _deletePosition(beneficiary, positionId)   ← Position deleted
if (strategyId != 0):
    verifiedClosed = _verifyEquality(encCollateralAmount, collateralAmount)
    DECREMENT_TVL(strategyId, verifiedClosed)      ← TVL decrement (0 if fail)
    if (!fullClose):
        pos.collateral -= verifiedClosed           ← Encrypted state (0 if fail)
IERC20(token).safeTransfer(owner, collateralAmount)  ← Token moves AFTER verify
```

---

## 7. Cross-References with Existing Documentation

| Document | Reference | Relevance |
|---|---|---|
| `security-review.md` (§2.8, §4.4, R1) | Documents `_verifyEquality` as a MEDIUM finding; recommends CoFHE ZK proof of equality (R1 HIGH) | Foundational risk description |
| `README.md` (Known Issues — MED) | "Dual plain+encrypted input skew — no on-chain amount == encAmount enforcement" | Acknowledges the gap publicly |
| `WAVE2_REVIEW.md` (MF-1) | Elevates dual input skew to P0 finding; notes it was "known but never a formal finding" | Concurs with HIGH/MEDIUM classification |
| `agent-critique-1-smart-contracts.md` (MF-1, MF-6) | Detailed failure analysis; identifies CoFHE `FHE.eq` implementation dependency (MF-6) | Cross-validates both the gap and the CoFHE dependency |
| `CONTRACT_INVESTIGATION_REPORT.md` | Identifies accounting gap in shield/borrow where token transfer is decoupled from `_verifyEquality` | Supports the failure mode analysis in §4 |
| `ADR-002-cofhe-fhe-integration.md` (§3.1.1) | Documents `_verifyEquality` design rationale; notes the limitation | Design context for the function |
| `MICROCHANGE_PLAN_WAVE3.md` (MC-035) | Tracks CoFHE ZK proof of equality implementation | Planned mitigation status |

---

## 8. Recommendations

### 8.1 HIGH Priority

**R1 — Gate token transfers on equality verification result (short-term mitigation)**

For all HIGH sites (especially LendingPool's `shield`, `borrowWithLtvCheck`, `repayDebt`, `partialUnshield`, `borrowWithOracle` and StrategyVault's `closePosition`): move the token transfer to occur **after** and **conditional on** the `_verifyEquality` result. Currently, token flows precede or ignore the equality check.

*Example for `shield()`:*
```
// Current (vulnerable):
safeTransferFrom(...);
liquidReserve += amount;
verifiedIncoming = _verifyEquality(incoming, amount);  // too late
supplyBalances += verifiedIncoming;

// Proposed:
verifiedIncoming = _verifyEquality(incoming, amount);
// Only proceed with transfer if verifiedIncoming is initialized:
if (!FHE.isInitialized(verifiedIncoming) || FHE.eq(verifiedIncoming, _ZERO)) revert();
safeTransferFrom(...);
liquidReserve += amount;
supplyBalances += verifiedIncoming;
```

*Affects: All HIGH sites (#1–6, #13)*

**R2 — Verify `FHE.eq` behavior against deployed CoFHE coprocessor**

Test that `FHE.eq(ciphertext, FHE.asEuint128(plaintext))` returns `true` when both represent the same numeric value on the Arbitrum Sepolia CoFHE TaskManager. If `FHE.eq` compares ciphertext hashes rather than plaintexts, this is a critical failure.

*Affects: All 13 sites (single upstream dependency verification)*

**R3 — Implement CoFHE ZK proof of equality (long-term fix)**

Replace the caller-provided-plaintext equality check with a cryptographic proof that the encrypted amount matches the user's intent. This is the planned post-MVP mitigation (tracked as MC-035 in `MICROCHANGE_PLAN_WAVE3.md`).

*Affects: All 13 sites*

### 8.2 MEDIUM Priority

**R4 — Reorder operations in LendingPool public functions to CEI (Checks-Effects-Interactions) pattern**

Several functions (`shield`, `repayDebt`) perform token transfers before encrypted state updates. While this is mitigated by `nonReentrant`, reordering to verify equality before transferring tokens would reduce the blast radius of a `_verifyEquality` failure.

*Affects: LendingPool.shield, LendingPool.repayDebt*

**R5 — Add plaintext/encrypted consistency check to StrategyVault.closePosition**

The `closePosition` partial-close path permits a double-withdrawal pattern: providing an `encCollateralAmount` that doesn't match `collateralAmount` causes the encrypted collateral to remain unchanged while tokens are withdrawn. Add a check that the verified result is non-zero before executing the transfer.

*Affects: StrategyVault.closePosition (#13)*

### 8.3 LOW Priority

**R6 — Document the Composer's trust model in FheForgeComposer natspec**

The Composer's `openPosition` and `rebalance` functions accept user-provided dual inputs but only verify equality before forwarding. Add explicit natspec: "Caller-provided `InEuint128` values are verified via `_verifyEquality` against the corresponding plaintext params. A CoFHE ZK proof of equality is not yet enforced."

*Affects: FheForgeComposer.openPosition, FheForgeComposer.rebalance*

**R7 — Add `_verifyEquality` call site map to contract natspec blocks**

For each function that calls `_verifyEquality`, add a `@dev` annotation documenting which parameter pairs are compared and the failure mode (return of `_ZERO`).

*Affects: All 13 sites*

---

## 9. Attack Scenarios

### Scenario A: Ciphertext Mismatch on `borrowWithLtvCheck`

1. Attacker constructs `borrowAmount = 1000 USDC`, but `encBorrowAmount` encrypts `0`
2. `_verifyEquality` compares:
   - `incoming = FHE.asEuint128(encBorrowAmount)` → decrypts to `0` (trivial encryption of `0`)
     Wait — `FHE.asEuint128(encBorrowAmount)` is the CoFHE SDK function that imports an InEuint128. If the attacker submitted a malicious ciphertext that decrypts to 0 but they claim it's 1000...
   
   Actually, `FHE.asEuint128(encAmount)` with an InEuint128 depends on how the CoFHE SDK handles the import. The attacker would need to provide an `InEuint128` that, when imported, creates a ciphertext with plaintext value `0`, while claiming `borrowAmount = 1000`. Then:
   - `FHE.asEuint128(encBorrowAmount)` → euint128 decrypting to 0
   - `_verifyEquality(euint128(0), 1000)`:
     - `claimedEnc = FHE.asEuint128(1000)` → trivial encrypt of 1000
     - `FHE.eq(euint128(0), euint128(1000))` → false
     - Returns `_ZERO`
   - `borrowBalances` unchanged
   - BUT: `IERC20(borrowToken).safeTransfer(msg.sender, 1000)` still executes
   - Attacker gets 1000 USDC with 0 debt recorded

### Scenario B: Ciphertext Mismatch on `withdrawCore`

1. Attacker has `supplyBalances[USDC][attacker] = 1000` (legitimately deposited)
2. Attacker calls `partialUnshield(USDC, 500, encAmount)` where `encAmount` encrypts to `0`
3. `_verifyEquality(euint128(0), 500)` → false → returns `_ZERO`
4. `supplyBalances[USDC][attacker]` unchanged (still 1000)
5. `liquidReserve[USDC]` decreased by 500
6. `safeTransfer(attacker, 500)` executes
7. Attacker now has 500 USDC + supply recorded as 1000
8. Attacker can repeat the attack to drain the reserve while supply never decreases

### Scenario C: Double-Withdrawal on `closePosition` (Partial Close)

1. Position has `depositedAmount = 1000`, `collateral = 1000`
2. Attacker calls `closePosition(id, 500, encZero)` where `encZero` is a ciphertext for 0
3. `_verifyEquality(encZero, 500)` → false → returns `_ZERO`
4. `remaining = 1000 - 500 = 500` (plaintext updated)
5. `decrementTvl(strategyId, _ZERO)` → TVL unchanged
6. `pos.collateral = _safeDecrease(1000, _ZERO, user)` → collateral unchanged (still 1000)
7. `safeTransfer(owner, 500)` → token transfer executes
8. Position now shows `depositedAmount = 500`, `collateral = 1000` (collateral > deposited!)
9. Attacker calls `closePosition(id, 500, properEnc)` → legitimate close
10. Total withdrawn: 1000 across two calls. Encrypted collateral was only decremented once.

---

## 10. Summary Table

| # | Contract | Function | Category | Failure Impact | Token Transfer Timing |
|---|---|---|---|---|---|
| 1 | LendingPool | `shield()` | HIGH | User loses tokens | Before equality check |
| 2 | LendingPool | `borrowWithLtvCheck()` | HIGH | Free money (protocol loss) | After equality check (unconditional) |
| 3 | LendingPool | `repayDebt()` | HIGH | User overpays | Before equality check |
| 4 | LendingPool | `_withdrawCore()` | HIGH | Protocol loses liquidity | After equality check (unconditional) |
| 5 | LendingPool | `shieldEth()` | HIGH | User loses ETH | After equality check (unconditional) |
| 6 | LendingPool | `borrowWithOracle()` | HIGH | Free money (protocol loss) | After equality check (unconditional) |
| 7 | FheForgeComposer | `_openVaultPosition()` | MED | User loses collateral | Vault deposit after verify |
| 8 | FheForgeComposer | `_depositToPool()` | MED | User loses supply credit | Pool deposit after verify |
| 9 | FheForgeComposer | `_borrowFromPool()` | MED | Free money (protocol loss) | Pool borrow after verify |
| 10 | FheForgeComposer | `rebalance()` (addColl) | MED | User loses addColl amount | Vault call after verify |
| 11 | FheForgeComposer | `rebalance()` (repay) | MED | User overpays | Pool call after verify |
| 12 | FheForgeComposer | `rebalance()` (borrow) | MED | Free money (protocol loss) | Pool call after verify |
| 13 | StrategyVault | `closePosition()` | HIGH | TVL inflation / double-withdrawal | After equality check (unconditional) |

---

*Audit compiled from source code analysis of `contracts/contracts/LendingPool.sol`, `contracts/contracts/FheForgeComposer.sol`, `contracts/contracts/StrategyVault.sol`, and `contracts/contracts/FheForgeBase.sol`. Cross-references to documentation in `docs/security/`, `docs/WAVE2_REVIEW.md`, `docs/research/`, and `README.md`.*

*No Solidity source files were modified during this audit.*
