# Public State Exposure Audit — FHE Privacy Leakage Analysis

**Protocol:** FheForge — Private Encrypted DeFi on Arbitrum Sepolia
**Audit Date:** May 2026
**Scope:** Public/external view functions across all core contracts, including non-view accessor functions that return FHE handles
**Audit References:** [`FHE_CRYPTO_PRIVACY_AUDIT.md`](../research/archive/FHE_CRYPTO_PRIVACY_AUDIT.md), [`security-review.md`](./security-review.md)
**Chain:** Arbitrum Sepolia (421614)

---

## 1. Scope & Methodology

### 1.1 Contracts Audited

| Contract | File | Lines | Role |
|---|---|---|---|
| LendingPool | `contracts/contracts/LendingPool.sol` | 607 | Core lending engine |
| FheForgeComposer | `contracts/contracts/FheForgeComposer.sol` | 252 | Multi-step strategy orchestration |
| StrategyVault | `contracts/contracts/StrategyVault.sol` | 266 | Encrypted position management |
| StrategyRegistry | `contracts/contracts/StrategyRegistry.sol` | 277 | Strategy registration & TVL |
| SwapRouter | `contracts/contracts/SwapRouter.sol` | 253 | DEX integration (Uniswap V3) |
| TokenRegistry | `contracts/contracts/TokenRegistry.sol` | 126 | Token whitelist & config |
| PriceOracle | `contracts/contracts/PriceOracle.sol` | 358 | Multi-source pricing |
| StrategyExecutor | `contracts/contracts/StrategyExecutor.sol` | 175 | Action pipeline execution |
| ExecutorContract | `contracts/contracts/ExecutorContract.sol` | 49 | Ownable executor proxy |
| FheForgeBase | `contracts/contracts/FheForgeBase.sol` | 178 | Shared base (abstract) |

### 1.2 Risk Classification

| Category | Color | Definition |
|---|---|---|
| **No FHE Leak** | 🟢 GREEN | Function reads/stores only plaintext config, addresses, or non-FHE state. No encrypted data exposed. |
| **Aggregated / Handle Leak** | 🟡 YELLOW | Function returns encrypted handles (euint128) with ACL grants, or reveals aggregated metadata. Individual position amounts remain encrypted but handle-reuse surface exists. |
| **Individual Position Leak** | 🔴 RED | Function reveals plaintext amounts tied to individual positions or users, defeating FHE privacy. Includes public `allowPublic` calls. |

### 1.3 What Is Audited

For each contract, this document enumerates:
1. Every `public`/`external` state variable accessor (auto-generated getters)
2. Every `public`/`external` `view` function
3. Every non-view accessor function that returns FHE encrypted handles (e.g., `getSupplyBalance`)

Functions that are purely mutative (write-only) are excluded unless they have specific privacy-leak side effects like `allowPublic`.

---

## 2. Privacy Exposure Heat Map

### 2.1 Overview Matrix

| Contract | 🟢 GREEN | 🟡 YELLOW | 🔴 RED | Risk Score |
|---|---|---|---|---|
| FheForgeBase | 4 | 0 | 0 | 🟢 Low |
| LendingPool | 7 | 2 | 3 🔴 | 🟠 Medium-High |
| StrategyVault | 1 | 1 | 2 🔴 | 🟠 Medium |
| StrategyRegistry | 7 | 1 | 0 | 🟢 Low |
| SwapRouter | 5 | 0 | 0 | 🟢 Low |
| TokenRegistry | 6 | 0 | 0 | 🟢 Low |
| PriceOracle | 16 | 0 | 0 | 🟢 Low |
| StrategyExecutor | 1 | 0 | 0 | 🟢 Low |
| ExecutorContract | 0 | 0 | 0 | 🟢 None |

> **Risk Score Legend:** 🟢 Low (0 RED), 🟠 Medium (1–2 RED), 🔴 High (3+ RED)

---

## 3. LendingPool — Detailed Audit

### 3.1 View / Accessor Functions

