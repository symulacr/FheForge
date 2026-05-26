# FHE Cryptography & Privacy Deep Audit — Issues Missed

Systematic deep-dive into FHE encrypted types, operations, cryptography, and privacy.
Source: actual FHE.sol source (3834 lines), CoFHE official docs, contract source review.

---

## CRITICAL FINDINGS (MISSED IN PREVIOUS AUDIT)

### P-CRIT-1: `FHE.sub` WRAPS ON UNDERFLOW — NOT REVERT, NOT SATURATE

**CoFHE docs explicitly state (encrypted-operations.md):**

> "arithmetic on euint types is unchecked, i.e. there is wrap-around on overflow"

**FHE.sol source confirms** — `FHE.sub(euint128 lhs, euint128 rhs)` does NOT check for underflow. It sends the raw handles to the coprocessor with `FunctionId.sub`. The TFHE coprocessor performs modular subtraction in Z/2^128Z.

**Impact on FheForge:**

Every place that uses `FHE.sub(a, FHE.min(b, a))` as a "safe subtract" pattern is **WRONG**.

The intent is: `a - min(b, a)` should never underflow because `min(b,a) <= a`.
But `FHE.min` returns an **encrypted** result. The contract CANNOT verify that `min(b,a) <= a` — it's encrypted!

```solidity
// LendingPool._finalizeRepay (line ~180):
euint128 newBalance = FHE.sub(currentBalance, FHE.min(incoming, currentBalance));

// LendingPool._withdrawCore (line ~215):
euint128 newBalance = FHE.sub(currentBalance, FHE.min(incoming, currentBalance));

// LendingPool.liquidateWithProof (line 514):
euint128 newDebt = FHE.sub(incomingDebt, FHE.min(repayEnc128, incomingDebt));

// StrategyVault.closePosition (line ~195):
euint128 newCollateral = FHE.sub(currentCollateral, FHE.min(encClosed, currentCollateral));
```

**The problem:** `FHE.min(incoming, currentBalance)` is an **encrypted computation** performed by the coprocessor. The contract has NO way to know if the result actually equals `incoming` or `currentBalance`. The coprocessor returns the correct result, but:

1. If `incoming > currentBalance`, `FHE.min` returns `currentBalance` — correct.
2. `FHE.sub(currentBalance, currentBalance)` = encrypted zero — correct.
3. But if the encrypted handles get corrupted, manipulated, or if there's a coprocessor bug, `FHE.min` could return a value GREATER than `currentBalance`, causing `FHE.sub` to wrap around to a huge number.

**More critically:** Even in normal operation, `FHE.min(a, b)` is computed as `FHE.select(FHE.lte(a, b), a, b)` internally by the coprocessor. This is correct. BUT the contract cannot enforce that the result of `min` was actually <= the subtrahend. It's trusting the coprocessor completely — which is the FHE model, but:

**FHESafeMath exists specifically to detect this.** The FHERC20 reference implements `tryDecrease` which returns `(euint128, ebool)` where the ebool indicates whether overflow/underflow occurred. FheForge has ZERO such checks.

**SEVERITY: CRITICAL** — Underflow wraps to 2^128 - delta, creating massive phantom balances. No detection mechanism exists.

**FIX:** Port FHESafeMath from FHERC20 reference. Use `tryDecrease` pattern:
```solidity
(euint128 newBal, ebool noUnderflow) = FHESafeMath.tryDecrease(currentBalance, incoming);
// If underflow, newBal = wrapped value, but noUnderflow = encrypted false
// Use FHE.select to force zero on underflow:
newBal = FHE.select(noUnderflow, newBal, _ZERO);
```

---

### P-CRIT-2: `FHE.asEuint128(uint256)` CREATES TRIVIALLY ENCRYPTED VALUES — NOT PRIVATE

**CoFHE docs (trivial-encryption.md):**

> "Trivially encrypted values are not confidential — they are merely a tool to enable interaction between encrypted and non-encrypted types. The original plaintext value remains visible to anyone observing the blockchain."

**FHE.sol source confirms** — `FHE.asEuint128(uint256)` calls `Impl.trivialEncrypt` which creates a ciphertext where the plaintext is embedded in the calldata. Anyone watching the chain can extract the plain value.

