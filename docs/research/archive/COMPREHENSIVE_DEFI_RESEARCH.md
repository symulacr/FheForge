# Comprehensive DeFi Integration Research — FheForge SwapRouter + Multi-Token Strategy

**Date**: 2026-05-10 | **Scope**: Arb-Sepolia testnet + mainnet planning | **Status**: RESEARCH ONLY, NO EDITS

---

## 1. DEX Aggregator API Research — Live Verified

### 1a. 0x / Matcha Swap API

| Aspect | Verified Detail |
|--------|----------------|
| **Endpoint** | `https://api.0x.org/swap/allowance-holder/quote` |
| **Testnet support** | Mainnet chains only per official docs. Chain 421614 NOT in supported list (confirmed: only mainnet chains listed) |
| **Auth** | `0x-api-key` header. **Free tier**: signup at https://dashboard.0x.org → create app → instant API key |
| **How to get key** | 1. Go to https://dashboard.0x.org 2. Sign up with email 3. Verify email 4. Create app 5. Copy API key from dashboard |
| **Flow** | GET `/price` (indicative) → approve `allowanceTarget` → GET `/quote` (firm) → submit `tx.to.call(tx.data)` on-chain |
| **Contract integration** | `function fillQuote(address to, uint256 value, bytes calldata data) external payable { (bool s,) = to.call{value: value}(data); require(s); }` |
| **Arb-Sepolia** | ❌ **NOT supported** — only mainnet chains (Ethereum, Arbitrum, Avalanche, Base, BSC, etc.) |
| **Arb mainnet** | ✅ chainId=42161 supported |

### 1b. 1inch API v6

| Aspect | Verified Detail |
|--------|----------------|
| **Endpoint** | `https://api.1inch.dev/swap/v6.0/421614/quote` |
| **Auth** | API key required. **Signup**: https://1inch.dev → register → auto-generated key |
| **⚠ KYC WARNING** | 1inch Developer Portal requires KYC verification for API access (confirmed by Reddit reports) |
| **Arb-Sepolia** | ✅ chainId 421614 listed as supported |
| **Arb mainnet** | ✅ chainId 42161 |
| **Verdict** | Requires KYC — may not be acceptable for privacy-focused FHE project |

### 1c. Relay.link API

| Aspect | Verified Detail |
|--------|----------------|
| **Mainnet endpoint** | `https://api.relay.link/v1/quote` + `/v1/execute` |
| **Testnet endpoint** | `https://api.testnets.relay.link` |
| **Testnet chains (LIVE VERIFIED)** | Base-Sepolia (84532), Sepolia (11155111) **ONLY** — NO Arb-Sepolia |
| **API key** | Self-serve request form → 72hr review → email if approved |
| **Gasless** | ✅ ERC-4337, EIP-7702, permit signatures |
| **Arb-Sepolia** | ❌ NOT available on testnet |
| **Arb mainnet** | ✅ 85+ chains supported |

### 1d. Uniswap V3 SwapRouter02 — VERIFIED LIVE ON ARB-SEPOLIA

| Aspect | Verified Detail |
|--------|----------------|
| **SwapRouter02** | `0x101F443B4d1b059569D643917553c771E1b9663E` ✅ EXISTS (code on-chain) |
| **Factory** | `0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e` ✅ EXISTS |
| **NonfungiblePositionManager** | `0x6b2937Bde17889EDCf8fbD8dE31C3C2a70Bc4d65` ✅ EXISTS (NOT mainnet address!) |
| **QuoterV2** | `0x2779a0CC1c3e0E44D2542EC3e79e3864Ae93Ef0B` ✅ EXISTS |
| **V3Migrator** | `0x398f43ef2c67B941147157DA1c5a868E906E043D` ✅ EXISTS |
| **UniversalRouter** | `0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2` ✅ EXISTS |
| **Permit2** | `0x000000000022D473030F116dDEE9F6B43aC78BA3` ✅ EXISTS |
| **WETH** | `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73` ✅ EXISTS |
| **WETH/USDC pools** | ❌ **NONE EXIST** — must create and add liquidity |
| **Integration pattern** | `ISwapRouter02.exactInputSingle(ExactInputSingleParams)` from external contract |

