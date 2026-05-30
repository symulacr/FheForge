# FheForge — User-Facing Features (from `useFheVault`)

Source: `ui/hooks/use-fhe-vault.ts`

## Vault / Strategy Position Management

| Feature | Hook Method | Contract Call | What the User Does |
|---|---|---|---|
| **Open a vault position** | `openPosition(collateralToken, collateralAmount, strategyId?)` | `StrategyVault.openPosition` | Deposit a token as collateral to enter a yield strategy. Optionally pick a strategy ID. An encrypted collateral amount is sent on-chain. Returns a transaction hash; position ID is tracked locally after success. |
| **Add collateral to a position** | `addCollateral(collateralToken, amount, decimals?, positionId?)` | `StrategyVault.addCollateral` | Top up an existing vault position with more collateral tokens. If no `positionId` given, falls back to the user's first known position. |
| **Close a position / withdraw collateral** | `closePosition(positionId, collateralAmount, encryptedCollateralAmount)` | `StrategyVault.closePosition` | Close a vault position and withdraw its collateral. Requires the position ID and the (already encrypted) collateral amount. |

## Lending Pool — Supply & Withdraw

| Feature | Hook Method | Contract Call | What the User Does |
|---|---|---|---|
| **Supply ETH** | `supplyEth(amount)` | `LendingPool.shieldEth` | Deposit ETH into the lending pool to earn yield. ETH sent as `msg.value` alongside an encrypted amount. |
| **Withdraw supplied ERC20 tokens** | `withdrawSupply(token, amount, decimals?)` | `LendingPool.partialUnshield` | Withdraw previously supplied ERC20 tokens from the lending pool. Encrypted amount sent on-chain. |
| **Withdraw supplied ETH** | `withdrawEth(amount, encAmount)` | `LendingPool.partialUnshieldEth` | Withdraw previously supplied ETH from the lending pool. Requires both plain and encrypted amount. |

## Lending Pool — Borrow & Repay

| Feature | Hook Method | Contract Call | What the User Does |
|---|---|---|---|
| **Repay borrowed debt** | `repay(token, amount, decimals?)` | `LendingPool.repayDebt` | Repay an outstanding borrow position. Encrypted amount sent on-chain. |

> **Note:** Direct `borrowFromLending` was REMOVED from this hook (see inline comment MC-07/08). Borrowing is only available through the Composer (`useComposer().openPosition`) or rebalance flow. This hook only exposes repay. The presence of `repay` implies the user can have active borrows (created via Composer), but this hook does not initiate them.

## Swap

| Feature | Hook Method | Contract Call | What the User Does |
|---|---|---|---|
| **Submit a swap intent** | `submitSwapIntent(tokenIn, tokenOut, amountInEth, minOutEth, deadlineOffset)` | `SwapRouter.submitSwapIntent` | Propose a token swap with slippage tolerance applied to `minOut`. Sets a deadline offset from current time. Not encrypted — plain amounts. |

## Decryption / Reveal (Read-Only)

| Feature | Hook Method | What the User Does |
|---|---|---|
| **Reveal encrypted collateral amount** | `revealCollateral()` | Decrypt the last encrypted supply/collateral handle and returns the human-readable amount. |
| **Reveal encrypted borrow amount** | `revealBorrow()` | Decrypt the last encrypted borrow handle and returns the human-readable amount. |
| **Reveal encrypted swap intent amount** | `revealSwapIntent(encryptedAmount)` | Decrypt a given encrypted amount handle for swap purposes. |

## Query

| Feature | Hook Method | What the User Does |
|---|---|---|
| **List my position IDs** | `getUserPositions(userAddress)` | Fetch all vault position IDs owned by a user from on-chain. |
| **Sync local position cache** | `syncUserPositions()` | Refresh the in-memory position ID list from on-chain data. |

## Summary — What the User Can Actually Do

1. **Deposit** — supply ETH into the lending pool for yield (`supplyEth`).
2. **Withdraw supplied tokens** — pull ERC20 or ETH back out of the lending pool (`withdrawSupply`, `withdrawEth`).
3. **Borrow repay** — repay an outstanding debt position (`repay`). (Borrow initiation itself is handled by the Composer, not this hook.)
4. **Supply collateral to a vault strategy** — open a position with collateral (`openPosition`) and top it up later (`addCollateral`).
5. **Withdraw collateral from a vault strategy** — close a position to retrieve the collateral (`closePosition`).
6. **Swap** — submit an encrypted swap intent (`submitSwapIntent`).
7. **View encrypted values** — decrypt and read their own collateral, borrow, or swap amounts (`revealCollateral`, `revealBorrow`, `revealSwapIntent`).
8. **Track positions** — fetch and sync their vault position list.
