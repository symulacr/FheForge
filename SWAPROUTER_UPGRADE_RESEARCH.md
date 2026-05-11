# SwapRouter Upgrade Research & DeFi Integration Strategy

**Date**: 2026-05-10
**Scope**: Arb-Sepolia (421614) testnet + mainnet planning
**Status**: Research complete, NO EDITS applied (per user request)

---

## 1. Current Architecture

### SwapRouter (Intent-Based Model)
- **Address**: `0x4242C57920C2c5AA7b18909a5D07E311CF5D6211`
- **Pattern**: User submits `SwapIntent` (tokenIn, tokenOut, amountIn, minAmountOut, deadline) → tokens escrowed → trusted `executor` EOA fills intent off-chain → releases escrowed tokenIn to executor, transfers tokenOut to user
- **Pros**: Simple, gas-efficient for users, no on-chain DEX dependency
- **Cons**: Centralized executor, no MEV protection, manual fulfillment, no price discovery

### ExecutorContract
- **Address**: `0x8486E8Af266509D937B5241756d0023375504774`
- **Role**: Protocol-owned executor, calls `SwapRouter.executeIntent(intentId, outputAmount)`
- **Funding**: Must hold tokenOut and have pre-approved spending on SwapRouter

### Composer Integration
- Composer calls `ROUTER.submitSwapIntent(borrowToken, swapTokenOut, swapAmountIn, swapMinOut, swapDeadlineOffset)` after borrowing from LendingPool
- Swap is part of leveraged strategy flow: borrow → swap → deposit as collateral

---

## 2. DEX Aggregator Options on Arb-Sepolia

### 2a. 0x / Matcha API (RECOMMENDED for testnet)

| Aspect | Detail |
|--------|--------|
| **Endpoint** | `https://sepolia.api.0x.org/swap/allowance-holder/quote` |
| **Chain** | `chainId=421614` ✅ |
| **Auth** | API key required (free tier available) |
| **Pattern** | Off-chain quote → on-chain settlement via AllowanceHolder contract |
| **Flow** | 1. User approves `allowanceTarget` once per token 2. GET `/quote` → returns `tx.data`, `tx.to`, `tx.value` 3. User submits tx → AllowanceHolder pulls tokens, executes swap |
| **Gasless** | No (user pays gas) |
| **Sources** | Aggregates AMM + RFQ across Uniswap, SushiSwap, Curve, etc. |
| **Slippage** | Configurable via `slippagePercentage` param |
| **FHE compat** | ✅ — SwapRouter receives plain tokens from pool borrow, swap itself doesn't involve FHE types |

### 2b. 1inch API v6

| Aspect | Detail |
|--------|--------|
| **Endpoint** | `https://api.1inch.dev/swap/v6.0/421614/quote` |
| **Chain** | `421614` ✅ (confirmed) |
| **Auth** | API key required (developer portal) |
| **Pattern** | Off-chain quote + calldata generation → on-chain execution |
| **Gasless** | Some paths via GosuMapper |
| **Sources** | Meta-aggregates across all major DEXs |
| **FHE compat** | ✅ |

### 2c. Relay.link API

| Aspect | Detail |
|--------|--------|
| **Testnet endpoint** | `https://api.testnets.relay.link` |
| **Testnet chains** | Base-Sepolia (84532), Sepolia (11155111) only |
| **Arb-Sepolia** | ❌ NOT supported on testnet |
| **Mainnet** | `https://api.relay.link` — supports 85+ chains including Arbitrum One |
| **Pattern** | `/quote` (POST) → `/execute` (POST, gasless via ERC-4337/EIP-7702) |
| **Gasless** | ✅ on mainnet |
| **FHE compat** | ✅ |
| **Verdict** | Useless for testnet; viable for mainnet migration |

### 2d. Uniswap V3 SwapRouter02 (Direct)

| Aspect | Detail |
|--------|--------|
| **Arb-Sepolia address** | `0x101F443B4d1b059569D643917553c771E1b9663E` |
| **Universal Router** | `0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2` |
| **Factory** | `0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e` |
| **WETH** | `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73` (Uniswap version) |
| **Pool liquidity** | WETH/USDC exists but VERY LOW (~$100s) |
| **Integration** | `ISwapRouter.ExactInputSingleParams` + `exactInputSingle()` from external contract |
| **FHE compat** | ✅ — our contract calls `exactInputSingle`, plain amounts only |
| **Verdict** | Best for production; pool liquidity issue on testnet |

