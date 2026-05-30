# LendingPool — User-Facing Functions

Source: `contracts/contracts/LendingPool.sol` — a fhenix FHE-encrypted lending pool (inherits `FheForgeBase`).

Encrypted state: all user balances (`supplyBalances`, `borrowBalances`) are `mapping(address => mapping(address => euint128))` — FHE ciphertexts, not plain uint256. Every amount the user passes comes with both a `uint256` and an `InEuint128 calldata encAmount`; the contract re-encrypts the plaintext and uses `_verifyEquality` (inherited from `FheForgeBase`) to confirm the two match, preventing the user from lying about what they encrypted. All encrypted operations are ACL-gated via `FHE.allowSender` / `FHE.allowPublic` / `FHE.allowThis` — only authorized parties can decrypt.

---

## 1. Supply (`shield`)

```solidity
function shield(address token, uint256 amount, InEuint128 calldata encAmount)
    external payable nonReentrant whenNotPaused
```

**What the user does:** Deposits `amount` ERC-20 `token` into the pool as encrypted supply collateral.

**Flow:**
1. Transfers `amount` of `token` from user → contract via `safeTransferFrom`.
2. Contract projects it: encodes the incoming encrypted handle, cross-checks it matches `amount`.
3. Increases the user's encrypted supply balance for `(token, user)`.
4. Adds `amount` to `liquidReserve[token]` — the pool's available plaintext liquidity.

**As a user, you:** approve the pool to spend your tokens, then call `shield` with the same amount you encrypted off-chain. Your supply balance is now a ciphertext — only you (and the contract via `allowThis`) can operate on it.

---

## 2. Borrow

Two paths — LTV-gated (FHE-based) and oracle-gated (traditional).

### 2a. `borrowWithLtvCheck`

```solidity
function borrowWithLtvCheck(
    address collateralToken, address borrowToken,
    uint256 borrowAmount, InEuint128 calldata encBorrowAmount,
    uint128 ltvNum, uint128 ltvDen
) external payable nonReentrant whenNotPaused returns (euint128 actual)
```

**What the user does:** Borrows `borrowAmount` of `borrowToken` against their encrypted supply of `collateralToken`, proving LTV health cryptographically rather than via a price oracle.

**Flow:**
1. Takes the user-supplied LTV numerator and denominator (`ltvNum / ltvDen`), e.g. 60/100 for 60%.
2. Computes securely inside FHE: `newBorrow * ltvDen ≤ supplyBal * ltvNum?`
3. If healthy → borrow goes through. If unhealthy → `actual = 0` (no revert, but no increase).
4. Updates encrypted borrow balance; transfers plain `borrowAmount` tokens to user.
5. Decrements `liquidReserve` and increments `totalPlainBorrow` for the borrow token.

**As a user, you:** decide your own LTV threshold. Useful for private lending where you don't want an oracle to know your position. If the FHE check fails, you get 0 borrowed — no revert, no griefing.

### 2b. `borrowWithOracle`

```solidity
function borrowWithOracle(
    address collateralToken, address borrowToken,
    uint256 collateralAmount, uint256 borrowAmount,
    InEuint128 calldata encBorrowAmount
) external payable nonReentrant whenNotPaused returns (euint128 actual)
```

**What the user does:** Borrows using the PriceOracle for LTV validation instead of FHE arithmetic.

**Flow:**
1. Looks up the oracle's `collateralFactorBps` for the collateral token.
2. Converts both collateral and total debt (borrow + existing) to USD using the oracle.
3. Reverts if `collateralUsd × LTV < totalDebtUsd × 10000`.
4. On success: same as LTV path (updates borrow balance, transfers tokens, adjusts liquidity).

**As a user, you:** supply collateral, then borrow against it at the oracle-set LTV ratio. Simpler path when you trust the oracle. Reverts with `InsufficientCollateral` if you don't have enough.

---

## 3. Repay (`repayDebt`)

```solidity
function repayDebt(address token, uint256 amount, InEuint128 calldata encAmount)
    external payable nonReentrant whenNotPaused
```

**What the user does:** Repays `amount` of `token` debt they owe.

**Flow:**
1. Transfers `amount` of `token` from user → contract.
2. Decrements `totalPlainBorrow[token]` and increments `liquidReserve[token]`.
3. Subtracts the encrypted amount from the user's `borrowBalances[token][user]`.

**As a user, you:** send repayment tokens + encrypted proof. This reduces your debt ciphertext and restores pool liquidity. No LTV checks — anyone can repay any amount up to their full debt.

---

## 4. Liquidate (`liquidateWithProof`)

```solidity
function liquidateWithProof(
    address user,
    address collateralToken, address debtToken,
    uint256 debtToCover,
    uint128 debtBalanceProof, bytes calldata debtSig,
    uint128 supplyBalanceProof, bytes calldata supplySig
) external payable nonReentrant whenNotPaused
```

**What the user (liquidator) does:** Liquidates an underwater position by covering some of the user's debt and seizing their collateral at a bonus.

**Flow:**
1. Verifies both encrypted balances (debt + supply) are decrypted via cryptographic proofs — the liquidator provides `FHE.verifyDecryptResult` proofs for both.
2. Caps debt cover at `LIQUIDATION_CLOSE_FACTOR_BPS` (50%) of the user's total debt.
3. Checks position remains underwater after liquidation (oracle-based LTV on remaining debt).
4. Liquidator transfers `actualDebtCover` of `debtToken` to the pool.
5. Pool adjusts encrypted debt balance for the underwater user.
6. Calculates seized collateral at `LIQUIDATION_BONUS_BPS` (5%) bonus: `debtCovered × (oracle price ratio) × 105/100`.
7. Transfers seized collateral tokens to the liquidator.
8. Adjusts the user's encrypted supply balance downward.