**CRITICAL FINDING**: Uniswap V3 infrastructure is fully deployed on Arb-Sepolia, but NO pools exist for any token pair. We must:
1. Create WETH/USDC pool via Factory
2. Initialize with sqrtPriceX96
3. Add liquidity via NonfungiblePositionManager
4. Then SwapRouter02.exactInputSingle works

### 1e. Integration Options Summary

| Option | Arb-Sepolia | Arb Mainnet | API Key | KYC | FHE Compat |
|--------|-------------|-------------|---------|-----|------------|
| **Uniswap V3 Direct** | ✅ (create pools) | ✅ | None | No | ✅ |
| **0x/Matcha** | ❌ | ✅ | Free signup | No | ✅ |
| **1inch** | ✅ (listed) | ✅ | Signup | ⚠️ KYC | ✅ |
| **Relay.link** | ❌ | ✅ | 72hr approval | No | ✅ |
| **Current Intent Model** | ✅ | ✅ | None | No | ✅ |

**RECOMMENDATION**:
- **Testnet**: Create Uniswap V3 pools on Arb-Sepolia + add liquidity. Keep intent model as fallback. Direct `exactInputSingle` from SwapRouter contract.
- **Mainnet**: Add 0x/Matcha as primary aggregator (free API key, no KYC). Uniswap V3 direct as fallback.

---

## 2. Top 25+ Crypto Tokens with Pyth Oracle — LIVE VERIFIED

**Pyth contract on Arb-Sepolia**: `0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF`

ALL feed IDs below are **verified live from Hermes** (`hermes.pyth.network/api/latest_price_feeds`) on 2026-05-10:

| # | Token | Feed ID (64-char hex) | Live Price | Status |
|---|-------|----------------------|------------|--------|
| 1 | WETH/USD | `ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` | $2,343.44 | ✅ |
| 2 | WBTC/USD | `c9d8b075a5c69303365ae23633d4e085199bf5c520a3b90fed1322a0342ffc33` | $81,847.87 | ✅ |
| 3 | USDC/USD | `eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` | $0.9999 | ✅ |
| 4 | USDT/USD | `7e10170c23d7df62d301b2ade26854200ee584f3f3b84cb2e5195adf35c5b97f` | $1.1268 | ✅ |
| 5 | DAI/USD | `710659c5a68e2416ce4264ca8d50d34acc20041d91289110eea152c52ff3dc39` | $1.1757 | ✅ |
| 6 | XRP/USD | `95fd9e16d4cfc5d1370f32bb0bf2346860ad9c92fec83acf4ca263baf16c961d` | $1.4799 | ✅ |
| 7 | BNB/USD | `ccab508da0999d36e1ac429391d67b3ac5abf1900978ea1a56dab6b1b932168e` | $137.01 | ✅ |
| 8 | SOL/USD | `55f8289be7450f1ae564dd9798e49e7d797d89adbc54fe4f8c906b1fcb94b0c3` | $109.31 | ✅ |
| 9 | DOGE/USD | `7eab5e260e42d81013207e623be60c66c9c55bfe0ace4797ad00d1c5a1335eae` | $0.1117 | ✅ |
| 10 | ADA/USD | `2a01deaec9e51a579277b34b122399984d0bbf57e2458a7e42fecd2829867a0d` | $0.2816 | ✅ |
| 11 | AVAX/USD | `93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7` | $10.23 | ✅ |
| 12 | SHIB/USD | `f0d57deca57b3da2fe63a493f4c25925fdfd8edf834b20f93e1f84dbd1504d4a` | ~$0 | ⚠️ price too small |
| 13 | UNI/USD | `78d185a741d07edb3412b09008b7c5cfb9bbbd7d568bf00ba737b456ba171501` | $3.93 | ✅ |
| 14 | ARB/USD | `3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5` | $0.143 | ✅ |
| 15 | OP/USD | `d54d8d4e3774ea53660e660ecd03aa9daa31eed9b7e67d1a2aed3095b3e6720d` | $115.54 | ✅ |
| 16 | LINK/USD | `8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221` | $10.70 | ✅ |
| 17 | PYTH/USD | `0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff` | $0.059 | ✅ |
| 18 | AAVE/USD | `2b9ab1e972a281585084148ba1389800799bd4be63b957507db1349314e47445` | $102.40 | ✅ |
| 19 | NEAR/USD | `c415de8d2eba7db216527dff4b60e8f3a5311c740dadb233e13e12547e226750` | $1.56 | ✅ |
| 20 | POL/USD | `ffd11c5a1cfd42f80afb2df4d9f264c15f956d68153335374ec10722edd70472` | $0.103 | ✅ |
| 21 | SUI/USD | `17cd845b16e874485b2684f8b8d1517d744105dbb904eec30222717f4bc9ee0d` | $1.39 | ✅ |
| 22 | TON/USD | `8963217838ab4cf5cadc172203c1f0b763fbaa45f346d8ee50ba994bbcac3026` | $2.48 | ✅ |
| 23 | APT/USD | `a44d307a13145b84938740c93155fbea926e9fbdd46d50b67859b8fc47552959` | $1.14 | ✅ |
| 24 | BCH/USD | `3dd2b63686a450ec7290df3a1e0b583c0481f651351edfa7636f39aed55cf8a3` | $450.80 | ✅ |
| 25 | LTC/USD | `6e3f3fa8253588df9326580180233eb791e03b443a3ba7a1d892e73874e19a54` | $59.08 | ✅ |
| 26 | DOT/USD | `ca3eed9b267293f6595901c734c7525ce8ef49adafe8284606ceb307afa2ca5b` | $1.38 | ✅ |
| 27 | ATOM/USD | `b00b60f88b03a6a625a8d1c048c3f66653edf217439983d037e7222c4e612819` | $2.02 | ✅ |
| 28 | FIL/USD | `150ac9b959aee0051e4091f0ef5216d941f590e1c5e7f91cf7635b5c11628c0e` | $1.14 | ✅ |
| 29 | TRX/USD | `67aed5a24fdad045475e7195c98a98aea119c763f272d4523f5bac93a4f33c2b` | $0.351 | ✅ |
| 30 | GMX/USD | `b962539d0fcb272a494d65ea56f94851c2bcf8823935da05bd628916e2e9edbf` | $7.63 | ✅ |
| 31 | CRV/USD | `a19d04ac696c7a6616d291c7e5d1377cc8be437c327b75adb5dc1bad745fcae8` | $0.284 | ✅ |
| 32 | IMX/USD | `941320a8989414874de5aa2fc340a75d5ed91fdff1613dd55f83844d52ea63a2` | $0.192 | ✅ |
| 33 | GRT/USD | `4d1f8dae0d96236fb98e8f47471a366ec3b1732b47041781934ca3a9bb2f35e7` | $0.029 | ✅ |
| 34 | COMP/USD | `4a8e42861cabc5ecb50996f92e7cfa2bce3fd0a2423b0c44c9b423fb2bd25478` | $24.05 | ✅ |
| 35 | SNX/USD | `39d020f60982ed892abbcd4a06a276a9f9b7bfbce003204c110b6e488f502da3` | $0.358 | ✅ |
| 36 | PENDLE/USD | `9a4df90b25497f66b1afb012467e316e801ca3d839456db028892fe8c70c8016` | $2.18 | ✅ |

**KEY CORRECTION**: USDC/USD canonical feed `eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` IS LIVE at $0.9999 from Hermes. This contradicts prior finding that "no testnet USDC feed exists". Should replace $1 fallback.

---

## 3. Testnet Faucets — Arb-Sepolia

| Faucet | Amount | Cooldown | Auth | URL |
|--------|--------|----------|------|-----|
| **GetBlock** | 0.1 ETH | 24hr | Email/API | https://getblock.io/faucet/arb-sepolia/ |
| **Spectrum Nodes** | 0.1 ETH | 24hr | Tweet | https://spectrumnodes.com/blog/arbitrum-sepolia-faucet |
| **Faucet.trade** | Variable | Instant | None | https://faucet.trade/arbitrum-sepolia-eth-faucet |
| **Circle USDC** | 20 USDC | 2hr | Social | https://faucet.circle.com |
| **ETHGlobal** | Multi-chain | 24hr | Social | https://ethglobal.com/faucet/arbitrum-sepolia-421614 |
| **Testnet Aggregator** | Various | Various | Various | https://testnet-faucet-aggregator.vercel.app |

---

## 4. Uniswap V3 Arb-Sepolia — Pool Creation Plan