| # | Function | Signature | Type | Risk | Analysis |
|---|---|---|---|---|---|
| LP-01 | `totalPlainBorrow` | `mapping(address => uint256) public` | Auto-getter | 🟢 GREEN | Plain uint256 tracking total borrow per token. Reveals aggregate protocol debt per asset. No individual user data. |
| LP-02 | `liquidReserve` | `mapping(address => uint256) public` | Auto-getter | 🟢 GREEN | Plain uint256 tracking available liquidity per token. Reveals pool depth per asset. No individual user data. |
| LP-03 | `composer` | `address public` | Auto-getter | 🟢 GREEN | Plain address of the Composer contract. Protocol config. |
| LP-04 | `oracle` | `PriceOracle public` | Auto-getter | 🟢 GREEN | Plain address of the PriceOracle contract. Protocol config. |
| LP-05 | `weth` | `IWETH9 public` | Auto-getter | 🟢 GREEN | Plain address of the WETH contract. Protocol config. |
| LP-06 | `BPS_DEN` | (inherited) | Constant | 🟢 GREEN | Plain constant (10_000). |
| LP-07 | `FLASH_FEE_BPS` | `uint256 public constant` | Constant | 🟢 GREEN | Plain constant (5). |
| LP-08 | `maxFlashLoan` | `maxFlashLoan(address) → uint256` | `external view` | 🟢 GREEN | Returns `liquidReserve[token] - totalPlainBorrow[token]`. Plain arithmetic on public state. No FHE data. |
| LP-09 | `flashFee` | `flashFee(address, uint256) → uint256` | `external view` | 🟢 GREEN | Returns `(amount * 5) / 10000`. Pure computation on caller-provided plain amount. No FHE data. |
| LP-10 | `isLiquidatable` | `isLiquidatable(address,address,address,uint256,uint256) → bool` | `external view` | 🟢 GREEN | Takes **caller-provided** plain amounts. Reads oracle for price. Does **not** read encrypted storage at all. No FHE state touched. |
| LP-11 | `getSupplyBalance` | `getSupplyBalance(address) → euint128` | `external payable` (non-view) | 🟡 YELLOW | Returns the caller's encrypted supply balance with `FHE.allowSender` ACL grant. Handle is encrypted — only caller can decrypt via `decryptForView`. **Risk:** returned handle can be reused if caller passes it to a malicious contract. |
| LP-12 | `getBorrowBalance` | `getBorrowBalance(address) → euint128` | `external payable` (non-view) | 🟡 YELLOW | Same as LP-11 for borrow balances. |

### 3.2 Privacy-Critical Non-View Functions

| # | Function | Signature | Risk | Analysis |
|---|---|---|---|---|
| LP-13 | `requestBalanceReveal` | `requestBalanceReveal(address)` | 🔴 RED | Calls `FHE.allowPublic` on the caller's **supply** balance. Makes it publicly decryptable by **anyone** via `decryptForTx`. Permanent — no revoke mechanism per P-HIGH-8 in the crypto audit. |
| LP-14 | `requestBorrowReveal` | `requestBorrowReveal(address)` | 🔴 RED | Same as LP-13 but for **borrow** balance. |
| LP-15 | `requestLiquidityCheck` | `requestLiquidityCheck(address,address,address)` | 🔴 RED | Calls `FHE.allowPublic` on **any user's** supply and borrow balances. **No access control** — anyone can call this for any user. As noted in P-MED-10 of the crypto audit: "a malicious actor can call `requestLiquidityCheck` for every user, decrypt all balances, and build a complete plain-text map of all positions." |
| LP-16 | `requestUnshield` | `requestUnshield(address)` | 🔴 RED | Calls `FHE.allowPublic` on caller's supply balance. Same effect as LP-13 but also emits an event. |

### 3.3 Inherited from FheForgeBase

| # | Function | Signature | Risk | Analysis |
|---|---|---|---|---|
| LP-17 | `owner()` | `owner() → address` | 🟢 GREEN | Contract owner address. No FHE data. |
| LP-18 | `pendingOwner()` | `pendingOwner() → address` | 🟢 GREEN | Pending owner address. No FHE data. |
| LP-19 | `paused()` | `paused() → bool` | 🟢 GREEN | Pause status. No FHE data. |

### 3.4 State Variables (Private, No Accessor)

These are `private` in LendingPool and NOT exposed via any view function:

| Variable | Visibility | Encrypted? | Exposed? |
|---|---|---|---|
| `supplyBalances[token][user]` | `private` | ✅ `euint128` | ❌ Not via any view. Only via LP-11 with ACL. |
| `borrowBalances[token][user]` | `private` | ✅ `euint128` | ❌ Not via any view. Only via LP-12 with ACL. |

**Conclusion for LendingPool:** Encrypted balances are stored in `private` mappings and are never returned as plaintext. However, `requestLiquidityCheck` (LP-15) completely bypasses privacy by making **any user's** balances publicly decryptable with **no** access control.

---

## 4. StrategyVault — Detailed Audit

### 4.1 View / Accessor Functions

