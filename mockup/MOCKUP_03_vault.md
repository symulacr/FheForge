# StrategyVault — Business Logic Analysis

## What is a "Strategy"?

A **strategy** is a registered, on-chain identified *program* for managing leveraged DeFi positions. It is the core namespace that vault positions associate themselves with.

### Registration

A user (the `creator`) registers a strategy via `StrategyRegistry.registerStrategy(name, workflowHash[, apyTarget, loopCount])`. The registry assigns an auto-incrementing `uint256 strategyId` and stores a `Strategy` struct:

```solidity
struct Strategy {
    bytes32 workflowHash;   // identifies the execution pipeline
    uint64  createdAt;      // block timestamp of registration
    uint16  apyTarget;      // target APY in basis points
    bool    active;         // soft-kill switch (creator-only toggle)
    uint8   loopCount;      // number of loop iterations
    address creator;        // who registered it
    string  name;           // human label
}
```

### TVL Tracking

Each strategy has an **encrypted TVL** (`euint128 encryptedTvls[strategyId]`) — total value locked across all vault positions associated with that strategy. Only the Vault contract (`onlyVault` guard) can modify it via `incrementTvl()` / `decrementTvl()`. TVL is never stored in plaintext; it lives as an FHE ciphertext handle that can be revealed via `getEncryptedTvl()` with caller ACL.

### Lifecycle

- **active**: creator can pause/resume via `setActive()`. Inactive strategies reject TVL changes.
- **cross-chain**: strategies can be broadcast to other domains via `broadcastStrategy()` (emits a `CrossChainMessage` event for off-chain relayers to pick up) or received from another domain via `receiveCrossChainStrategy()` (owner-only).
- **Content dedup**: each `(creator, name)` pair maps to a single `strategyId` via `idByContentHash`.

### Role in the Composer flow

`FheForgeComposer.openPosition()` either reuses an existing `strategyId` (if `p.strategyId != 0`) or registers a new strategy on the fly with `(name, workflowHash, apyTarget, loopCount)`. The strategy links the vault position to a specific pipeline of actions the `StrategyExecutor` runs (supply, borrow, swap, repay, add collateral, withdraw).

---

## StrategyVault Contract

The Vault **holds collateral** for vault positions. Each position is a deposit slot associated with a strategy. Vault positions are encrypted-first: the core balance is an `euint128` FHE ciphertext, with plaintext bookkeeping only as an interim bridge (marked `DEPRECATED`).

### Position Data Model

```solidity
struct Position {
    euint128 collateral;   // encrypted FHE handle
}

// Core position storage
mapping(address => mapping(bytes32 => Position)) private positions;         // user → positionId → encrypted collateral
mapping(address => bytes32[]) private userPositionIds;                     // user → list of their position IDs
mapping(bytes32 => address) private positionCollateralToken;               // positionId → token address
mapping(bytes32 => uint256) private positionDepositedAmount;               // positionId → plaintext amt (DEPRECATED, interim bookkeeping)
mapping(bytes32 => uint256) private positionStrategyId;                    // positionId → strategyId (0 = no strategy)
mapping(bytes32 => uint256) private positionOpenedAtBlock;                  // positionId → block.number at open
mapping(bytes32 => bool) private positionExists;                           // positionId → liveness flag
mapping(address => uint256) private userPositionNonce;                     // user → nonce for unique positionId derivation
mapping(bytes32 => address) public positionOwner;                          // positionId → the address that called openPosition
mapping(bytes32 => address) private positionBeneficiary;                   // positionId → the actual user (Composer uses msg.sender from its own caller)
```

A `positionId` is derived as `keccak256(user, nonce)` — deterministic but unique per user + incrementing nonce.

The **owner** is the direct caller of `openPosition` (the Composer contract when called via the Composer flow). The **beneficiary** is the user on whose behalf the position is opened — this separation supports the Composer calling on behalf of an end user.

---

## Core Functions

### openPosition(token, amount, encAmount, strategyId, user)

Opens a vault position and deposits collateral into it.

| Param | Type | Description |
|-------|------|-------------|
| `token` | address | ERC-20 collateral token address |
| `amount` | uint256 | plaintext deposit amount |
| `encAmount` | euint128 | encrypted FHE handle of the same amount (equality-checked by caller) |
| `strategyId` | uint256 | strategy to associate this position with |
| `user` | address | the beneficiary; position's encrypted state is stored under this key |

**Flow:**

1. Guards: `amount > 0`, `token != addr(0)`, reentrancy, pausable.
2. Compute `positionId = keccak256(user, nonce)` with an incrementing per-user nonce.
3. Set `positionOwner[positionId] = msg.sender` (caller — the Composer), `positionBeneficiary[positionId] = user`.
4. Store the plaintext amount in `positionDepositedAmount[positionId]` (interim; will be removed).
5. Store metadata: token, `block.number`, `strategyId`, set `positionExists = true`.
6. Append `positionId` to `userPositionIds[user]`.
7. **Transfer** `amount` of `token` from `msg.sender` → Vault via `safeTransferFrom`.
8. Store the encrypted handle: `positions[user][positionId] = Position({ collateral: encAmount })`.
9. **Grant ACL** on the encrypted handle to the user via `SharedStrategyMeta.grantPositionAcl(…)`.
10. Emit `PositionOpened(positionId, user, token, strategyId)` — no plain amounts in events (P-HIGH-6 fix).

**Returns:** `bytes32 positionId`.

**Who calls it:** `FheForgeComposer._openVaultPosition()` or `StrategyExecutor._executeAction()` (via the `DEPOSIT_VAULT` action type).