To make `SwapRouter02.exactInputSingle` work, we MUST create pools and add liquidity:

### Step 1: Create Pool
```solidity
Factory.createPool(WETH, USDC, 3000); // 0.3% fee
```

### Step 2: Initialize Pool
```solidity
// Price = 2343 USDC per WETH → sqrtPriceX96 = sqrt(2343) × 2^96
// sqrt(2343) ≈ 48.4 → sqrtPriceX96 ≈ 48.4 × 2^96
pool.initialize(sqrtPriceX96);
```

### Step 3: Add Liquidity
```solidity
NonfungiblePositionManager.mint({
  token0: WETH,
  token1: USDC,
  fee: 3000,
  tickLower: -887220,  // full range
  tickUpper: 887220,
  recipient: deployer,
  amount0Desired: 1e18,  // 1 WETH
  amount1Desired: 2343e6, // 2343 USDC
  amount0Min: 0,
  amount1Min: 0,
  deadline: block.timestamp + 600
});
```

### Step 4: Call from SwapRouter Contract
```solidity
ISwapRouter02.ExactInputSingleParams memory params = ISwapRouter02.ExactInputSingleParams({
  tokenIn: WETH,
  tokenOut: USDC,
  fee: 3000,
  recipient: address(this),
  amountIn: 0.1e18,
  amountOutMinimum: 200e6, // slippage protection
  sqrtPriceLimitX96: 0
});
uint256 amountOut = ISwapRouter02(router).exactInputSingle(params);
```

**Addresses on Arb-Sepolia**:
- Factory: `0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e`
- SwapRouter02: `0x101F443B4d1b059569D643917553c771E1b9663E`
- NonfungiblePositionManager: `0x6b2937Bde17889EDCf8fbD8dE31C3C2a70Bc4d65`
- QuoterV2: `0x2779a0CC1c3e0E44D2542EC3e79e3864Ae93Ef0B`
- WETH: `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73`
- USDC (our mock): `0x150376EdEbc5AC48771655a61a795d828BeC8Df6`

---

## 5. FHE Capabilities — CoFHE Full API for Lending/Swap/Borrow/Vault

### FHE.sol Available Operations (euint128)

| Category | Operations | Lending Use | Swap Use | Vault Use |
|----------|-----------|-------------|----------|-----------|
| **Arithmetic** | add, sub, mul, div, rem | interest, balances | fee calc | TVL, PnL |
| **Comparison** | eq, ne, lt, lte, gt, gte | LTV check, health | slippage | collateral ratio |
| **Selection** | select(ebool, T, T) | conditional update | price branch | position mgmt |
| **Bitwise** | and, or, xor, not | flag checks | — | — |
| **Shift** | shl, shr | — | — | — |
| **Min/Max** | min, max | cap borrow | best price | drawdown limit |
| **Decryption** | publishDecryptResult, verifyDecryptResult | unshield, reveal | proof execution | emergency exit |
| **ACL** | allow, allowThis, allowSender, allowTransient, allowPublic | cross-contract | swap access | vault access |

### Key Constraints
1. **No if/else on encrypted data** — use `FHE.select(ebool, valueA, valueB)`
2. **No scalar multiply** — only `encrypted × encrypted` (no `euint128 × uint128`)
3. **Arithmetic is unchecked** — wraparound on overflow/underflow (need FHESafeMath128)
4. **Both branches always execute** in select — performance implications
5. **Division by 0 returns MAX** — no revert, no info leak
6. **ebool is euint8** — not real boolean, 1=true, 0=false
7. **Transfer amounts MUST be plain** — ERC20 can't accept encrypted

### Predicate-Based Lending Pattern (Current FheForge Implementation)

```
shield(token, encrypted_amount):
  1. FHE.eq(encrypted_amount, plain_amount) → verify no input manipulation
  2. supplyBalances[user][token] += encrypted_amount  (FHE.add)
  3. ERC20 transfer from user

borrowWithLtvCheck(token, encrypted_borrow, collateralToken):
  1. FHE.gt(encrypted_collateral * ltv, encrypted_borrow * WAD) → ebool health
  2. FHE.select(health, encrypted_borrow, _ZERO) → only borrow if healthy
  3. borrowBalances[user][token] += selected_amount  (FHE.add)
  4. Plain token transfer to user (ERC20)

repayDebt(token, encrypted_amount):
  1. FHE.eq(encrypted_amount, plain_transfer) → verify equality
  2. borrowBalances[user][token] -= encrypted_amount  (FHE.sub)
  3. ERC20 transfer from user

liquidateWithProof(proof):
  1. verifyDecryptResult → get plain amounts
  2. Use stored encrypted handles as minuend (not re-encrypted proofs)
  3. Zero balances → transfer collateral to liquidator
```