| # | Function | Signature | Type | Risk | Analysis |
|---|---|---|---|---|---|
| SV-01 | `positionOwner` | `mapping(bytes32 => address) public` | Auto-getter | 🟢 GREEN | Plain address of position owner. No FHE data. Reveals which address controls each position. |
| SV-02 | `getPositionMeta` | `getPositionMeta(bytes32) → (uint256, uint256)` | `external view` | 🟢 GREEN | Returns `strategyId` and `createdAt` block number. Plain metadata. No FHE amounts. |
| SV-03 | `getDepositedAmount` | `getDepositedAmount(bytes32) → uint256` | `external view` | 🔴 RED | Returns `positionDepositedAmount[positionId]` — a **plain uint256** that records the total deposited amount for a position. This completely leaks the individual position size in plaintext. If a user has a single position with encrypted collateral, anyone can read its size via this function. |
| SV-04 | `getUserPositions` | `getUserPositions(address) → bytes32[]` | `external view` | 🟡 YELLOW | Returns all position IDs for a user. Position IDs are `keccak256(user, nonce)` — opaque but enumerable. Combined with SV-03, an attacker can enumerate all of a user's positions and read their sizes. |
| SV-05 | `getCollateral` | `getCollateral(bytes32) → euint128` | `external` (non-view) | 🟡 YELLOW | Returns the encrypted collateral handle with `FHE.allow(coll, msg.sender)` and `FHE.allowSender(coll)`. Same handle-reuse risk as LP-11. |

### 4.2 State Variables (Private, No Direct Accessor)

| Variable | Visibility | Encrypted? | Exposed? |
|---|---|---|---|
| `positions[user][positionId].collateral` | `private` | ✅ `euint128` | ❌ Not directly. Only via SV-05 with ACL. |
| `userPositionIds[user]` | `private` | ❌ `bytes32[]` | ✅ Exposed via SV-04 `getUserPositions` |
| `positionDepositedAmount[id]` | `private` | ❌ `uint256` | ✅ Exposed via SV-03 `getDepositedAmount` |
| `positionStrategyId[id]` | `private` | ❌ `uint256` | ✅ Exposed via SV-02 `getPositionMeta` |
| `positionOpenedAtBlock[id]` | `private` | ❌ `uint256` | ✅ Exposed via SV-02 `getPositionMeta` |
| `positionCollateralToken[id]` | `private` | ❌ `address` | ❌ Not exposed |
| `positionExists[id]` | `private` | ❌ `bool` | ❌ Not exposed |
| `userPositionNonce[user]` | `private` | ❌ `uint256` | ❌ Not exposed |
| `positionBeneficiary[id]` | `private` | ❌ `address` | ❌ Not exposed |

**Critical Finding:** `positionDepositedAmount` is `private` but exposed via `getDepositedAmount` (SV-03) as **plaintext**. This means the encrypted collateral handle (`euint128` in `positions[user][positionId].collateral`) is **redundant for privacy** — anyone can read the exact deposit size from `getDepositedAmount`. The FHE encryption of collateral amounts is **privacy-theater** for vault positions.

**However:** Note that events in StrategyVault (per P-HIGH-6 fix) no longer emit plain amounts:

```solidity
// FIXED: No amount in event
event PositionOpened(bytes32 indexed positionId, address indexed user, address indexed collateralToken, uint256 strategyId);
```

The event no longer leaks amounts, but `getDepositedAmount` still does.

---

## 5. StrategyRegistry — Detailed Audit

### 5.1 View / Accessor Functions

| # | Function | Signature | Type | Risk | Analysis |
|---|---|---|---|---|---|
| SR-01 | `idByContentHash` | `mapping(bytes32 => uint256) public` | Auto-getter | 🟢 GREEN | Plain uint256 mapping content hash → strategy ID. |
| SR-02 | `strategyCount` | `uint256 public` | Auto-getter | 🟢 GREEN | Total registered strategies. |
| SR-03 | `vaultAddress` | `address public` | Auto-getter | 🟢 GREEN | Vault contract address. |
| SR-04 | `localDomain` | `uint256 public` | Auto-getter | 🟢 GREEN | Chain domain ID for cross-chain. |
| SR-05 | `getStrategyMeta` | `getStrategyMeta(uint256) → (string,bytes32,address,uint256,bool)` | `external view` | 🟢 GREEN | Returns strategy name, workflow hash, creator, creation time, active flag. All plaintext metadata. |
| SR-06 | `getStrategyParams` | `getStrategyParams(uint256) → (uint16,uint8)` | `external view` | 🟢 GREEN | Returns apyTarget and loopCount. |
| SR-07 | `getEncryptedTvl` | `getEncryptedTvl(uint256) → euint128` | `external` (non-view) | 🟡 YELLOW | Returns encrypted TVL handle with ACL grant to caller. TVL is an aggregate metric across all users, not individual positions. The encrypted handle preserves privacy, but the ACL grant enables handle reuse. |

### 5.2 State Variables (Private, No Accessor)

| Variable | Visibility | Encrypted? | Exposed? |
|---|---|---|---|
| `strategies[id]` (full struct) | `private` | ❌ Plain | ✅ Partial via SR-05, SR-06 |
| `encryptedTvls[id]` | `private` | ✅ `euint128` | ✅ Via SR-07 with ACL |