---

## 3. Pyth Oracle — Live Price Feeds (Arb-Sepolia Compatible)

**Pyth contract on arb-sepolia**: `0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF`

All feeds verified live from Hermes (`hermes.pyth.network`) on 2026-05-10:

| Token | Feed ID | Live Price | Status |
|-------|---------|------------|--------|
| **WETH/USD** | `ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` | $2,339.15 | ✅ LIVE |
| **USDC/USD** | `eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` | $0.9999 | ✅ LIVE (canonical) |
| **WBTC/USD** | `c9d8b075a5c69303365ae23633d4e085199bf5c520a3b90fed1322a0342ffc33` | $81,771.39 | ✅ LIVE |
| **ARB/USD** | `3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5` | $0.1421 | ✅ LIVE |
| **OP/USD** | `d54d8d4e3774ea53660e660ecd03aa9daa31eed9b7e67d1a2aed3095b3e6720d` | $115.58 | ✅ LIVE |
| **LINK/USD** | `8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221` | $10.67 | ✅ LIVE |
| **SOL/USD** | `55f8289be7450f1ae564dd9798e49e7d797d89adbc54fe4f8c906b1fcb94b0c3` | $109.02 | ✅ LIVE |
| **AVAX/USD** | `93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7` | $10.20 | ✅ LIVE |
| **DOGE/USD** | `7eab5e260e42d81013207e623be60c66c9c55bfe0ace4797ad00d1c5a1335eae` | $0.1116 | ✅ LIVE |
| **DAI/USD** | `710659c5a68e2416ce4264ca8d50d34acc20041d91289110eea152c52ff3dc39` | $1.1757 | ✅ LIVE |
| **CRV/USD** | `a19d04ac696c7a6616d291c7e5d1377cc8be437c327b75adb5dc1bad745fcae8` | $0.2849 | ✅ LIVE |
| **USDT/USD** | `7e10170c23d7df62d301b2ade26854200ee584f3f3b84cb2e5195adf35c5b97f` | $1.1268 | ✅ LIVE |
| **UNI/USD** | `78d185a741d07edb3412b09008b7c5cfb9bbbd7d568bf00ba737b456ba171501` | $3.91 | ✅ LIVE |
| **GMX/USD** | `b962539d0fcb272a494d65ea56f94851c2bcf8823935da05bd628916e2e9edbf` | $7.61 | ✅ LIVE |
| **SHIB/USD** | `f0d57deca57b3da2fe63a493f4c25925fdfd8edf834b20f93e1f84dbd1504d4a` | $0.000007 | ✅ LIVE |

**Key correction**: USDC/USD canonical feed (`eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a`) IS LIVE at $0.9999 from Hermes. This contradicts prior finding that "no testnet USDC/USD feed exists". The PriceOracle should use this feed instead of $1 fallback.

---

## 4. Testnet Faucets (Arb-Sepolia)

| Faucet | Amount | Cooldown | Auth |
|--------|--------|----------|------|
| **GetBlock** | 0.1 ETH | 24hr | Email/API key |
| **Alchemy** | 0.01 ETH | 12hr | Social auth |
| **QuickNode** | Variable | 12hr | Social auth |
| **L2 Faucet** | Variable | Unlimited | Device attestation |
| **Chainlink** | LINK + ETH | 24hr | Social auth |
| **Circle USDC** | 20 USDC | 2hr | Social auth |
| **ETHGlobal** | Multi-chain | 24hr | Social auth |

---

## 5. Lend/Borrow/Repay Predicate Strategy

### Problem
Current FHE architecture encrypts balances but DeFi operations need price-dependent logic (LTV checks, health checks, liquidation). The "predicate" challenge: how to verify encrypted state conditions on-chain without decrypting?

### Current FheForge Approach (Wave24)