**As a liquidator, you:** need the encrypted balance proofs (the underwater user must have revealed them via `requestLiquidityCheck` or similar). You cover their debt, get their collateral + 5% bonus. Cannot self-liquidate (`CannotSelfLiquidate`). Cannot liquidate the same token pair as collateral and debt (`TokenMismatch`).

---

## 5. Withdraw

Three withdrawal paths.

### 5a. `partialUnshield` (normal withdraw)

```solidity
function partialUnshield(address token, uint256 amount, InEuint128 calldata encAmount)
    external payable nonReentrant whenNotPaused
```

**What the user does:** Withdraws a partial `amount` of supplied `token` back to their wallet.

**Flow:**
1. Calls internal `_withdrawCore`: verifies encrypted amount, checks `liquidReserve` has enough after accounting for outstanding `totalPlainBorrow`.
2. Decrements user's encrypted supply balance.
3. Transfers plain `amount` of `token` to the user's wallet.

**As a user, you:** get your collateral back (partial). Must leave enough liquidity for outstanding borrows — `InsufficientReserve` if withdrawal would break the reserve constraint.

### 5b. `partialUnshieldEth` (ETH withdraw)

```solidity
function partialUnshieldEth(uint256 amount, InEuint128 calldata encAmount)
    external payable nonReentrant whenNotPaused
```

Same as `partialUnshield` but for native ETH (wraps/unwraps via WETH). Calls `_withdrawCore` on WETH address, unwraps via `weth.withdraw(amount)`, then sends raw ETH to the caller.

**As a user, you:** withdraw your supplied ETH as native ETH, not as WETH.

### 5c. `unshieldWithProof` (full withdraw with proof)

```solidity
function unshieldWithProof(
    address token, uint128 balanceProof, bytes calldata balanceSig
) external payable nonReentrant whenNotPaused
```

**What the user does:** Withdraws their *full* supply balance using a cryptographic proof of the encrypted balance (no amount parameter).

**Flow:**
1. Verifies the proof (`FHE.verifyDecryptResult`) of the user's total supply balance for the token.
2. The decrypted value (`balanceProof` cast to `uint256`) is the full amount.
3. Zeros out both supply and borrow encrypted balances for that token.
4. Sends the full amount to the user.

**As a user, you:** this is a "close-out" — surrenders all supply (and all debt) for the token in one shot. Requires you to have revealed your balance beforehand (or have it already publicly decryptable). Useful when you want to exit a position entirely.

### 5d. `withdrawPausedWithProof` (emergency withdraw)

```solidity
function withdrawPausedWithProof(
    address token, uint128 balanceProof, bytes calldata balanceSig
) external payable nonReentrant whenPaused
```

Same semantics as `unshieldWithProof`, but only callable when the contract is **paused** (`whenPaused` modifier). Clears both supply and borrow in one atomic operation.

**As a user, you:** this is your escape hatch if the protocol is paused — pull your collateral even though normal operations are frozen. Also clears your debt.

---

## Ancillary User-Facing Functions (Read / Reveal)

### Balance queries
- `getSupplyBalance(address token)` — returns `euint128` encrypted balance, ACL-granted to `msg.sender` so they can decrypt it client-side.
- `getBorrowBalance(address token)` — same for borrow side.

### Reveal helpers
- `requestBalanceReveal(address token)` — makes your supply balance publicly decryptable (1-hour cooldown). Allows third parties (e.g. frontends, explorers) to see your supply.
- `requestBorrowReveal(address token)` — same for borrow side.
- `requestLiquidityCheck(address user, address collateralToken, address debtToken)` — caller must be the user; reveals both supply and borrow balances publicly. Enables liquidators to verify the position.
- `requestUnshield(address token)` — makes supply balance publicly decryptable (no cooldown gating, but no withdrawal is performed).

### Health check
- `isLiquidatable(user, collateralToken, debtToken, collateralAmount, borrowAmount)` — pure view, no state change. Checks if a position (given revealed amounts) is underwater via the oracle. Returns `false` if oracle is not set or amounts are zero.

### Flash loan
- `flashLoan(receiver, token, amount, params)` — borrows `amount` of `token` with no collateral, must be repaid within the same tx + 0.05% fee. Implements ERC-3156.
- `maxFlashLoan(address token)` — view: maximum available flash loan for a token.
- `flashFee(address token, uint256 amount)` — view: flash loan fee.

---

## Error Conditions (User-Facing)

| Error | Context |
|---|---|
| `ZeroAddress` | user `token` or address is `address(0)` |
| `ZeroAmount` | supplied/borrow/repay/withdraw amount is 0 |
| `LtvNumeratorZero` | LTV numerator is 0 |
| `LtvDenominatorZero` | LTV denominator is 0 |
| `LtvExceedsHundredPercent` | LTV ratio > 100% (user entered bad numbers) |
| `InsufficientCollateral` | Not enough supply to back the borrow (oracle path) |
| `InsufficientReserve` | Pool doesn't have enough liquid tokens |
| `OracleNotSet` | Oracle address is zero (can't use oracle path) |
| `WethNotSet` | WETH address is zero (can't use ETH paths) |
| `LiquidationTooLarge` | Debt to cover exceeds the user's actual debt |
| `CannotSelfLiquidate` | Can't liquidate your own position |
| `NotAuthorized` | Caller is not the user for `requestLiquidityCheck` |
| `InvalidProof` | FHE decryption proof doesn't match on-chain ciphertext |
| `RevealCooldown` | Called `requestBalanceReveal` / `requestBorrowReveal` less than 1 hour ago |
| `FlashLoanNotRepaid` | Flash loan receiver didn't return the correct ERC-3156 callback hash |
| `FlashLoanUnsupportedToken` | Token has no flash loan reserves |