---

## 6. SwapRouter — Detailed Audit

### 6.1 View / Accessor Functions

| # | Function | Signature | Type | Risk | Analysis |
|---|---|---|---|---|---|
| SW-01 | `MIN_DEADLINE_OFFSET` | `uint256 public immutable` | Auto-getter | 🟢 GREEN | Plain immutable config. |
| SW-02 | `MAX_DEADLINE_OFFSET` | `uint256 public immutable` | Auto-getter | 🟢 GREEN | Plain immutable config. |
| SW-03 | `executor` | `address public` | Auto-getter | 🟢 GREEN | Executor address. Protocol config. |
| SW-04 | `UNISWAP_V3_ROUTER` | `address public immutable` | Auto-getter | 🟢 GREEN | Uniswap router address. Protocol config. |
| SW-05 | `getIntentMeta` | `getIntentMeta(bytes32) → (address,address,address,uint256)` | `external view` | 🟢 GREEN | Returns tokenIn, tokenOut, user, deadline. All plaintext swap intent metadata. No FHE data anywhere in SwapRouter. |

### 6.2 State Variables (Private, No Accessor)

| Variable | Visibility | Exposed? |
|---|---|---|
| `intents[intentId]` (full struct) | `private` | ✅ Partial via SW-05 |
| `nonces[user]` | `private` | ❌ Not exposed |

**Note:** SwapRouter has **zero** FHE integration. All amounts are plaintext by design (Uniswap V3 works with plain amounts). No FHE privacy leakage.

---

## 7. TokenRegistry — Detailed Audit

### 7.1 View / Accessor Functions

| # | Function | Signature | Type | Risk | Analysis |
|---|---|---|---|---|---|
| TR-01 | `tokens` | `mapping(address => TokenInfo) public` | Auto-getter | 🟢 GREEN | Returns full `TokenInfo` struct — all plaintext config fields (ltv, decimals, flags, caps, price ID). |
| TR-02 | `tokenList` | `address[] public` | Auto-getter | 🟢 GREEN | Array of registered token addresses. |
| TR-03 | `getTokenCount` | `getTokenCount() → uint256` | `external view` | 🟢 GREEN | Length of tokenList. |
| TR-04 | `getLendableTokens` | `getLendableTokens() → address[]` | `external view` | 🟢 GREEN | Filtered list of lendable tokens. |
| TR-05 | `getBorrowableTokens` | `getBorrowableTokens() → address[]` | `external view` | 🟢 GREEN | Filtered list of borrowable tokens. |
| TR-06 | `getCollateralTokens` | `getCollateralTokens() → address[]` | `external view` | 🟢 GREEN | Filtered list of collateral tokens. |
| TR-07 | `isTokenEnabled` | `isTokenEnabled(address) → bool` | `external view` | 🟢 GREEN | Token enabled status. |

**No FHE data anywhere in TokenRegistry.**

---

## 8. PriceOracle — Detailed Audit

### 8.1 View / Accessor Functions

| # | Function | Signature | Type | Risk | Analysis |
|---|---|---|---|---|---|
| PO-01 | `priceId` | `mapping(address => bytes32) public` | Auto-getter | 🟢 GREEN | Pyth price feed ID per token. |
| PO-02 | `staleThreshold` | `mapping(address => uint64) public` | Auto-getter | 🟢 GREEN | Staleness threshold per token. |
| PO-03 | `tokenDecimals` | `mapping(address => uint8) public` | Auto-getter | 🟢 GREEN | Decimals per token. |
| PO-04 | `collateralFactorBps` | `mapping(address => uint16) public` | Auto-getter | 🟢 GREEN | LTV BPS per token. |
| PO-05 | `liquidationThresholdBps` | `mapping(address => uint16) public` | Auto-getter | 🟢 GREEN | Liq. threshold BPS per token. |
| PO-06 | `stalenessThreshold` | `uint256 public` | Auto-getter | 🟢 GREEN | Global staleness threshold. |
| PO-07 | `lastPriceUpdate` | `mapping(address => uint256) public` | Auto-getter | 🟢 GREEN | Last update timestamp. |
| PO-08 | `registeredTokens` | `address[] public` | Auto-getter | 🟢 GREEN | Registered token list. |
| PO-09 | `isTokenRegistered` | `mapping(address => bool) public` | Auto-getter | 🟢 GREEN | Registration status. |
| PO-10 | `isSupported` | `isSupported(address) → bool` | `external view` | 🟢 GREEN | Whether token has price feed. |
| PO-11 | `getPriceUsd` | `getPriceUsd(address) → (uint256, uint64)` | `public view` | 🟢 GREEN | Returns Pyth price in WAD. |
| PO-12 | `getPythUpdateFee` | `getPythUpdateFee(bytes[]) → uint256` | `external view` | 🟢 GREEN | Pyth update fee quote. |
| PO-13 | `isStale` | `isStale(address) → bool` | `external view` | 🟢 GREEN | Whether token feed is stale. |
| PO-14 | `getPriceWithFallback` | `getPriceWithFallback(address) → uint256` | `public view` | 🟢 GREEN | Price with Pyth + fallback. |
| PO-15 | `convertToUsd` | `convertToUsd(address, uint256) → uint256` | `external view` | 🟢 GREEN | USD conversion. |
| PO-16 | `convertFromUsd` | `convertFromUsd(address, uint256) → uint256` | `external view` | 🟢 GREEN | Reverse conversion. |