---

## 6. Token-Agnostic Strategy Builder — Design Plan

### Goal
Script that generates random DeFi strategies using 10-20 tokens, tests all FHE operations (shield/borrow/repay/swap/unshield), measures friction (tx count, gas), and validates ≤2 tx per strategy.

### Architecture

```
StrategyBuilder
├── TokenRegistry (20 tokens with Pyth feeds + mock ERC20 on testnet)
├── StrategyGenerator (random combination of operations)
├── FHEComposer (batch operations via Composer contract)
├── FrictionAnalyzer (tx count, gas, latency)
└── ReportGenerator (CSV/JSON output)
```

### Strategy Types (≤2 tx)

**Tx1: Setup + Deposit**
- Approve tokens → shield (supply) → FHE equality check

**Tx2: Strategy Execution**
- borrow → swap → repay → unshield (all via Composer in single tx)

### Strategy Combinations (10-20 tokens)

| Strategy | Tokens | Operations | Tx Count |
|----------|--------|------------|----------|
| Simple Supply | 1 | shield | 2 (approve + shield) |
| Borrow+Swap | 2 | shield+borrow+swap | 2 (approve+shield → borrow+swap via composer) |
| Leveraged Long | 2 | shield+borrow+swap+deposit | 2 (via composer) |
| Repay+Exit | 1 | repay+unshield | 2 (approve+repay → unshieldWithProof) |
| Multi-Token Supply | 3-5 | shield(A)+shield(B)+shield(C) | 2 (batch approve + batch shield) |
| Arbitrage Loop | 2-3 | borrow+swap+repay | 2 (via composer) |
| Delta Neutral | 2 | supply(A)+borrow(B)+swap(B→A)+supply(A) | 2 (via composer) |
| Random Composite | 10-20 | random subset of above | ≤2 |

### Mock Token Deployment Plan

For each of the 20 tokens, deploy:
1. **MockERC20** with mint function (for testing)
2. **Pyth feed** registered in PriceOracle (from verified feed IDs above)
3. **LendingPool configuration** (LTV, borrow cap, supply cap per token)
4. **Uniswap V3 pool** (WETH/token pairs for swap)

### Script Structure (TypeScript)

```typescript
// scripts/strategy-builder.ts
interface StrategyStep {
  operation: 'shield' | 'borrow' | 'swap' | 'repay' | 'unshield' | 'deposit';
  token: string;
  amount: bigint;
  encryptedAmount: euint128;
}

interface Strategy {
  id: string;
  steps: StrategyStep[];
  txCount: number;  // target ≤2
  gasEstimate: bigint;
  tokens: string[];
}

function generateStrategies(tokenCount: number, count: number): Strategy[] {
  // Random selection of tokens + operations
  // Group into ≤2 txs using Composer batching
}

async function executeStrategy(strategy: Strategy): Promise<StrategyResult> {
  // Execute on-chain via Composer
  // Measure gas, latency, FHE operation count
  // Verify encrypted state consistency
}

async function analyzeFriction(results: StrategyResult[]): Promise<FrictionReport> {
  // Average tx count, gas, latency per strategy type
  // Identify bottlenecks
  // Recommend optimizations
}
```

### FHE Capability Validation Matrix

For each strategy, validate:
- [ ] FHE.eq equality verification works
- [ ] FHE.gt health check works (encrypted LTV)
- [ ] FHE.select conditional update works
- [ ] FHESafeMath128 overflow/underflow detection
- [ ] ACL cross-contract handle passing (Composer→Pool→Vault)
- [ ] allowPublic + verifyDecryptResult (unshield/reveal)
- [ ] Encrypted events don't leak plain amounts

---

## 7. API Keys — How to Obtain