```
User → shield(token, encrypted_amount)
     → LendingPool: supplyBalances[user][token] += encrypted_amount
     → FHE.eq(encrypted_amount, plain_amount) verifies equality

User → borrowWithLtvCheck(token, encrypted_borrow, collateralToken)
     → LendingPool: encrypted health check via FHE.select
     → Product comparison: encrypted_borrow * price ≤ encrypted_collateral * price * ltv
     → If health passes: borrowBalances[user][token] += encrypted_borrow
     → Transfer plain tokens to user

User → repayDebt(token, encrypted_amount)
     → FHE.eq(encrypted_amount, plain_transfer) verifies equality
     → borrowBalances[user][token] -= encrypted_amount

Liquidation → liquidateWithProof(proof)
     → Off-chain decrypt of borrower position
     → Proof verified via verifyDecryptResult
     → Uses stored encrypted handles (not re-encrypted)
```

### Low-Friction Strategy (Proposed)

**Goal**: Minimize tx count, eliminate redundant encryption ops, keep FHE at core.

**1. Batch Shield+Supply**
Single tx: user calls `shield(token, encrypted_amount)` → `supplyBalances` += encrypted → ERC20 pulled in one call. Already implemented.

**2. Predicate-Checked Borrow**
Single tx: `borrowWithLtvCheck(token, encrypted_borrow, collateralToken)` performs FHE health check inline. No separate "check then borrow" — it's atomic. Already implemented.

**3. Atomic Repay+Unshield**
Proposed: `repayAndUnshield(debtToken, encrypted_repay, collateralToken, encrypted_unshield)` — single tx that:
1. Verifies both encrypted amounts vs plain transfers
2. Decrements borrow balance
3. Decrements supply balance
4. Transfers both tokens out

This eliminates 2 tx into 1. Currently requires separate `repayDebt` + `partialUnshield` calls.

**4. Intent-Based Swap with Encrypted Slippage**
Current: `submitSwapIntent(plain_amountIn, plain_minAmountOut)` — all plain.
Enhanced: `submitSwapIntent(encrypted_amountIn, encrypted_minAmountOut)` — FHE.select on execution to verify output ≥ minAmountOut without revealing either value. Requires executor to receive encrypted proof of output amount.

**5. Leveraged Strategy in Single Tx**
Current: `openLeveragedStrategy` already does borrow → swap → deposit atomically via Composer. Good.

**6. Cross-Contract FHE Handle Passing**
Composer receives `euint128` from Pool, calls `allowTransient(handle, vault_address)`, passes handle to Vault. Already implemented and working (Wave24).

---

## 6. SwapRouter Upgrade Decision Matrix

| Option | Testnet Viability | Mainnet Viability | Effort | Centralization | FHE Compat |
|--------|-------------------|-------------------|--------|---------------|------------|
| **Keep Intent Model** | ✅ | ✅ | None | High (executor) | ✅ |
| **0x/Matcha API** | ✅ | ✅ | Medium (off-chain quote, on-chain settle) | Low (aggregator) | ✅ |
| **1inch API** | ✅ (API key) | ✅ | Medium | Low | ✅ |
| **Uniswap V3 Direct** | ⚠️ (low liquidity) | ✅ | Low (one function call) | None (DEX) | ✅ |
| **Relay.link** | ❌ (no arb-sepolia) | ✅ | Medium | Low | ✅ |
| **Hybrid (Intent + DEX fallback)** | ✅ | ✅ | High | Medium | ✅ |

### Recommendation

**Phase 1 (Testnet)**: Add Uniswap V3 `exactInputSingle` as direct swap path in SwapRouter. Keep intent model as fallback. This gives on-chain price discovery without API dependency.

**Phase 2 (Mainnet)**: Integrate 0x/Matcha API for best price routing across all DEXs. Keep Uniswap direct as fallback for when API is unavailable.

**Phase 3 (Optional)**: Relay.link for gasless cross-chain swaps on mainnet.

---

## 7. Pyth Feed Integration Action Items

1. **Fix USDC/USD feed**: Replace $1 fallback with canonical Pyth feed `eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` — it IS live at $0.9999
2. **Add WBTC/USD**: `c9d8b075a5c69303365ae23633d4e085199bf5c520a3b90fed1322a0342ffc33` — $81,771
3. **Add ARB/USD**: `3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5` — $0.1421
4. **Add LINK/USD**: `8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221` — $10.67
5. **Add DAI/USD**: `710659c5a68e2416ce4264ca8d50d34acc20041d91289110eea152c52ff3dc39` — $1.18
6. **Add remaining as needed**: UNI, GMX, OP, SOL, AVAX, DOGE, CRV, SHIB, USDT all have live feeds