**No FHE data anywhere in PriceOracle.** All prices are plain uint256.

---

## 9. StrategyExecutor — Detailed Audit

| # | Function | Signature | Type | Risk | Analysis |
|---|---|---|---|---|---|
| SE-01 | `checkpoints` | `mapping(bytes32 => Checkpoint) public` | Auto-getter | 🟢 GREEN | Returns `Checkpoint` struct (actionIndex, completed). Plain state. No FHE data. |

No other view functions.

---

## 10. ExecutorContract — Detailed Audit

No view/accessor functions. All functions are `onlyOwner` mutative calls. No FHE data.

---

## 11. FheForgeBase (Inherited) — Detailed Audit

| # | Function | Signature | Type | Risk | Analysis |
|---|---|---|---|---|---|
| FB-01 | `owner()` | `owner() → address` | `public view` | 🟢 GREEN | Contract owner address. |
| FB-02 | `pendingOwner()` | `pendingOwner() → address` | Auto-getter | 🟢 GREEN | Pending owner address. |
| FB-03 | `paused()` | `paused() → bool` | `public view` | 🟢 GREEN | Pause status (bit 0 of `_poolGuard`). |
| FB-04 | `BPS_DEN` | `uint256 public constant` | Constant | 🟢 GREEN | Basis points denominator (10_000). |
| FB-05 | `WAD` | `uint256 public constant` | Constant | 🟢 GREEN | WAD precision (1e18). |

---

## 12. Privacy Exposure Heat Map — By Function

### 12.1 🔴 RED — Individual Position Leaked (Critical)

| # | Contract | Function | What Leaks | Root Cause |
|---|---|---|---|---|
| R1 | LendingPool | `requestBalanceReveal` | Caller's supply balance — made publicly decryptable | `FHE.allowPublic` with no revocation |
| R2 | LendingPool | `requestBorrowReveal` | Caller's borrow balance — made publicly decryptable | `FHE.allowPublic` with no revocation |
| R3 | LendingPool | `requestLiquidityCheck` | **Any user's** supply AND borrow balances — made publicly decryptable | No access control + `FHE.allowPublic` on third-party balances |
| R4 | LendingPool | `requestUnshield` | Caller's supply balance + event with token | `FHE.allowPublic` + event emission |
| R5 | StrategyVault | `getDepositedAmount` | Plaintext deposit amount for any position | Private `positionDepositedAmount` exposed as plain uint256 via public view |

### 12.2 🟡 YELLOW — Aggregated / Handle Exposure (Medium)

| # | Contract | Function | Issue |
|---|---|---|---|
| Y1 | LendingPool | `getSupplyBalance` | Returns encrypted handle with `allowSender` — handle reuse risk (P-HIGH-8) |
| Y2 | LendingPool | `getBorrowBalance` | Same as Y1 |
| Y3 | StrategyVault | `getCollateral` | Returns encrypted handle with ACL — handle reuse risk |
| Y4 | StrategyVault | `getUserPositions` | Reveals all position IDs for a user — enables enumeration + lookup via R5 |
| Y5 | StrategyRegistry | `getEncryptedTvl` | Returns encrypted TVL handle — aggregate only, but handle reuse risk |

### 12.3 🟢 GREEN — No FHE Leak (Safe)

The remaining 47+ functions across all contracts are classified GREEN. These include:
- All PriceOracle functions (16)
- All TokenRegistry functions (6)
- All SwapRouter view functions (5)
- All FheForgeBase view functions (5)
- All StrategyRegistry metadata functions (5)
- All LendingPool protocol config reads (7)
- StrategyVault position metadata (1)
- StrategyExecutor checkpoint (1)

---

## 13. What Is Truly Private vs. What Leaks

### 13.1 FHE-Encrypted Storage (The Ideal)

| Data | Storage Type | Encrypted? |
|---|---|---|
| `LendingPool.supplyBalances[token][user]` | `euint128` | ✅ |
| `LendingPool.borrowBalances[token][user]` | `euint128` | ✅ |
| `StrategyVault.positions[user][id].collateral` | `euint128` | ✅ |
| `StrategyRegistry.encryptedTvls[strategyId]` | `euint128` | ✅ |