**Impact on FheForge — LIQUIDATION PATH:**

```solidity
// LendingPool.liquidateWithProof (line 512-514):
euint128 incomingDebt = FHE.asEuint128(debtBalanceProof);      // TRIVIAL — plain leaked!
euint128 repayEnc128 = FHE.asEuint128(uint256(actualDebtCover)); // TRIVIAL — plain leaked!
euint128 newDebt = FHE.sub(incomingDebt, FHE.min(repayEnc128, incomingDebt));
```

The liquidator already knows `debtBalanceProof` (they decrypted it), and `actualDebtCover` is plain in the tx. So `FHE.asEuint128` here is fine — these values ARE already public knowledge.

**BUT — the resulting `newDebt` is computed from two trivial inputs → the result is also trivially encrypted.** An observer can compute `newDebt = debtBalanceProof - actualDebtCover` without any decryption. This means:

- The user's remaining debt after liquidation is **publicly computable** from tx calldata
- Privacy of the remaining debt balance is **completely broken**

Same issue in collateral path:
```solidity
euint128 incomingColl = FHE.asEuint128(supplyBalanceProof);    // TRIVIAL
euint128 seizeEnc128 = FHE.asEuint128(seizedCollateral);       // TRIVIAL
euint128 newCollateral = FHE.sub(incomingColl, FHE.min(seizeEnc128, incomingColl));
```

Remaining collateral is also publicly computable.

**SEVERITY: CRITICAL** — Liquidation path completely breaks privacy of remaining balances. Any observer can compute exact remaining debt and collateral from tx calldata.