---

### addCollateral(positionId, collateralToken, amount, encAmount, user)

Adds more collateral to an existing position.

| Param | Type | Description |
|-------|------|-------------|
| `positionId` | bytes32 | existing position to top up |
| `collateralToken` | address | must match the token already stored for this position |
| `amount` | uint256 | additional plaintext amount |
| `encAmount` | euint128 | encrypted handle for the additional amount (equality-verified by caller) |
| `user` | address | beneficiary under whose key the position's encrypted state lives |

**Flow:**

1. Guards: `positionExists[positionId]`, `amount > 0`, token matches stored token.
2. **Increment** `positionDepositedAmount[positionId]` by `amount` (plaintext bookkeeping).
3. **Transfer** `amount` of `token` from `msg.sender` → Vault.
4. **Safely FHE-increase** the encrypted collateral handle: `positions[user][positionId].collateral = SharedStrategyMeta.safeIncrease(old, encAmount, user)`.
   - Internally: `FHESafeMath128.tryIncrease()` (prevents overflow), grants ACL on the new handle.
5. Grant ACL on the updated handle to the user.
6. Emit `CollateralAdded(positionId, user, collateralToken)`.

**Who calls it:** `StrategyExecutor._executeAction()` (via `ADD_COLLATERAL` action type) or Composer flows.

---

### closePosition(positionId, collateralAmount, encCollateralAmount)

Withdraws part or all of the collateral from a position, closing it fully or partially.

| Param | Type | Description |
|-------|------|-------------|
| `positionId` | bytes32 | position to close from |
| `collateralAmount` | uint256 | plaintext amount to withdraw |
| `encCollateralAmount` | euint128 | encrypted handle for equality verification |

**Flow:**

1. Guards: `positionExists`, `collateralAmount > 0`, `collateralAmount <= deposited` (reverts `ExceedsDeposit`), `block.number - 1 >= openedAtBlock` (reverts `SameBlockClose` — prevents same-block manipulation).
2. **Ownership check**: only `positionOwner[positionId]` can close (reverts `NotPositionOwner` otherwise with caller/owner/positionId context).
3. Compute `remaining = deposited - collateralAmount`.
4. **Full close path** (`remaining == 0`): call `_deletePosition(user, positionId)` — deletes all per-position storage mappings and swaps-and-pops the ID from the user's position array (does NOT clear `positionExists`).
5. **Strategy TVL update** (if `strategyId != 0`):
   - **Equality verification**: `_verifyEquality(encCollateralAmount, collateralAmount)` — confirms the encrypted handle matches the claimed plaintext via FHE equality check. Mismatched ciphertext produces `_ZERO`, making the TVL decrement a no-op.
   - `FHE.allowThis(verifiedClosed)` + `FHE.allowTransient(verifiedClosed, REGISTRY)` to grant transient ACL.
   - `IStrategyRegistry(REGISTRY).decrementTvl(strategyId, verifiedClosed)` — reduces the strategy's encrypted TVL.
   - **Partial close only** (`remaining != 0`): safely FHE-decreases the stored encrypted collateral: `pos.collateral = _safeDecrease(current, verifiedClosed, beneficiary)`.
6. **Transfer** `collateralAmount` (plaintext) of `token` from Vault → `owner`.
7. Emit `PositionClosed(positionId, owner, token, fullClose)`.

**Design notes:**
- Partial close updates TVL correctly but retains the position for future additions.
- Full close deletes all state and the position ID from the user's list.
- Equality verification prevents a malicious caller from claiming a larger amount than their encrypted handle represents — the FHE circuit zeros out the over-claim.

---

### Emergency / Utility Functions

#### withdrawPaused(positionId)
When the contract is **paused** (owner-triggered emergency stop), anyone with a position can call this to pull out their full deposited amount (plaintext) without FHE verification. Decrements the strategy's TVL if `strategyId != 0`, then deletes all position state and transfers the balance. Emits `PausedWithdrawn`.

#### getCollateral(positionId)
Returns the encrypted `euint128` collateral handle, granting ACL to the caller for offline decryption. Reverts `PositionNotFound` if the position doesn't exist.

#### getPositionMeta(positionId) → (strategyId, createdAt)
View function returning strategy ID and block number the position was opened at.

#### getDepositedAmount(positionId) → 0
**Deprecated**. Returns 0 always (was `positionDepositedAmount`, removed due to plaintext leakage). Callers must use `getCollateral()` (encrypted) instead.

#### getUserPositions(user) → bytes32[]
Returns all position IDs for a user.

---

## Interaction Map

```
User / Composer / StrategyExecutor
        │
        ▼
┌─────────────────────┐
│   StrategyVault     │  holds collateral, tracks encrypted positions
│                     │  per-position → strategyId link
│  openPosition() ────┼──► StrategyRegistry.incrementTvl()  [via Composer/Executor]
│  addCollateral()    │
│  closePosition() ───┼──► StrategyRegistry.decrementTvl()
│  withdrawPaused()   │
└─────────────────────┘
        │
        ▼
   IERC20(token).safeTransferFrom / safeTransfer
```

The lifecycle:
1. User registers or selects a strategy.
2. Composer calls `Vault.openPosition()` → position created, TVL incremented on the strategy.
3. Composer/Executor supplies to LendingPool, borrows, swaps — all in the same strategy pipeline.
4. The strategy's encrypted TVL tracks how much total value is deployed across all positions.
5. On close, collateral is withdrawn, TVL decremented, position cleaned up.