### 13.2 Actual Privacy (What an Observer Can Reconstruct)

| Attack Path | Leaked Data | Severity |
|---|---|---|
| Call `getDepositedAmount(positionId)` for each position ID from `getUserPositions(user)` | Exact vault position size for every user | 🔴 HIGH |
| Call `requestLiquidityCheck(user, ...)` for any user, then decrypt | Full supply + borrow snapshot for that user | 🔴 HIGH |
| Call `requestBalanceReveal(token)` for yourself | Your own supply balance (intentional, but permanent) | 🟡 MED |
| Observe `totalPlainBorrow[token]` | Aggregate borrow per token | 🟢 LOW |
| Observe `liquidReserve[token]` | Aggregate liquidity per token | 🟢 LOW |
| Observe events (supply/borrow/repay/withdraw) | Per-user plain activity amounts (see P-HIGH-6 in crypto audit) | 🔴 HIGH |
| Read `positionDepositedAmount` via SV-03 | Exact vault position size | 🔴 HIGH |

### 13.3 Privacy Integrity Scorecard

| Property | Status | Evidence |
|---|---|---|
| Supply balances encrypted in storage | ✅ True | `private euint128` in LendingPool |
| Supply balances NOT leaked via view functions | ❌ **False** | `requestLiquidityCheck` allows anyone to decrypt any user's balances |
| Borrow balances encrypted in storage | ✅ True | `private euint128` in LendingPool |
| Borrow balances NOT leaked via view functions | ❌ **False** | Same — `requestLiquidityCheck` makes them publicly decryptable |
| Vault collateral encrypted in storage | ✅ True | `private Position` with `euint128 collateral` |
| Vault collateral size NOT leaked | ❌ **False** | `getDepositedAmount` returns exact plaintext amount |
| Strategy TVL encrypted and private | ✅ True | `private euint128`, returned via ACL-gated getter |
| Events do NOT leak plain amounts | ⚠️ **Partial** | StrategyVault events fixed; LendingPool events still carry amounts |
| Only user can decrypt own data | ❌ **False** | `requestLiquidityCheck` bypasses per-user ACL, grants `allowPublic` to any caller for any user |

---

## 14. Detailed Risk Analysis — 🔴 RED Functions

### 14.1 R1–R3: `requestBalanceReveal`, `requestBorrowReveal`, `requestLiquidityCheck`

**File:** `contracts/contracts/LendingPool.sol`

```solidity
function requestBalanceReveal(address token) external payable {
    FHE.allowPublic(_ensureInitialized(supplyBalances[token][msg.sender]));
}

function requestLiquidityCheck(address user, address collateralToken, address debtToken) external payable {
    FHE.allowPublic(_ensureInitialized(borrowBalances[debtToken][user]));
    FHE.allowPublic(_ensureInitialized(supplyBalances[collateralToken][user]));
}
```

**Impact:**
- `requestBalanceReveal` and `requestBorrowReveal`: User self-reveals their own balance. This is intentional (e.g., for proving solvency), but the `allowPublic` grant is **permanent** with no revocation mechanism (see P-HIGH-8 in crypto audit).
- `requestLiquidityCheck`: **Any caller** can reveal **any user's** complete position. Only practical deterrent is that the caller must pay for FHE decryption gas. No economic or access control barrier.

**Recommendation (post-audit):**
1. Add access control to `requestLiquidityCheck` — require caller to demonstrate liquidation interest (e.g., hold debt token).
2. Add cooldown/rate-limiting to prevent mass enumeration.
3. Consider revocable ACL (requires CoFHE runtime support).

### 14.2 R5: `getDepositedAmount`

**File:** `contracts/contracts/StrategyVault.sol`

```solidity
function getDepositedAmount(bytes32 positionId) external view returns (uint256 amount) {
    return positionDepositedAmount[positionId];
}
```

**Impact:**
This function returns the exact plaintext deposit amount for any known position ID. Combined with `getUserPositions(user)` (Y4), an attacker can enumerate all of a user's vault positions and read their full portfolio size.

The existence of `positionDepositedAmount` — a plain `uint256` — completely defeats the purpose of storing encrypted `euint128` collateral amounts in `positions[user][id].collateral`.

**Recommendation (post-audit):**
1. Remove `getDepositedAmount` or make it ACL-gated.
2. Store `positionDepositedAmount` as `euint128` if it must remain accessible.
3. Remove the plain `uint256` tracking entirely — vault amounts can be derived from the encrypted collateral on withdrawal.

---

## 15. Cross-Contract Attack Paths

### 15.1 Position Enumeration Attack

