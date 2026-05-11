# FHE FIX PLAN — 7 CRITICAL/HIGH Issues → On-Chain Deployment

Grounded in: FHE.sol source (3834 lines), FHESafeMath.sol (74 lines), FHERC20.sol (394 lines),
FHERC20ERC20Wrapper.sol (229 lines), FHERC20WrapperClaimHelper.sol (89 lines),
CoFHE official docs (conditions, require, access-control, encrypted-operations, trivial-encryption,
decryption-operations, best-practices, ZK-verifier), web research.

---

## FIX ARCHITECTURE

All 7 fixes target the 3 core contracts (LendingPool, StrategyVault, FheForgeComposer).
No new dependencies — everything uses existing `@fhenixprotocol/cofhe-contracts/FHE.sol` API.

### New file: `contracts/contracts/libraries/FHESafeMath128.sol`

Port of FHESafeMath from FHERC20 reference, adapted for euint128.

The FHERC20 reference uses euint64. We need euint128. The pattern is identical —
just change type widths. This is NOT a new dependency — it's a local library
using the same FHE.sol API already imported.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import { FHE, ebool, euint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

library FHESafeMath128 {
    /// @dev Try to increase `oldValue` by `delta`. Returns (success, updated).
    ///      If add would overflow (result < oldValue due to wrap), success=false,
    ///      updated=oldValue (unchanged). Otherwise success=true, updated=newValue.
    function tryIncrease(euint128 oldValue, euint128 delta)
        internal returns (ebool success, euint128 updated)
    {
        if (!FHE.isInitialized(oldValue)) {
            return (FHE.asEbool(true), delta);
        }
        euint128 newValue = FHE.add(oldValue, delta);
        success = FHE.gte(newValue, oldValue);  // overflow check: if wrapped, newValue < oldValue
        updated = FHE.select(success, newValue, oldValue);
    }

    /// @dev Try to decrease `oldValue` by `delta`. Returns (success, updated).
    ///      If sub would underflow (delta > oldValue), success=false,
    ///      updated=oldValue (unchanged). Otherwise success=true, updated=newValue.
    function tryDecrease(euint128 oldValue, euint128 delta)
        internal returns (ebool success, euint128 updated)
    {
        if (!FHE.isInitialized(oldValue)) {
            if (!FHE.isInitialized(delta)) {
                return (FHE.asEbool(true), oldValue);
            }
            return (FHE.eq(delta, FHE.asEuint128(0)), FHE.asEuint128(0));
        }
        success = FHE.gte(oldValue, delta);  // underflow check: delta must be <= oldValue
        updated = FHE.select(success, FHE.sub(oldValue, delta), oldValue);
    }

    /// @dev Try to add `a` + `b`. If overflow, success=false, res=0.
    function tryAdd(euint128 a, euint128 b)
        internal returns (ebool success, euint128 res)
    {
        if (!FHE.isInitialized(a)) return (FHE.asEbool(true), b);
        if (!FHE.isInitialized(b)) return (FHE.asEbool(true), a);
        euint128 sum = FHE.add(a, b);
        success = FHE.gte(sum, a);
        res = FHE.select(success, sum, FHE.asEuint128(0));
    }

    /// @dev Try to subtract `b` from `a`. If underflow, success=false, res=0.
    function trySub(euint128 a, euint128 b)
        internal returns (ebool success, euint128 res)
    {
        if (!FHE.isInitialized(b)) return (FHE.asEbool(true), a);
        euint128 difference = FHE.sub(a, b);
        success = FHE.lte(difference, a);
        res = FHE.select(success, difference, FHE.asEuint128(0));
    }
}
```

**Why this works (from FHERC20 reference, verified in FHE.sol source):**

`FHE.add(a, b)` wraps on overflow. If `a + b > 2^128-1`, the result wraps to a
small value. So `result < a` implies overflow occurred. `FHE.gte(result, a)` is
the encrypted overflow check — if result >= a, no overflow; if result < a, overflow.

`FHE.sub(a, b)` wraps on underflow. If `a < b`, the result wraps to a large value.
So `result > a` implies underflow occurred. `FHE.lte(result, a)` is the encrypted
underflow check — if result <= a, no underflow; if result > a, underflow.

Both checks are HOMOMORPHIC — they produce `ebool` (encrypted boolean).
No plaintext is revealed. The `FHE.select` then chooses the safe value
without branching on encrypted data — exactly the CoFHE pattern from conditions.md.

---

## FIX P-CRIT-1 + P-CRIT-3: Replace ALL FHE.add/FHE.sub with FHESafeMath128

### LendingPool.sol

**Current (WRONG — wraps silently):**
```solidity
euint128 newBalance = FHE.isInitialized(stored) ? FHE.add(stored, incoming) : incoming;
```

**Fix (tryIncrease — overflow detection):**
```solidity
import { FHESafeMath128 } from "./libraries/FHESafeMath128.sol";

// In _finalizeSupply:
(euint128 newBalance, ) = FHESafeMath128.tryIncrease(stored, incoming);
// tryIncrease returns (success, updated) — on overflow, keeps old value
// success ebool is available if we want to emit or track, but we always
// use updated which is the safe value (oldValue on failure, newValue on success)
```

Wait — ordering. FHESafeMath128 returns `(ebool success, euint128 updated)`.
In Solidity you can't ignore return values in some cases. Let me use the same
pattern as FHERC20._update:

```solidity
// FHERC20 reference pattern:
ebool success;
euint128 ptr;
(success, ptr) = FHESafeMath128.tryIncrease(stored, incoming);
FHE.allowThis(ptr);
FHE.allow(ptr, _msgSender());
supplyBalances[token][_msgSender()] = ptr;
// Optionally: track success for audit
```

**All replacements in LendingPool:**

| Function | Current | Fix |
|---|---|---|
| `_finalizeSupply` | `FHE.add(stored, incoming)` | `FHESafeMath128.tryIncrease(stored, incoming)` |
| `_finalizeBorrow` | `FHE.add(storedBorrow, requested)` | `FHESafeMath128.tryIncrease(storedBorrow, requested)` |
| `_finalizeRepay` | `FHE.sub(currentBalance, FHE.min(incoming, currentBalance))` | `FHESafeMath128.tryDecrease(currentBalance, incoming)` |
| `_withdrawCore` | `FHE.sub(currentBalance, FHE.min(incoming, currentBalance))` | `FHESafeMath128.tryDecrease(currentBalance, incoming)` |
| `depositFor` | `FHE.add(storedSupply, handle)` | `FHESafeMath128.tryIncrease(storedSupply, handle)` |
| `borrowFor` | `FHE.add(storedBorrow, handle)` | `FHESafeMath128.tryIncrease(storedBorrow, handle)` |
| `repayFor` | `FHE.sub(currentBalance, FHE.min(handle, currentBalance))` | `FHESafeMath128.tryDecrease(currentBalance, handle)` |
| `liquidateWithProof` (debt) | `FHE.sub(incomingDebt, FHE.min(repayEnc, incomingDebt))` | `FHESafeMath128.tryDecrease(borrowBalances[debtToken][user], repayEnc)` — ALSO fixes P-CRIT-2 |
| `liquidateWithProof` (collateral) | `FHE.sub(incomingColl, FHE.min(seizeEnc, incomingColl))` | `FHESafeMath128.tryDecrease(supplyBalances[collateralToken][user], seizeEnc)` — ALSO fixes P-CRIT-2 |

**Key insight for `_finalizeRepay` and `_withdrawCore`:** The current `FHE.min`
pattern is a manual attempt at safe subtract. `FHESafeMath128.tryDecrease` does
the SAME thing but correctly — it uses `FHE.gte(oldValue, delta)` (encrypted
check) then `FHE.select(success, FHE.sub(oldValue, delta), oldValue)`. This is
cryptographically equivalent but with explicit overflow detection via `success`.

### StrategyVault.sol

| Function | Current | Fix |
|---|---|---|
| `addCollateral` | `FHE.add(collateral, encAmount)` | `FHESafeMath128.tryIncrease(collateral, encAmount)` |
| `closePosition` | `FHE.sub(currentCollateral, FHE.min(encClosed, currentCollateral))` | `FHESafeMath128.tryDecrease(currentCollateral, encClosed)` |

### StrategyRegistry.sol

| Function | Current | Fix |
|---|---|---|
| `_modifyTvl` (increment) | `FHE.add(prev, amount)` | `FHESafeMath128.tryIncrease(prev, amount)` |
| `_modifyTvl` (decrement) | `FHE.select(hasEnough, FHE.sub(prev, amount), prev)` | `FHESafeMath128.tryDecrease(prev, amount)` — identical behavior, cleaner |

---

## FIX P-CRIT-2: Liquidation Uses Trivial Inputs → Use Stored Encrypted Handles

**Root cause:** `liquidateWithProof` re-encrypts the proof values into trivial
ciphertexts via `FHE.asEuint128(debtBalanceProof)`, then operates on those.
Result: `trivial - trivial = trivial` → remaining balance is publicly computable.

**Fix:** Use the ACTUAL stored encrypted handles as minuend. The subtrahend
(the amount to subtract) remains trivial (it's the known public debt covered /
collateral seized — unavoidable in liquidation). Result: `encrypted - trivial = encrypted`.

### LendingPool.liquidateWithProof — Before vs After

**BEFORE (broken privacy):**
```solidity
euint128 incomingDebt = FHE.asEuint128(debtBalanceProof);      // TRIVIAL
euint128 repayEnc128 = FHE.asEuint128(uint256(actualDebtCover)); // TRIVIAL
euint128 newDebt = FHE.sub(incomingDebt, FHE.min(repayEnc128, incomingDebt)); // TRIVIAL - TRIVIAL
borrowBalances[debtToken][user] = newDebt;

euint128 incomingColl = FHE.asEuint128(supplyBalanceProof);    // TRIVIAL
euint128 seizeEnc128 = FHE.asEuint128(seizedCollateral);       // TRIVIAL
euint128 newCollateral = FHE.sub(incomingColl, FHE.min(seizeEnc128, incomingColl)); // TRIVIAL - TRIVIAL
supplyBalances[collateralToken][user] = newCollateral;
```

**AFTER (privacy preserved):**
```solidity
// Subtrahend is trivial (public by nature of liquidation) — acceptable
euint128 repayEnc = FHE.asEuint128(uint256(actualDebtCover));

// Minuend is the REAL stored encrypted handle — NOT re-encrypted proof
euint128 storedDebt = borrowBalances[debtToken][user];
FHE.allowThis(storedDebt); // ensure contract can access
(, euint128 newDebt) = FHESafeMath128.tryDecrease(storedDebt, repayEnc);
borrowBalances[debtToken][user] = newDebt;
FHE.allowThis(newDebt);
FHE.allow(newDebt, user);

// Same for collateral
euint128 seizeEnc = FHE.asEuint128(seizedCollateral);
euint128 storedColl = supplyBalances[collateralToken][user];
FHE.allowThis(storedColl);
(, euint128 newCollateral) = FHESafeMath128.tryDecrease(storedColl, seizeEnc);
supplyBalances[collateralToken][user] = newCollateral;
FHE.allowThis(newCollateral);
FHE.allow(newCollateral, user);
```

**Why this is correct:**
- `actualDebtCover` is already public (in tx calldata, in the event)
- `seizedCollateral` is already public (computed from oracle prices + bonus)
- Making the subtrahend trivial is unavoidable and acceptable
- Making the minuend use the REAL encrypted handle means the result
  `(encrypted - trivial)` is encrypted — the remaining balance stays private
- The liquidator ALREADY knows the proof values; they decrypted them
- The key privacy gain: **third-party observers** cannot compute the
  remaining balance from calldata alone, because they don't have the
  non-trivial minuend's plaintext

---

## FIX P-CRIT-4: Dual Plain+Encrypted Input — FHE.eq Equality Verification

**Root cause:** Contract accepts `amount` (plain) + `encAmount` (encrypted)
with no on-chain verification they match. ZK Verifier proves KNOWLEDGE of
plaintext, NOT equality with `amount` parameter.

**Fix pattern (from CoFHE conditions.md + web research):**

```solidity
// Convert both to encrypted type and compare homomorphically
euint128 incoming = FHE.asEuint128(encAmount);              // real encrypted (from user input)
euint128 claimedPlain = FHE.asEuint128(amount);             // trivial (from plain parameter)
ebool amountsMatch = FHE.eq(incoming, claimedPlain);        // encrypted comparison
euint128 verifiedIncoming = FHE.select(amountsMatch, incoming, _ZERO); // select safe value
```

**Why this is correct (from CoFHE docs):**
- `FHE.asEuint128(amount)` creates trivial encryption — plaintext visible in calldata
- `incoming` is real encrypted — only the user knows the plaintext
- `FHE.eq` performs HOMOMORPHIC comparison — result is `ebool` (encrypted)
- No information leaks about whether amounts match or not
- `FHE.select` chooses the safe value without branching
- If amounts DON'T match, `_ZERO` is used — no skew, no state corruption
- The trivial value is NOT stored — only the verified encrypted value is stored

**Apply to ALL dual-input functions:**

### LendingPool.sol

```solidity
function shield(address token, uint256 amount, InEuint128 calldata encAmount)
    external nonReentrant whenNotPaused
{
    if (token == address(0)) revert ZeroAddress();
    if (amount == 0) revert ZeroAmount();

    IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);

    // ─── EQUALITY VERIFICATION ───
    euint128 incoming = FHE.asEuint128(encAmount);
    euint128 claimedPlain = FHE.asEuint128(amount);
    ebool amountsMatch = FHE.eq(incoming, claimedPlain);
    euint128 verifiedIncoming = FHE.select(amountsMatch, incoming, _ZERO);

    liquidReserve[token] += amount;

    euint128 stored = supplyBalances[token][_msgSender()];
    (, euint128 newBalance) = FHESafeMath128.tryIncrease(stored, verifiedIncoming);
    supplyBalances[token][_msgSender()] = newBalance;
    FHE.allowThis(newBalance);
    FHE.allow(newBalance, _msgSender());

    emit Supplied(msg.sender, token);  // NO plain amount (fixes P-HIGH-6)
}
```

**Same pattern for:**
- `shieldEth` — compare `encAmount` against `FHE.asEuint128(msg.value)`
- `partialUnshield` — compare `encAmount` against `FHE.asEuint128(amount)`
- `partialUnshieldEth` — same
- `repayDebt` — compare `encAmount` against `FHE.asEuint128(amount)`
- `borrowWithLtvCheck` — compare `encBorrowAmount` against `FHE.asEuint128(borrowAmount)`
- `borrowWithOracle` — same

### StrategyVault.sol

```solidity
function openPosition(
    address token, uint256 amount, InEuint128 calldata encAmount,
    uint256 strategyId, address user
) external nonReentrant whenNotPaused returns (bytes32 positionId) {
    // ─── EQUALITY VERIFICATION ───
    euint128 incoming = FHE.asEuint128(encAmount);
    euint128 claimedPlain = FHE.asEuint128(amount);
    ebool amountsMatch = FHE.eq(incoming, claimedPlain);
    euint128 verifiedIncoming = FHE.select(amountsMatch, incoming, _ZERO);

    // ... (rest same, but use verifiedIncoming instead of raw FHE.asEuint128(encAmount))
    positions[user][positionId] = Position({ collateral: verifiedIncoming, debt: _ZERO });
}
```

**Same pattern for:** `addCollateral`, `closePosition`

### FheForgeComposer.sol

Composer passes euint128 handles to Pool/Vault via `onlyComposer` functions.
The handles come from `FHE.asEuint128(e.collateral)` etc.

**Composer doesn't need equality verification** — it's a trusted intermediary.
The equality check happens at the user-facing entry points (shield, openPosition).
Composer's `openPosition` already has the verified handles from user input.

BUT: Composer's `depositFor`, `borrowFor`, `repayFor` use the euint128 handles
directly — these were already verified at the user-facing level. No additional
check needed.

**However:** The Composer should ALSO verify equality for its own `openPosition`:
```solidity
// In _openVaultPosition:
euint128 incomingColl = FHE.asEuint128(e.collateral);
// Equality check: does encrypted collateral match claimed plain collateralAmount?
euint128 claimedCollPlain = FHE.asEuint128(p.collateralAmount);
ebool collMatch = FHE.eq(incomingColl, claimedCollPlain);
euint128 verifiedColl = FHE.select(collMatch, incomingColl, _ZERO);
FHE.allowTransient(verifiedColl, address(VAULT));
VAULT.openPosition(p.collateralToken, p.collateralAmount, verifiedColl, strategyId, _msgSender());
```

Same for supply and borrow encrypted amounts.

---

## FIX P-HIGH-5: borrowWithLtvCheck — Encrypted Health Enforcement via FHE.select

**Current:** LTV params accepted but ignored. Zero health enforcement.

**Fix pattern (from CoFHE conditions.md + web research):**

```solidity
function borrowWithLtvCheck(
    address collateralToken,
    address borrowToken,
    uint256 borrowAmount,
    InEuint128 calldata encBorrowAmount,
    uint128 ltvNum,
    uint128 ltvDen
) external nonReentrant whenNotPaused returns (euint128 actual) {
    if (collateralToken == address(0) || borrowToken == address(0)) revert ZeroAddress();
    if (borrowAmount == 0) revert ZeroAmount();
    if (ltvDen == 0) revert LtvDenominatorZero();
    if (ltvNum == 0) revert LtvNumeratorZero();
    if (ltvNum > ltvDen) revert LtvExceedsHundredPercent();

    // ─── EQUALITY VERIFICATION ───
    euint128 requested = FHE.asEuint128(encBorrowAmount);
    euint128 claimedPlain = FHE.asEuint128(borrowAmount);
    ebool amountsMatch = FHE.eq(requested, claimedPlain);
    euint128 verifiedBorrow = FHE.select(amountsMatch, requested, _ZERO);

    // ─── ENCRYPTED HEALTH CHECK ───
    euint128 supplyBal = supplyBalances[collateralToken][_msgSender()];
    euint128 borrowBal = borrowBalances[borrowToken][_msgSender()];
    FHE.allowThis(supplyBal);
    FHE.allowThis(borrowBal);

    // maxBorrow = supplyBal * ltvNum / ltvDen
    euint128 ltvNumEnc = FHE.asEuint128(uint256(ltvNum));
    euint128 ltvDenEnc = FHE.asEuint128(uint256(ltvDen));
    euint128 maxBorrow = FHE.div(FHE.mul(supplyBal, ltvNumEnc), ltvDenEnc);

    // newBorrow = borrowBal + verifiedBorrow
    (, euint128 newBorrow) = FHESafeMath128.tryIncrease(borrowBal, verifiedBorrow);

    // isHealthy = newBorrow <= maxBorrow
    ebool isHealthy = FHE.lte(newBorrow, maxBorrow);

    // actual = isHealthy ? verifiedBorrow : _ZERO
    actual = FHE.select(isHealthy, verifiedBorrow, _ZERO);
    FHE.allowThis(actual);
    FHE.allow(actual, _msgSender());

    // Update state with actual (may be zero if unhealthy)
    if (FHE.isInitialized(borrowBal)) {
        euint128 finalBorrow = FHE.add(borrowBal, actual);
        borrowBalances[borrowToken][_msgSender()] = finalBorrow;
        FHE.allowThis(finalBorrow);
        FHE.allow(finalBorrow, _msgSender());
    } else {
        borrowBalances[borrowToken][_msgSender()] = actual;
    }

    // Plain tracking: use borrowAmount (already equality-verified via FHE.eq)
    // If actual is encrypted-zero (unhealthy), plain reserve is NOT touched
    // We need a way to know if the borrow succeeded in plain...
    // Problem: we can't branch on encrypted condition!

    // Solution: transfer tokens OUT only if healthy.
    // But we can't conditionally transfer — that's a plain operation.
    // We must use FHE.select to gate the plain amount too.
    // The only way is: always update plain state, but let the user
    // claim borrowed tokens via a separate proof step (like unshield).
    // OR: use the oracle-based check for the plain path (conservative).
}
```

**CRITICAL DESIGN DECISION for P-HIGH-5:**

The fundamental tension: `IERC20.transfer` is a PLAIN operation. We can't
conditionally transfer based on an encrypted condition. Options:

**Option A: Oracle-guarded plain path + encrypted health check as backup**
- Use oracle for the plain transfer (as `borrowWithOracle` already does)
- ALSO run encrypted health check via FHE.select
- If encrypted check fails (actual = _ZERO), the borrow amount in encrypted
  state is zero, but plain tokens were already transferred
- This creates a skew: user has plain tokens but encrypted borrow is zero
- **BAD** — creates exactly the skew we're trying to prevent

**Option B: Two-phase borrow (async like unshield)**
1. User calls `requestBorrow` → encrypted health check → if healthy, mark
   borrow as pending with `allowPublic` on the encrypted borrow amount
2. User decrypts off-chain → submits proof → contract verifies and transfers
3. Like FHERC20's unshield flow: request → decrypt → claim
- **GOOD** — no conditional plain transfer, all state consistent
- **DOWNSIDE** — borrow is now 2-tx instead of 1-tx

**Option C: Accept that borrow requires oracle price (current approach)**
- `borrowWithOracle` already does a plain health check using oracle prices
- The encrypted health check adds a SECOND layer but can't gate the transfer
- So: keep `borrowWithOracle` for the transfer gate, add encrypted check
  as a state-consistency guard
- If encrypted check disagrees with oracle, emit an audit event but don't revert
  (can't revert on encrypted condition without leaking info)
- **PRAGMATIC** — maintains 1-tx UX, oracle is the enforcement, encrypted
  check is the audit trail

**RECOMMENDATION: Option C with encrypted audit trail.**

```solidity
function borrowWithLtvCheck(...) {
    // Oracle plain check (gates the token transfer)
    _requireOracleHealthy(collateralToken, borrowToken, collateralAmount, borrowAmount, 0);

    // Encrypted health check (audit + state consistency)
    euint128 supplyBal = supplyBalances[collateralToken][_msgSender()];
    euint128 borrowBal = borrowBalances[borrowToken][_msgSender()];
    FHE.allowThis(supplyBal);
    FHE.allowThis(borrowBal);

    euint128 ltvNumEnc = FHE.asEuint128(uint256(ltvNum));
    euint128 ltvDenEnc = FHE.asEuint128(uint256(ltvDen));
    euint128 maxBorrow = FHE.div(FHE.mul(supplyBal, ltvNumEnc), ltvDenEnc);
    euint128 newBorrow = FHE.add(borrowBal, requested);
    ebool isHealthy = FHE.lte(newBorrow, maxBorrow);

    // Store encrypted borrow (always — oracle already gated the transfer)
    // The isHealthy ebool is stored for later audit/liquidation use
    borrowBalances[borrowToken][_msgSender()] = newBorrow;
    FHE.allowThis(newBorrow);
    FHE.allow(newBorrow, _msgSender());

    // Also store the health check result for future reference
    // (used by requestLiquidityCheck / liquidation)
    healthChecks[msg.sender][collateralToken][borrowToken] = isHealthy;
    FHE.allowThis(isHealthy);

    return requested;
}
```

**Note on `FHE.mul` and `FHE.div`:** Both operands must be `euint128`.
`ltvNum` is uint128 → `FHE.asEuint128(uint256(ltvNum))` is trivial but valid.
`FHE.mul(supplyBal, ltvNumEnc)` is `encrypted × trivial` = encrypted. Good.
`FHE.div(encrypted, trivial)` = encrypted. Good.

**WARNING from CoFHE docs:** "Division by 0 outputs encrypted maximal value
of the uint type." If `ltvDen = 0`, we already revert before reaching FHE.div.
If `ltvDen > 0`, the trivial `ltvDenEnc` is non-zero, so division is safe.

---

## FIX P-HIGH-6: Events Leak Plain Amounts

**Pattern from FHERC20 reference:**

```solidity
// FHERC20._update emits:
emit Transfer(from, to, uint256(_INDICATOR_TRANSFER) * _indicatorTick);  // indicator, NOT real amount
emit ConfidentialTransfer(from, to, transferred);  // encrypted amount
```

FHERC20 emits:
1. An ERC-20 compatible `Transfer` event with an INDICATOR value (not real amount)
2. A `ConfidentialTransfer` event with the encrypted handle (euint64)

**For FheForge, we don't need ERC-20 compatibility.** But the pattern is clear:
emit encrypted handles, not plain amounts.

### Fix: Replace all plain-amount events with encrypted-handle events

**BEFORE:**
```solidity
event Supplied(address indexed user, address indexed token, uint256 indexed amount);
emit Supplied(msg.sender, token, amount);
```

**AFTER:**
```solidity
event Supplied(address indexed user, address indexed token);
emit Supplied(msg.sender, token);
```

Or if we want off-chain indexing of encrypted amounts:
```solidity
event Supplied(address indexed user, address indexed token, euint128 encryptedAmount);
emit Supplied(msg.sender, token, verifiedIncoming);
```

**WARNING:** `euint128` is `bytes32` — it can be emitted in events but cannot
be `indexed` (indexed parameters must be uint256/address/bytes32 reference).
So: emit as non-indexed parameter.

**All event changes:**

| Contract | Event | Remove | Add |
|---|---|---|---|
| LendingPool | `Supplied` | `uint256 amount` | (none, or `euint128 encAmount`) |
| LendingPool | `Borrowed` | `uint256 amount` | (none, or `euint128 encAmount`) |
| LendingPool | `Repaid` | `uint256 amount` | (none, or `euint128 encAmount`) |
| LendingPool | `Withdrawn` | `uint256 amount` | (none, or `euint128 encAmount`) |
| LendingPool | `Liquidated` | `uint256 debtCovered, collateralSeized` | (none — liquidation is public by design) |
| StrategyVault | `PositionOpened` | `uint256 collateralAmount` | (none) |
| StrategyVault | `CollateralAdded` | `uint256 amount` | (none) |
| StrategyVault | `PositionClosed` | `uint256 collateralAmount` | (none) |
| StrategyVault | `PausedWithdrawn` | `uint256 amount` | (none) |
| FheForgeComposer | `LeveragedStrategyOpened` | `uint256 supplyAmount, borrowAmount` | (none) |
| FheForgeComposer | `StrategyRebalanced` | `uint256 addAmount, repayAmount, newBorrowAmount` | (none) |

**Liquidation events are SPECIAL:** Liquidation amounts ARE public by design
(the liquidator decrypted them, the proof is on-chain). So `Liquidated` event
CAN keep plain amounts — no privacy loss since they're already public.

---

## FIX P-HIGH-7: Documentation — ZK Proof ≠ Equality Proof

This is a documentation/understanding fix, not a code change. Add to contract
comments and to the audit report:

```
/// @dev IMPORTANT: The ZK proof in InEuint128 proves that the user KNOWS
/// the plaintext of the ciphertext. It does NOT prove that the ciphertext
/// value matches a separate plain parameter. The contract MUST use FHE.eq
/// to verify equality between the encrypted input and the claimed plain amount.
/// Without this check, a user can supply mismatched values, creating skew
/// between plain tracking (reserve) and encrypted tracking (balance).
```

---

## DEPLOYMENT PLAN — Wave 19

### Phase 1: FHESafeMath128 Library (new file)
- Create `contracts/contracts/libraries/FHESafeMath128.sol`
- Port from FHERC20 reference, adapt euint64→euint128
- Compile: `npx hardhat compile --force`

### Phase 2: LendingPool Fixes (biggest contract)
- Import FHESafeMath128
- Replace all FHE.add with tryIncrease
- Replace all FHE.sub+min with tryDecrease
- Add equality verification (FHE.eq + FHE.select) to shield, shieldEth,
  partialUnshield, partialUnshieldEth, repayDebt, borrowWithLtvCheck,
  borrowWithOracle
- Fix liquidateWithProof to use stored handles instead of trivial re-encryption
- Add encrypted health check to borrowWithLtvCheck
- Remove plain amounts from events (except Liquidated)
- Compile

### Phase 3: StrategyVault Fixes
- Import FHESafeMath128
- Replace FHE.add with tryIncrease (addCollateral)
- Replace FHE.sub+min with tryDecrease (closePosition)
- Add equality verification to openPosition, addCollateral, closePosition
- Remove plain amounts from events
- Compile

### Phase 4: FheForgeComposer Fixes
- Add equality verification in _openVaultPosition, _depositToPool, _borrowFromPool
- Remove plain amounts from events
- Compile

### Phase 5: StrategyRegistry Fixes
- Import FHESafeMath128
- Replace FHE.add with tryIncrease in _modifyTvl
- Replace FHE.select+sub with tryDecrease in _modifyTvl
- Compile

### Phase 6: Full Compile + ABI Regen
- `npx hardhat compile --force` — 81 files clean
- Regenerate ABIs from compiled artifacts
- Update frontend hooks to match new event signatures (no amount params)

### Phase 7: Deploy Wave 19
- `WAVE=19 npx hardhat run scripts/deploy-full.ts`
- All 7 contracts redeployed
- Verify on Arbiscan + Sourcify

### Phase 8: On-Chain Integration Test
- `npx hardhat run scripts/audit-quick.ts`
- Test: shield with matching enc/plain → should succeed
- Test: shield with MISMATCHED enc/plain → encrypted zero stored, no skew
- Test: borrow with insufficient collateral → encrypted health check = false
- Test: liquidation → remaining balance stays encrypted (not publicly computable)

---

## GAS IMPACT ESTIMATE

| Change | Gas Impact | Reason |
|---|---|---|
| FHESafeMath128.tryIncrease | +~150k per call | Extra FHE.gte + FHE.select (2 FHE ops) |
| FHESafeMath128.tryDecrease | +~150k per call | Extra FHE.gte + FHE.select (2 FHE ops) |
| Equality verification (FHE.eq + select) | +~200k per call | FHE.asEuint128(trivial) + FHE.eq + FHE.select (3 FHE ops) |
| Encrypted health check (borrowWithLtvCheck) | +~600k per call | FHE.mul + FHE.div + FHE.add + FHE.lte + FHE.select (5 FHE ops) |
| Liquidation fix (stored handle) | -~50k per call | Fewer FHE.asEuint128 calls |
| Event changes (remove amounts) | negligible | Fewer event params |

**Estimated total per shield:** ~350k extra gas (2 FHE ops for tryIncrease + 3 for equality)
**Estimated total per borrowWithLtvCheck:** ~800k extra gas

On Arbitrum Sepolia with ~0.01 gwei gas price, this is < $0.01 per tx.

---

## RISK ASSESSMENT

| Risk | Mitigation |
|---|---|
| FHESafeMath128 tryDecrease returns oldValue on failure — borrower can't repay if underflow? | Underflow means delta > balance — impossible if equality verification passes. If equality fails, verifiedIncoming = _ZERO, so tryDecrease(currentBalance, _ZERO) succeeds. |
| FHE.eq comparison is approximate? | No — FHE.eq is exact. TFHE implements exact equality on ciphertexts. |
| FHE.mul(supplyBal, ltvNumEnc) — supplyBal is euint128, ltvNum is typically 7000 (70% LTV). Product could be up to 2^128 × 7000 which overflows euint128? | YES — this is a real risk. supplyBal × ltvNum can overflow euint128. Fix: use WAD-scaled math. `maxBorrow = supplyBal × ltvNum / ltvDen` must be computed as `supplyBal × (ltvNum × WAD / ltvDen) / WAD` or use smaller intermediate. Better: compute as `FHE.div(FHE.mul(supplyBal, FHE.asEuint128(uint256(ltvNum) * WAD)), FHE.asEuint128(uint256(ltvDen) * WAD))` — but this STILL overflows if supplyBal is large. **Alternative: compare `newBorrow × ltvDen` vs `supplyBal × ltvNum`** — avoids division entirely: `ebool isHealthy = FHE.lte(FHE.mul(newBorrow, ltvDenEnc), FHE.mul(supplyBal, ltvNumEnc))` — both products fit in euint128 if values are reasonable (supply < 2^120, ltv < 2^8). |
| Equality verification adds 3 FHE ops — gas cost significant on mainnet? | ~200k gas extra. At mainnet gas prices (30 gwei), ~0.006 ETH ≈ $15. Acceptable for DeFi. |
| Events without amounts break existing frontend indexing? | Yes — frontend must use `decryptForView` for amounts instead of event logs. This is the CORRECT pattern for confidential DeFi. |

---

## ORDER OF IMPLEMENTATION

1. **FHESafeMath128.sol** — new library, no existing code touched
2. **LendingPool** — all fixes applied at once (largest surface)
3. **StrategyVault** — smaller, same pattern
4. **StrategyRegistry** — smallest FHE usage
5. **FheForgeComposer** — equality checks in cross-contract paths
6. **Compile + ABI regen** — verify 81 files clean
7. **Frontend event updates** — remove amount params from event handlers
8. **Deploy Wave 19** — all contracts
9. **Integration test** — verify equality enforcement, overflow protection, privacy