**FIX:** Instead of `FHE.asEuint128(plainValue)` for the subtrahend, operate directly on the encrypted storage handle:
```solidity
// Instead of converting plain to trivial and subtracting:
// euint128 repayEnc = FHE.asEuint128(actualDebtCover);  // TRIVIAL — BAD
// newDebt = FHE.sub(incomingDebt, FHE.min(repayEnc, incomingDebt));

// Subtract directly from stored encrypted balance:
euint128 repayEnc = FHE.asEuint128(actualDebtCover);
euint128 newDebt = FHE.sub(borrowBalances[debtToken][user], FHE.min(repayEnc, borrowBalances[debtToken][user]));
```
Wait — this still uses `FHE.asEuint128(plainValue)` for repayEnc. The fundamental issue is that liquidation MUST involve a known plain amount (the debt covered), so some trivial encryption is unavoidable. The correct approach:
1. Use the existing encrypted storage handle for the minuend (NOT the proof re-encrypted as trivial)
2. Accept that the subtrahend is trivial (it's public by design in liquidation)
3. The result is then `(encrypted - trivial)` — still partially private because the minuend is non-trivial

**Better fix:** Don't re-encrypt the proof back into a handle. Use the actual stored encrypted handle:
```solidity
euint128 repayEnc = FHE.asEuint128(actualDebtCover);  // trivial, but this is the KNOWN amount
euint128 storedDebt = borrowBalances[debtToken][user]; // real encrypted handle
FHE.allowThis(storedDebt); // ensure we can read it
euint128 newDebt = FHE.sub(storedDebt, FHE.min(repayEnc, storedDebt));
```

This is what the current code does at line 514 — but it uses `incomingDebt` (re-encrypted proof) instead of `storedDebt` (real encrypted handle). The result: `newDebt = trivial - trivial = trivial`. Using `storedDebt` would give: `newDebt = encrypted - trivial = encrypted` (privacy preserved).

---

### P-CRIT-3: `FHE.add` OVERFLOW WRAPS — BALANCE INFLATION

**CoFHE docs state:** "arithmetic on euint types is unchecked, i.e. there is wrap-around on overflow"

**Impact:** Every `FHE.add` in FheForge can overflow:
- `FHE.add(storedSupply, incoming)` — if supply + incoming > 2^128-1, wraps to small number
- `FHE.add(storedBorrow, requested)` — same for borrows
- `FHE.add(prev, amount)` in StrategyRegistry._modifyTvl

While 2^128-1 (3.4×10^38) is astronomically large for token amounts (even wei), the issue is **not practical overflow** but **composability**: if FheForge ever integrates with other FHE protocols that do overflow checks, or if a malicious input is crafted to cause overflow in a subsequent operation...

**More importantly:** FHESafeMath provides `tryIncrease` that returns an `ebool` flag. Without it, there is NO way to detect if an overflow occurred — not even post-hoc via decryption.

**SEVERITY: HIGH** — No overflow detection exists. Wrapped balances are undetectable without decryption.

**FIX:** Same as P-CRIT-1 — integrate FHESafeMath.

---

### P-CRIT-4: DUAL PLAIN+ENCRYPTED INPUT SKEW — NO ON-CHAIN VERIFICATION

Every user-facing function accepts BOTH a plain amount AND an encrypted amount:

```solidity
function shield(address token, uint256 amount, InEuint128 calldata encAmount)
function partialUnshield(address token, uint256 amount, InEuint128 calldata encAmount)
function repayDebt(address token, uint256 amount, InEuint128 calldata encAmount)
function openPosition(address token, uint256 amount, InEuint128 calldata encAmount, ...)
function addCollateral(bytes32 positionId, address collateralToken, uint256 amount, InEuint128 calldata encAmount, ...)
```

**The contract NEVER verifies that `amount == decrypt(encAmount)`.**

The ZK Verifier verifies that the user KNOWS the plaintext — but it does NOT verify that the plaintext matches the claimed `amount` parameter. The `InEuint128` struct contains a ZK proof that the user knows what they encrypted, but the `amount` is a SEPARATE parameter with no cryptographic link to `encAmount`.

**Attack:**
```
shield(WETH, 100 ether, encrypt(50 ether))
→ liquidReserve += 100  (tracks plain)
→ supplyBalances[user] += encrypted(50)  (tracks encrypted)
→ Skew: reserve thinks 100 was deposited, but encrypted state only has 50
→ User can later partialUnshield claiming 100 (if they encrypted 100 for that call)
→ OR: reserve appears 50 more than actual encrypted supply
```

Over time, repeated skew drains the reserve because `liquidReserve` tracks plain while `supplyBalances` tracks encrypted — and they diverge.

**SEVERITY: CRITICAL** — Fundamental invariant violation: `liquidReserve >= sum(encrypted supply)` is unenforceable because the contract cannot compute the sum of encrypted supplies. The plain reserve can be inflated beyond actual encrypted deposits.

**FIX options:**
1. **Remove plain `amount` parameter** — derive it from decryption flow: user calls `shield(encAmount)`, later reveals via proof, THEN reserve is updated. But this makes shield async (2 tx).
2. **ZK equality proof** — require a ZK proof that `encAmount` encrypts `amount`. The CoFHE SDK's ZK Verifier already proves knowledge of plaintext. Add: contract calls `FHE.eq(FHE.asEuint128(encAmount), FHE.asEuint128(amount))` → `ebool`, then `FHE.select(eq, actualAmount, _ZERO)`. This forces the encrypted input to match the claimed plain amount, or the operation uses encrypted zero instead.
3. **FHE.select enforcement** — Same as #2 but with select:
```solidity
euint128 incoming = FHE.asEuint128(encAmount);
euint128 claimedPlain = FHE.asEuint128(amount);
ebool amountsMatch = FHE.eq(incoming, claimedPlain);
euint128 verifiedIncoming = FHE.select(amountsMatch, incoming, _ZERO);
// Use verifiedIncoming instead of incoming for all state mutations
// If amounts don't match, encrypted zero is added — no harm, no skew
```

**Note:** `FHE.asEuint128(amount)` is trivial encryption (public), and `incoming` is real encryption. `FHE.eq` compares them homomorphically — the result is encrypted, so no info leaks. This is the correct CoFHE pattern.

---

### P-HIGH-5: `borrowWithLtvCheck` DOES NOT ENFORCE LTV — ZERO ENCRYPTED GUARD

```solidity
function borrowWithLtvCheck(
    address collateralToken, address borrowToken,
    uint256 borrowAmount, InEuint128 calldata encBorrowAmount,
    uint128 ltvNum, uint128 ltvDen
) external nonReentrant whenNotPaused returns (euint128 actual) {
    // ...
    // Plain collateral check removed — health enforcement via liquidation layer
    return _finalizeBorrow(collateralToken, borrowToken, borrowAmount, encBorrowAmount);
}
```

The comment "Plain collateral check removed" means **there is NO collateral check at all**. `borrowWithLtvCheck` accepts LTV parameters but ignores them entirely. It's just `borrowWithNoCheck` with extra parameters.

**CoFHE docs (conditions.md):** "Use FHE.select for encrypted conditionals"
**CoFHE docs (require.md):** "You can't use standard require statements that depend on encrypted conditions"

The correct pattern:
```solidity
euint128 collateralSupply = supplyBalances[collateralToken][_msgSender()];
euint128 borrowDebt = borrowBalances[borrowToken][_msgSender()];
euint128 newBorrow = FHE.add(borrowDebt, requested);

// Encrypted LTV check
euint128 maxBorrow = FHE.mul(collateralSupply, FHE.asEuint128(uint256(ltvNum)));
euint128 ltvDenEnc = FHE.asEuint128(uint256(ltvDen));
euint128 maxBorrowScaled = FHE.div(maxBorrow, ltvDenEnc);
ebool isHealthy = FHE.lte(newBorrow, maxBorrowScaled);

// Select: if healthy, proceed with borrow; otherwise, encrypted zero
euint128 actualBorrow = FHE.select(isHealthy, requested, _ZERO);
```

**SEVERITY: HIGH** — Without this, any user can borrow any amount regardless of collateral. Only post-hoc liquidation (which requires someone to requestLiquidityCheck + decrypt + liquidateWithProof) can catch this. The protocol is effectively unsecured during the borrow window.

---

### P-HIGH-6: PRIVACY LEAK VIA EVENT PARAMETERS

Every user action emits events with **plain amounts**:

```solidity
// LendingPool
emit Supplied(msg.sender, token, amount);           // plain amount leaked
emit Borrowed(msg.sender, collateral, borrow, amount); // plain borrow leaked
emit Repaid(msg.sender, token, amount);             // plain repay leaked
emit Withdrawn(msg.sender, token, amount);          // plain withdrawal leaked
emit Liquidated(liquidator, user, collToken, debtToken, debtCovered, collateralSeized); // all plain

// StrategyVault
emit PositionOpened(positionId, user, token, collateralAmount, strategyId); // plain
emit CollateralAdded(positionId, user, token, amount); // plain
emit PositionClosed(positionId, user, token, collateralAmount, fullClose); // plain
emit PausedWithdrawn(positionId, user, token, amount); // plain
```

**Privacy implication:** An observer watching events can reconstruct:
1. Every user's total supply (sum of Supplied - Withdrawn events)
2. Every user's total borrow (sum of Borrowed - Repaid events)
3. Exact liquidation amounts
4. Position sizes and close amounts

**This completely defeats the purpose of encrypted balances.** The encrypted state is private, but the event stream is a perfect plain-text mirror of all activity.

**CoFHE best practices:** "Minimize published values — only publish decrypted results when your protocol truly requires the plaintext on-chain. Use decryptForView if you only need to display the value in a UI."

**SEVERITY: HIGH** — Events create a perfect plain-text audit trail that mirrors encrypted state. Privacy is illusory.

**FIX options:**
1. Remove `amount` from events — emit only addresses and tokens
2. Emit encrypted amounts in events — `emit Supplied(msg.sender, token, encryptedAmount)` — but euint128 can't be indexed
3. Emit only action type + token — omit amount entirely
4. Use `anonymous` events to reduce indexing surface

**Recommended:** Option 1 or 3. Events are for off-chain indexing. If the UI needs amounts, it uses `decryptForView`. Events should NOT carry plain amounts in a privacy protocol.

---

### P-HIGH-7: `FHE.asEuint128(InEuint128)` TRUSTS ZK VERIFIER BUT NOT EQUALITY

**CoFHE ZK Verifier docs:**

> "ZKPoKs protect against potential malicious vectors, including malleability attacks and chosen ciphertext attacks (CCAs)"

The ZK Verifier proves the user KNOWS the plaintext of `encAmount`. It does NOT prove that `encAmount` equals the `amount` parameter. These are independent assertions.

The ZK proof in `InEuint128` guarantees:
- ✅ The user who created this ciphertext knows what value it encrypts
- ✅ The ciphertext was not produced by malleability/CCA
- ❌ The ciphertext encrypts the same value as some other parameter

**SEVERITY: HIGH** — ZK proof is misunderstood as "equality proof" but it's actually "knowledge proof". This is the root cause of P-CRIT-4.

---

### P-HIGH-8: `allowSender` IN GETTERS ENABLES FRONT-RUNNING ATTACKS

```solidity
function getSupplyBalance(address token) external returns (euint128) {
    euint128 bal = supplyBalances[token][msg.sender];
    FHE.allowThis(bal);
    FHE.allowSender(bal);
    return bal;
}
```

`FHE.allowSender(bal)` grants `msg.sender` persistent access to the handle. If a MEV bot front-runs this call, they get a handle they can attempt to decrypt (if they also have a permit from the user).

More importantly: **the returned `euint128` handle can be reused by the caller in any subsequent FHE operation** — including in another contract. If the user calls `getSupplyBalance` and then calls a malicious contract with the returned handle, that contract can use the handle in FHE operations (add, sub, etc.) since the caller has ACL.

**SEVERITY: MEDIUM** — Handle reuse is by design in FHE, but returning handles with broad ACL creates surface for handle-leakage attacks.

---

### P-MED-9: `FHE.isInitialized` PATTERN IS FRAGILE

```solidity
// LendingPool._finalizeSupply:
euint128 stored = supplyBalances[token][_msgSender()];
euint128 newBalance = FHE.isInitialized(stored) ? FHE.add(stored, incoming) : incoming;
```

**Problem:** `FHE.isInitialized` checks if the handle is non-zero (not the default bytes32(0)). But Solidity `mapping` default values ARE `bytes32(0)`. This works for the first deposit. But:

1. After `withdrawPausedWithProof`, balances are set to `_ZERO` (an initialized zero handle, not bytes32(0))
2. `FHE.isInitialized(_ZERO)` returns TRUE
3. So subsequent deposits after paused withdrawal correctly use `FHE.add(_ZERO, incoming)`

This is actually correct! But only because `_ZERO` is initialized with `FHE.asEuint128(0)` + `FHE.allowThis(_ZERO)`.

**BUT:** If a user's balance is deleted (e.g., `delete positions[user][positionId]`), the mapping slot reverts to `bytes32(0)` which is NOT initialized. This is handled in StrategyVault._deletePosition by deleting the entire Position struct, which means the collateral/debt handles become `bytes32(0)`. A subsequent `openPosition` for the same user+positionId would hit uninitialized handles... but positions use incremental nonces, so this is not a real risk.

**SEVERITY: LOW** — Pattern is correct but fragile. If anyone adds a "reset balance" feature without understanding the distinction between `_ZERO` and default `bytes32(0)`, it breaks.

---

### P-MED-10: `requestLiquidityCheck` LEAKS ENCRYPTED BALANCES TO ANYONE

```solidity
function requestLiquidityCheck(
    address user, address collateralToken, address debtToken
) external {
    FHE.allowPublic(borrowBalances[debtToken][user]);
    FHE.allowPublic(supplyBalances[collateralToken][user]);
}
```

**ANYONE** can call this for ANY user. `FHE.allowPublic` means anyone can request decryption via `decryptForTx` without a permit. This is the design intent (for liquidators), but:

1. A malicious actor can call `requestLiquidityCheck` for every user, decrypt all balances, and build a complete plain-text map of all positions
2. There's no access control — no requirement that the caller is a potential liquidator
3. No cooldown or rate limiting

**CoFHE ACL best practice:** "Only grant access to addresses that genuinely need it."

**SEVERITY: MEDIUM** — By design for liquidation, but over-permissive. Should be restricted to potential liquidators or require the user's consent.

**FIX:** Add access control — only allow if the encrypted health factor is below threshold (but this requires FHE.select enforcement which doesn't exist yet). Or require that the caller holds debt tokens of the user (proof of liquidator interest).

---

### P-MED-11: `withdrawPausedWithProof` ZEROS BOTH SUPPLY AND BORROW

```solidity
function withdrawPausedWithProof(
    address token, uint128 balanceProof, bytes calldata balanceSig
) external nonReentrant whenPaused {
    // ...
    supplyBalances[token][_msgSender()] = _ZERO;
    borrowBalances[token][_msgSender()] = _ZERO;
    // ...
}
```

When paused, a user can withdraw their supply by proving their balance. But the function also zeros their **borrow balance** — even if they haven't repaid! This means a user can escape both their supply AND their debt during a pause event.

**SEVERITY: MEDIUM** — Pause is an emergency state, but zeroing borrow without repayment is a protocol loss. Should verify borrow balance is zero before allowing, or require separate proof for borrow balance.

---

### P-MED-12: NO RE-ENTRANCY GUARD FOR FHE OPERATIONS

FHE operations are asynchronous — they return handles immediately but the actual computation happens off-chain. The contract stores the handle and trusts the coprocessor will compute correctly.

But what if the coprocessor is slow? What if a user calls `shield` twice in rapid succession before the first FHE.add is computed?

Actually, since FHE operations are synchronous in the EVM (the handle is returned immediately, computation is off-chain), reentrancy is not an issue for FHE ops specifically. The `nonReentrant` modifier guards against EVM-level reentrancy.

**However:** If the same user calls `shield` twice in separate transactions before the coprocessor processes the first, the second call reads the OLD `stored` handle and computes `FHE.add(old, incoming2)`. The first call computed `FHE.add(old, incoming1)`. Both results are stored, but the second overwrites the first — the first deposit is LOST.

**Wait — this can't happen** because each transaction is sequential on the EVM. The FHE coprocessor processes operations asynchronously but the EVM state transitions are atomic. The second tx sees the state written by the first tx (the new handle from FHE.add). So this is actually fine.

**SEVERITY: NONE** — Not an issue due to EVM atomicity.

---

### P-MED-13: INTEREST ACCRUAL IS COMPLETELY PLAIN — BREAKS PRIVACY MODEL

```solidity
struct InterestIndex {
    uint128 supplyIndex;    // WAD-scaled (1e18 = 1.0) — PLAIN
    uint128 borrowIndex;    // WAD-scaled — PLAIN
    uint64 lastAccrualTs;   // PLAIN
}
mapping(address => InterestIndex) public indices;
```

Interest indices are 100% plain. Any observer can:
1. Read `supplyIndex` and `borrowIndex` for any token
2. Combine with event data (Supplied/Borrowed amounts + timestamps)
3. Compute exact interest earned by any user

This makes the encrypted balance system privacy-theater for interest-bearing positions. Even without events, the plain index + block timestamps leak interest information.

**SEVERITY: MEDIUM** — Acknowledged as V3-6 deferred item. But it means current "privacy" is incomplete.

---

### P-MED-14: `FHE.allowThis` ON GETTER RETURNS IS REDUNDANT AND POTENTIALLY HARMFUL

```solidity
function getSupplyBalance(address token) external returns (euint128) {
    euint128 bal = supplyBalances[token][msg.sender];
    FHE.allowThis(bal);      // ← REDUNDANT: already allowed when stored
    FHE.allowSender(bal);
    return bal;
}
```

`FHE.allowThis(bal)` is called every time the getter is called, even though the handle was already `allowThis`'d when it was stored. This:
1. Wastes gas on an ACL write that's a no-op
2. Could theoretically reset the ACL entry (if the implementation re-creates rather than idempotent-set)

More importantly: the getter calls `allowThis` on a handle that the CONTRACT already owns. The FHE library's `allowThis` triggers an ACL contract write. If the handle was already allowed, this is a no-op SSTORE (100 gas). But if called frequently, this adds up.

**SEVERITY: LOW** — Gas waste. Not a security issue.

---

### P-LOW-15: `FHE.min(a, b)` IS MORE EXPENSIVE THAN `FHE.select(FHE.lte(a,b), a, b)`

According to CoFHE docs, `FHE.min` and `FHE.max` are listed as separate operations. The FHE.sol source shows they map to distinct `FunctionId.min` / `FunctionId.max` opcodes in the coprocessor.

This is actually MORE efficient than the manual `FHE.select(FHE.lte(a,b), a, b)` which would be 2 operations (lte + select) vs 1 (min). So the current code's use of `FHE.min` is correct and optimal.

**SEVERITY: NONE** — Actually good practice.

---

## PRIVACY SUMMARY — WHAT'S ACTUALLY PRIVATE vs WHAT LEAKS

| Data | Encrypted Storage | Leak Vector | Actually Private? |
|---|---|---|---|
| Supply balance | ✅ euint128 | Events (Supplied amount) | ❌ Events leak plain amounts |
| Borrow balance | ✅ euint128 | Events (Borrowed amount) | ❌ Events leak plain amounts |
| Collateral (Vault) | ✅ euint128 | Events (PositionOpened) | ❌ Events leak plain amounts |
| Debt (Vault) | ✅ euint128 | Events (no debt event? closePosition has amount) | ⚠️ Partial |
| Interest index | ❌ Plain | Public view | ❌ Public by design |
| Total plain borrow | ❌ Plain | Public view | ❌ Public by design (solvency) |
| Liquid reserve | ❌ Plain | Public view | ❌ Public by design (solvency) |
| Remaining balance after liquidation | ✅ euint128 | But computed from trivial inputs | ❌ Trivial-in → trivial-out |
| Strategy TVL | ✅ euint128 | getEncryptedTvl (allowSender) | ✅ Private (must decryptForView) |
| User positions list | ❌ Plain bytes32[] | getUserPositions | ❌ Position IDs public |
| Position metadata | ❌ Plain | getPositionMeta (view) | ❌ Strategy ID + block public |

**Conclusion: Only strategy TVL is meaningfully private.** All user balances are reconstructable from events + plain state. The encrypted storage provides integrity (can't fake balances) but NOT confidentiality (amounts are public via events).

---

## CRYPTOGRAPHIC CORRECTNESS SUMMARY

| Pattern | Correct? | Issue |
|---|---|---|
| `FHE.sub(a, FHE.min(b, a))` | ⚠️ Trusts coprocessor | No underflow detection — wraps if min returns wrong value |
| `FHE.add(stored, incoming)` | ⚠️ Trusts coprocessor | No overflow detection — wraps if result > 2^128 |
| `FHE.asEuint128(uint256)` for liquidation subtrahend | ❌ | Creates trivial encryption — remaining balance becomes computable |
| `FHE.isInitialized` check before add | ✅ | Correct pattern, handles default bytes32(0) |
| `FHE.allowThis` + `FHE.allow` after mutation | ✅ | Correct ACL pattern |
| `FHE.allowTransient` before cross-contract | ✅ | Correct pattern |
| `FHE.allowPublic` for requestLiquidityCheck | ⚠️ | Over-permissive — anyone can decrypt any user's balances |
| `FHE.verifyDecryptResult` in liquidation | ✅ | Correct proof verification |
| `FHE.select` for encrypted conditionals | ❌ NOT USED | Missing — borrow has no health check |
| `FHE.eq` for input equality | ❌ NOT USED | Missing — no encAmount==amount verification |
| Events with plain amounts | ❌ | Privacy destroyed by event emission |
| `FHE.asEuint128(InEuint128)` | ✅ | Correct — ZK proof verified by TaskManager |
| `FHE.allowSender` on getter returns | ⚠️ | Handle reuse surface + redundant allowThis |

---

## PRIORITY REMEDIATION

| Priority | Issue | Impact | Fix Complexity |
|---|---|---|---|
| **P0** | P-CRIT-1: FHE.sub underflow wraps | Phantom balances | Medium (FHESafeMath) |
| **P0** | P-CRIT-2: Liquidation uses trivial inputs | Privacy broken | Low (use stored handle) |
| **P0** | P-CRIT-4: Dual plain+encrypted skew | Reserve drain | Medium (FHE.eq select) |
| **P1** | P-HIGH-5: No borrow health enforcement | Undercollateralized borrows | Medium (FHE.select LTV) |
| **P1** | P-HIGH-6: Events leak plain amounts | Complete privacy loss | Low (remove amounts) |
| **P1** | P-HIGH-7: ZK proof ≠ equality proof | Misunderstanding root cause | Documentation |
| **P2** | P-HIGH-8: allowSender handle reuse | Front-running surface | Low (restrict callers) |
| **P2** | P-MED-10: requestLiquidityCheck unrestricted | Mass balance decryption | Low (access control) |
| **P2** | P-MED-11: withdrawPaused zeros borrow | Free debt escape | Low (require borrow proof) |
| **P2** | P-MED-13: Plain interest index | Interest info leakage | High (encrypted index) |