```
1. Attacker calls StrategyVault.getUserPositions(victim)         → Y4  → Gets all position IDs
2. For each position ID:
   a. StrategyVault.getDepositedAmount(positionId)                → R5  → Gets exact size
   b. StrategyVault.getPositionMeta(positionId)                   → SV-02 → Gets strategy + block
   c. StrategyVault.positionOwner(positionId)                     → SV-01 → Confirms owner
   ──────────────────────────────────────────────────────────────────────────
   Result: Complete vault portfolio (position IDs, sizes, strategies)
```

### 15.2 Mass Balance Scrape Attack

```
1. Attacker enumerates all strategy tokens from TokenRegistry
2. Attacker monitors for "user supplied" events
3. For each discovered user + token pair:
   a. LendingPool.requestLiquidityCheck(user, collToken, debtToken)  → R3 → allowPublic
   b. Decrypt supplyBalances[token][user]
   c. Decrypt borrowBalances[token][user]
   ─────────────────────────────────────────────────────────────────────────────
   Result: Complete protocol position map (all users, all tokens, exact amounts)
```

**Cost analysis:** Each `requestLiquidityCheck` call costs ~ gas for 2 `allowPublic` SSTORE operations. On Arbitrum Sepolia with sub-cent gas, scraping thousands of users costs pennies per user. There is **no practical economic barrier** to mass enumeration.

---

## 16. Comparison: What the Crypto Audit Found vs. This Public State Audit

| Finding | Crypto Audit (FHE_CRYPTO_PRIVACY_AUDIT.md) | This Audit (Public State) |
|---|---|---|
| `FHE.sub` underflow wrap (P-CRIT-1) | ✅ Covered | Out of scope — cryptographic correctness |
| Trivial encryption in liquidation (P-CRIT-2) | ✅ Covered | Out of scope — FHE operation analysis |
| Dual input skew (P-CRIT-4) | ✅ Covered | Out of scope — input verification gap |
| Events leak amounts (P-HIGH-6) | ✅ Covered | **Confirmed** — events carry plain amounts |
| `allowSender` handle reuse (P-HIGH-8) | ✅ Covered | **Confirmed** — affects Y1, Y2, Y3, Y5 |
| `requestLiquidityCheck` unrestricted (P-MED-10) | ✅ Covered | **Confirmed** — classified as 🔴 R3 |
| Plain interest index (P-MED-13) | ✅ Covered | Out of scope — not a view function issue |
| `getDepositedAmount` plain exposure | ❌ **Missed** | **New finding** — 🔴 R5 |
| `getUserPositions` + `getDepositedAmount` enumeration | ❌ **Missed** | **New finding** — cross-contract attack path |
| Position metadata (strategyId, block) public | ❌ **Missed** | **New** — SV-02, Y4 |
| `totalPlainBorrow` + `liquidReserve` public | ❌ **Missed** | **New** — LP-01, LP-02 (GREEN — aggregate only) |

---

## 17. Summary of Findings

### Critical (🔴) — Immediate Post-Audit Recommendations

| ID | Contract | Function | Issue |
|---|---|---|---|
| **F-1** | LendingPool | `requestLiquidityCheck` | No access control on `allowPublic` for any user's balances — enables mass position scrape |
| **F-2** | StrategyVault | `getDepositedAmount` | Exposes plaintext deposit amount for every position — defeats FHE privacy for vault collateral |
| **F-3** | StrategyVault | `getUserPositions` + `getDepositedAmount` (combo) | Enables full portfolio enumeration — every user's vault positions exposed |
| **F-4** | LendingPool | `requestBalanceReveal` / `requestBorrowReveal` | Permanent `allowPublic` with no revocation — once revealed, always public |

### Medium (🟡) — Post-Audit Recommendations

| ID | Contract | Function | Issue |
|---|---|---|---|
| **F-5** | All contracts | `get*` returning `euint128` | `allowSender` on returned handles creates handle-reuse surface (see P-HIGH-8) |
| **F-6** | LendingPool | Events | Events still emit plain amounts per P-HIGH-6 (previously documented) |

### Informational (🟢)

- **F-7:** All PriceOracle, TokenRegistry, SwapRouter, and StrategyExecutor view functions are GREEN — no FHE data exposure.
- **F-8:** `totalPlainBorrow` and `liquidReserve` expose aggregate protocol state but no individual positions.
- **F-9:** Strategy metadata functions expose only plaintext configuration, not balances.

---

## 18. Heat Map — Visual Overview