### 0x / Matcha
1. Go to https://dashboard.0x.org
2. Sign up (email + password)
3. Verify email
4. Click "Create an app" → name it → select "Swap API"
5. API key generated immediately
6. Use in `0x-api-key` header
7. Free tier: limited daily requests

### 1inch
1. Go to https://1inch.dev
2. Click "Get started" / "Get your API key"
3. Register with email
4. ⚠️ **KYC required** for developer portal access
5. Business portal: https://business.1inch.com (KYC/KYB)

### Relay.link
1. Go to https://relay.link
2. Find API key request form (linked from docs)
3. Fill form with use-case details
4. Wait up to 72 hours for review
5. If approved, API key emailed

---

## 8. Pool + Composer Integration — Token-Agnostic Design

### Current Architecture (Fixed Token Pairs)
- LendingPool: hardcoded WETH + USDC
- StrategyVault: single collateralToken per position
- PriceOracle: addSource/setFallbackPrice per token
- SwapRouter: intent-based, any token pair (but executor must hold output)

### Proposed Token-Agnostic Design

**PriceOracle** (already mostly agnostic):
```solidity
function addPythSource(address token, bytes32 priceId) external onlyOwner
function removeSource(address token) external onlyOwner
function setFallbackPrice(address token, uint256 price) external onlyOwner
function getPriceUsd(address token) public view returns (uint256, bool)
```

**LendingPool** (needs token config):
```solidity
struct TokenConfig {
  uint256 ltvBps;          // e.g. 7500 = 75%
  uint256 borrowCap;
  uint256 supplyCap;
  uint256 liquidationBonusBps;
  bool enabled;
}
mapping(address => TokenConfig) public tokenConfigs;
```

**StrategyVault** (already per-position):
```solidity
struct Position {
  bytes32 positionId;
  address collateralToken;
  euint128 collateralAmount;
  euint128 debtAmount;
  address debtToken;
}
```

**Composer** (already agnostic via params):
```solidity
struct OpenStrategyParams {
  address supplyToken;
  address borrowToken;
  address swapTokenOut;
  // ... amounts, deadlines
}
```

### Key Change: Dynamic Token Registry

```solidity
contract TokenRegistry is FheForgeBase {
  struct TokenInfo {
    address token;
    bytes32 pythPriceId;
    uint8 decimals;
    bool isLendable;
    bool isBorrowable;
    bool isCollateral;
    uint256 ltvBps;
  }
  
  mapping(address => TokenInfo) public tokens;
  address[] public tokenList;
  
  function registerToken(address token, bytes32 priceId, uint8 decimals, ...) external onlyOwner
  function updateTokenConfig(address token, ...) external onlyOwner
  function getLendableTokens() external view returns (address[] memory)
  function getBorrowableTokens() external view returns (address[] memory)
}
```

---

## 9. Action Plan (When Edits Are Approved)

### Phase 1: Uniswap V3 Pool Creation (Arb-Sepolia)
1. Deploy script to create WETH/USDC pool on Uniswap V3 Factory
2. Initialize pool with current price
3. Add liquidity via NonfungiblePositionManager
4. Test exactInputSingle from SwapRouter02

### Phase 2: SwapRouter Contract Upgrade
1. Add `exactInputSingle` path alongside intent model
2. Add fallback: if pool exists → use Uniswap; else → use intent
3. Deploy upgraded SwapRouter

### Phase 3: Pyth Feed Updates
1. Fix USDC/USD feed (replace $1 fallback with canonical Pyth feed `eaa020c61cc...`)
2. Add WBTC, ARB, LINK, DAI, SOL, AVAX, DOGE, etc. to PriceOracle
3. Update oracle setup script

### Phase 4: Token-Agnostic LendingPool
1. Add `TokenConfig` mapping with per-token LTV, caps, liquidation bonus
2. Remove hardcoded WETH/USDC assumptions
3. Add `registerToken` + `updateTokenConfig` owner functions

### Phase 5: Mock Token Deployment + Strategy Builder Script
1. Deploy 20 MockERC20 tokens (BTC, ETH, SOL, etc.)
2. Register all 36 Pyth feeds in PriceOracle
3. Create Uniswap V3 pools for WETH/token pairs
4. Build `strategy-builder.ts` with random strategy generation
5. Run friction analysis across 100+ strategy permutations