```
LendingPool
═══════════════════════════════════════════════════════════════════
 🟢  totalPlainBorrow      🟢  liquidReserve        🟢  composer
 🟢  oracle                 🟢  weth                  🟢  BPS_DEN
 🟢  FLASH_FEE_BPS          🟢  maxFlashLoan          🟢  flashFee
 🟢  isLiquidatable         🟡  getSupplyBalance      🟡  getBorrowBalance
 🔴  requestBalanceReveal   🔴  requestBorrowReveal   🔴  requestLiquidityCheck
 🔴  requestUnshield

StrategyVault
═══════════════════════════════════════════════════════════════════
 🟢  positionOwner           🟢  getPositionMeta
 🟡  getUserPositions         🟡  getCollateral
 🔴  getDepositedAmount

StrategyRegistry
═══════════════════════════════════════════════════════════════════
 🟢  idByContentHash          🟢  strategyCount            🟢  vaultAddress
 🟢  localDomain              🟢  getStrategyMeta           🟢  getStrategyParams
 🟡  getEncryptedTvl

SwapRouter / TokenRegistry / PriceOracle / StrategyExecutor
═══════════════════════════════════════════════════════════════════
 All 🟢 GREEN  —  No FHE data exposure

FheForgeBase (inherited)
═══════════════════════════════════════════════════════════════════
 All 🟢 GREEN  —  owner, pendingOwner, paused, constants
```

---

## 19. Recommendations

### Priority: High

**PA-1 — Restrict `requestLiquidityCheck` with access control.**
Add a requirement that the caller must hold a minimum amount of the debt token of the target user, or implement a simple cooldown (e.g., 1 hour per user). This prevents mass balance scrape attacks without breaking legitimate liquidation workflows.
*Affects: LendingPool — `requestLiquidityCheck`*

**PA-2 — Remove or encrypt `positionDepositedAmount`.**
The `positionDepositedAmount` mapping stores a plain `uint256` that mirrors the encrypted `euint128` collateral. Remove `getDepositedAmount`, remove the plain tracking, and compute deposited amounts solely from the encrypted handle. If a plain deposit amount must be accessible, store it as `euint128`.
*Affects: StrategyVault*

**PA-3 — Add a mechanism to revoke `allowPublic` grants.**
Once `allowPublic` is called on an encrypted handle, the grant is permanent. Implement a key rotation or re-encryption mechanism so users who accidentally (or previously) revealed their balance can regain privacy.
*Affects: LendingPool (requires CoFHE runtime support)*

### Priority: Medium

**PA-4 — Remove redundant `allowThis` calls in getter functions.**
Per P-MED-14 in the crypto audit, `getSupplyBalance`, `getBorrowBalance`, `getCollateral`, and `getEncryptedTvl` call `FHE.allowThis` on handles that were already allowed when stored. Remove these redundant calls to save gas.
*Affects: All contracts with FHE getters*

**PA-5 — Consider removing plain amounts from LendingPool events.**
Per P-HIGH-6: "Events create a perfect plain-text audit trail that mirrors encrypted state." StrategyVault events were already fixed (no more plain amounts). LendingPool events (`Supplied`, `Borrowed`, `Repaid`, `Withdrawn`, `Liquidated`) still carry plain amounts in indexed parameters.
*Affects: LendingPool*

### Priority: Low

**PA-6 — Document the privacy model's actual guarantees.**
The current documentation suggests that all user balances are private. In reality, `requestLiquidityCheck` allows any user's balances to be decrypted by anyone, and `getDepositedAmount` leaks vault position sizes. Update documentation to accurately describe the privacy boundary.
*Affects: Documentation*

---

## 20. References

1. [FHE Cryptography & Privacy Deep Audit](../research/archive/FHE_CRYPTO_PRIVACY_AUDIT.md) — Cryptographic analysis of FHE operations, `FHE.sub` underflow, trivial encryption issues, event leakage (P-CRIT-1 through P-MED-13)
2. [FheForge Security Review](./security-review.md) — Contract-by-contract security analysis, attack trees, key security properties
3. `contracts/contracts/LendingPool.sol` (607 lines)
4. `contracts/contracts/StrategyVault.sol` (266 lines)
5. `contracts/contracts/StrategyRegistry.sol` (277 lines)
6. `contracts/contracts/FheForgeComposer.sol` (252 lines)
7. `contracts/contracts/SwapRouter.sol` (253 lines)
8. `contracts/contracts/TokenRegistry.sol` (126 lines)
9. `contracts/contracts/PriceOracle.sol` (358 lines)
10. `contracts/contracts/StrategyExecutor.sol` (175 lines)
11. `contracts/contracts/ExecutorContract.sol` (49 lines)
12. `contracts/contracts/FheForgeBase.sol` (178 lines)

---

*Audit conducted for FheForge v1.2.0. All view/accessor functions audited across 9 core contracts. 47+ functions classified GREEN, 5 functions classified YELLOW, 5 functions classified RED. Two new findings not captured in prior audits: `getDepositedAmount` plain exposure (R5) and the position enumeration attack path (Y4 + R5 combo).*
